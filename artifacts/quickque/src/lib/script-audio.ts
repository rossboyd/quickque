import { audioTrialFor, audioTrialEnded } from './audio-trial';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { recordFlowDebug, recordAudioFailure } from './flow/diagnostics';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './desktop';
import type { AudioRequest } from './script-audio-model';
import { audioEntryIdentity } from './script-audio-model';
import type { SceneVoice } from './scene-lifecycle';
import type { SceneSpeechProgress } from './scene-lifecycle';
import { tokenize } from './flow/tokenize';

export type AudioStatus = { status: 'ready' | 'missing'; revision: string; entries: { id: string; key: string; durationSeconds: number }[]; missing?: number };
export const AUDIO_CHANGED = 'quickque:script-audio-changed';
export const AUDIO_JOB_CHANGED = 'quickque:script-audio-job-changed';
export type AudioJob = { revision: string; running: boolean; error?: string; startedAt: number; stage: 'starting' | 'model_load' | 'voice_prepare' | 'generation' | 'ready' | 'failed'; completed: number; total: number };
export const audioJobs = new Map<string, AudioJob>();

export async function audioEntitlement(): Promise<{ paid: boolean; available?: boolean; reason?: string }> {
  if (!isDesktop()) return { paid: false, available: false, reason: 'AI audio is available in the Quickque Mac app.' };
  return invoke('script_audio_entitlement');
}
export const audioStatus = (request: AudioRequest) => invoke<AudioStatus>('script_audio_status', { request });
export async function generateAudio(request: AudioRequest): Promise<AudioStatus> {
  if (audioJobs.get(request.scriptId)?.running) throw new Error('SCRIPT_AUDIO_BUSY: Audio generation is already running.');
  recordFlowDebug('audio_generate_begin');
  const listeners: UnlistenFn[] = [];
  const job: AudioJob = { revision: request.revision, running: true, startedAt: Date.now(), stage: 'starting', completed: 0, total: request.entries.length };
  const publish = () => window.dispatchEvent(new Event(AUDIO_JOB_CHANGED));
  audioJobs.set(request.scriptId, job);
  window.dispatchEvent(new Event(AUDIO_JOB_CHANGED));
  try {
    try {
      listeners.push(await listen<{ scriptId: string; revision: string; stage: string }>('script-audio-diagnostic', ({ payload }) => {
        if (payload.scriptId !== request.scriptId || payload.revision !== request.revision) return;
        if (payload.stage === 'model_load' || payload.stage === 'voice_prepare' || payload.stage === 'generation') {
          job.stage = payload.stage;
          recordFlowDebug(`audio_${payload.stage}`);
          publish();
        }
      }));
      listeners.push(await listen<{ scriptId: string; revision: string; completed: number; total: number }>('script-audio-progress', ({ payload }) => {
        if (payload.scriptId !== request.scriptId || payload.revision !== request.revision ||
            !Number.isSafeInteger(payload.completed) || payload.completed < 0 || payload.completed > job.total || payload.total !== job.total) return;
        job.completed = Math.max(job.completed, payload.completed);
        recordFlowDebug('audio_passages_complete', undefined, job.completed);
        publish();
      }));
    } catch { recordFlowDebug('audio_listener_failed'); }
    const result = await invoke<AudioStatus>('script_audio_generate', { request });
    recordFlowDebug('audio_generate_ready');
    Object.assign(job, { running: false, stage: 'ready', completed: job.total });
    return result;
  } catch (error) {
    recordFlowDebug('audio_generate_failed');
    recordAudioFailure(error);
    Object.assign(job, { running: false, stage: 'failed', error: String(error) });
    throw error;
  } finally {
    listeners.forEach(remove => remove());
    window.dispatchEvent(new Event(AUDIO_JOB_CHANGED));
    window.dispatchEvent(new Event(AUDIO_CHANGED));
  }
}
export async function cancelAudioGeneration() {
  recordFlowDebug('audio_cancel_begin');
  try { await invoke<void>('script_audio_cancel'); recordFlowDebug('audio_cancel_ready'); }
  catch (error) { recordFlowDebug('audio_cancel_failed'); recordAudioFailure(error); throw error; }
}
export async function exportAudio(request: AudioRequest) {
  if (!(await audioEntitlement()).paid) { window.dispatchEvent(new Event('quickque:upgrade')); return null; }
  return invoke<string | null>('script_audio_export', { scriptId: request.scriptId, revision: request.revision });
}
export async function deleteAudio(scriptId: string) {
  await invoke('script_audio_delete', { scriptId });
  window.dispatchEvent(new Event(AUDIO_CHANGED));
}

/** Decode before rehearsal. Turns only start a prepared buffer; synthesis is never a fallback. */
export class PreparedScriptAudio {
  private context: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private active: { stop: () => void } | null = null;
  private disposed = false;
  private trial: ReturnType<typeof audioTrialFor>;
  constructor(private request: AudioRequest) { this.trial = audioTrialFor(request.scriptId); }
  prepare(): Promise<void> {
    return this.loading ??= this.load();
  }
  private async load() {
    if (!this.request.entries.length) return;
    const access = await audioEntitlement();
    if (!(access.available ?? access.paid)) throw new Error('Open this script in the Quickque Mac app to listen.');
    const status = await audioStatus(this.request);
    if (status.status !== 'ready') throw new Error('AI audio is missing or out of date. Return to Edit and generate audio before rehearsing.');
    if (this.disposed) throw new Error('Audio preparation cancelled.');
    const context = this.context = new AudioContext();
    let totalBytes = 0;
    for (const entry of this.request.entries) {
      if (this.buffers.has(audioEntryIdentity(entry.text, entry.voiceId, entry.rate, entry.voiceRevision))) continue;
      if (this.disposed) throw new Error('Audio preparation cancelled.');
      const bytes = await invoke<number[]>('script_audio_read', { scriptId: this.request.scriptId, revision: this.request.revision, entryId: entry.id });
      if (this.disposed) throw new Error('Audio preparation cancelled.');
      const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
      if (this.disposed) throw new Error('Audio preparation cancelled.');
      totalBytes += buffer.length * buffer.numberOfChannels * 4;
      if (totalBytes > 256 * 1024 * 1024) throw new Error('This script has too much audio to preload. Split it into shorter scripts.');
      this.buffers.set(audioEntryIdentity(entry.text, entry.voiceId, entry.rate, entry.voiceRevision), buffer);
    }
  }
  async speak(text: string, voice: SceneVoice, signal: AbortSignal, onProgress?: (progress: SceneSpeechProgress) => void): Promise<void> {
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    await this.prepare();
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    const buffer = this.buffers.get(audioEntryIdentity(text, voice.voiceId, voice.rate, voice.voiceRevision));
    if (!buffer || !this.context) throw new Error('Matching saved AI audio is unavailable. Generate audio in Edit.');
    await this.context.resume();
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    await this.stop();
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    const licensed = (await audioEntitlement()).paid;
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    const remaining = this.trial.remaining(licensed);
    if (remaining <= 0) throw audioTrialEnded();
    return new Promise<void>((resolve, reject) => {
      const source = this.context!.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context!.destination);
      const tokens = tokenize(text);
      const startedAt = this.context!.currentTime;
      let frame = 0;
      let done = false;
      const limited = Number.isFinite(buffer.duration) && buffer.duration >= remaining;
      const finish = (cancelled: boolean) => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', abort);
        source.onended = null;
        if (frame) cancelAnimationFrame(frame);
        source.disconnect();
        if (this.active?.stop === abort) this.active = null;
        const elapsed = this.context!.currentTime - startedAt;
        if (!licensed) this.trial.consume(cancelled ? Math.max(0, elapsed) : Math.min(buffer.duration, remaining));
        if (cancelled) reject(new Error('Audio playback cancelled.'));
        else if (limited) reject(audioTrialEnded());
        else resolve();
      };
      const abort = () => { source.stop(); finish(true); };
      this.active = { stop: abort };
      signal.addEventListener('abort', abort, { once: true });
      source.onended = () => finish(false);
      if (Number.isFinite(remaining)) source.start(0, 0, remaining); else source.start();
      const report = () => {
        if (done || signal.aborted) return;
        const elapsed = Math.max(0, this.context!.currentTime - startedAt);
        const fraction = buffer.duration > 0 ? Math.min(0.999999, elapsed / buffer.duration) : 0;
        const token = tokens[Math.min(tokens.length - 1, Math.floor(fraction * tokens.length))];
        if (token) onProgress?.({ charStart: token.start, charEnd: token.end });
        frame = requestAnimationFrame(report);
      };
      report();
    });
  }
  async stop() { this.active?.stop(); }
  async dispose() {
    this.disposed = true;
    await this.stop();
    this.buffers.clear();
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}
