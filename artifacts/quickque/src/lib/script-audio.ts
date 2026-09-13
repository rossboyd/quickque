import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './desktop';
import type { AudioRequest } from './script-audio-model';
import { audioEntryIdentity } from './script-audio-model';
import type { SceneVoice } from './scene-lifecycle';

export type AudioStatus = { status: 'ready' | 'missing'; revision: string; entries: { id: string; key: string; durationSeconds: number }[]; missing?: number };
export const AUDIO_CHANGED = 'quickque:script-audio-changed';
export const AUDIO_JOB_CHANGED = 'quickque:script-audio-job-changed';
export const audioJobs = new Map<string, { revision: string; running: boolean; error?: string }>();
export async function audioEntitlement(): Promise<{ paid: boolean; reason?: string }> {
  if (!isDesktop()) return { paid: false, reason: 'Saved AI audio is available in the Quickque Mac app with a paid licence.' };
  return invoke('script_audio_entitlement');
}
export const audioStatus = (request: AudioRequest) => invoke<AudioStatus>('script_audio_status', { request });
export async function generateAudio(request: AudioRequest): Promise<AudioStatus> {
  audioJobs.set(request.scriptId, { revision: request.revision, running: true });
  window.dispatchEvent(new Event(AUDIO_JOB_CHANGED));
  try {
    const result = await invoke<AudioStatus>('script_audio_generate', { request });
    audioJobs.set(request.scriptId, { revision: request.revision, running: false });
    return result;
  } catch (error) {
    audioJobs.set(request.scriptId, { revision: request.revision, running: false, error: String(error) });
    throw error;
  } finally {
    window.dispatchEvent(new Event(AUDIO_JOB_CHANGED));
    window.dispatchEvent(new Event(AUDIO_CHANGED));
  }
}
export const cancelAudioGeneration = () => invoke<void>('script_audio_cancel');
export const exportAudio = (request: AudioRequest) => invoke<string | null>('script_audio_export', { scriptId: request.scriptId, revision: request.revision });
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
  constructor(private request: AudioRequest) {}
  prepare(): Promise<void> {
    return this.loading ??= this.load();
  }
  private async load() {
    if (!this.request.entries.length) return;
    if (!(await audioEntitlement()).paid) throw new Error('Enable Licensed mode in Settings → Debug to use saved AI audio.');
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
  async speak(text: string, voice: SceneVoice, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    await this.prepare();
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    const buffer = this.buffers.get(audioEntryIdentity(text, voice.voiceId, voice.rate, voice.voiceRevision));
    if (!buffer || !this.context) throw new Error('Matching saved AI audio is unavailable. Generate audio in Edit.');
    await this.context.resume();
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    await this.stop();
    if (signal.aborted || this.disposed) throw new Error('Audio playback cancelled.');
    return new Promise<void>((resolve, reject) => {
      const source = this.context!.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context!.destination);
      let done = false;
      const finish = (cancelled: boolean) => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', abort);
        source.onended = null;
        source.disconnect();
        if (this.active?.stop === abort) this.active = null;
        if (cancelled) reject(new Error('Audio playback cancelled.')); else resolve();
      };
      const abort = () => { source.stop(); finish(true); };
      this.active = { stop: abort };
      signal.addEventListener('abort', abort, { once: true });
      source.onended = () => finish(false);
      source.start();
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
