import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
test.use({ baseURL: process.env.QUICKQUE_URL ?? 'http://127.0.0.1:4173', launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined) } });

test('presentation audio is optional and locked without paid Mac access', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Test', onboardingComplete: true }));
    localStorage.setItem('quickque_scripts', JSON.stringify([{ id: 'talk', title: 'My talk', purpose: 'presentation', createdAt: 1, updatedAt: 1, sections: [{ id: 'one', title: 'Opening', content: 'Hello everyone.' }] }]));
    localStorage.setItem('quickque_active_script', 'talk');
  });
  await page.goto('/edit');
  await page.getByText('AI rehearsal audio', { exact: false }).click();
  await expect(page.getByRole('button', { name: 'Generate audio', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Listen to script', exact: true })).toBeDisabled();
  await expect(page.getByText(/Optional: generate a spoken version/)).toBeVisible();
  await expect(page.getByText(/Saved AI audio is available in the Quickque Mac app/)).toBeVisible();
});

test('prepared audio reads once, plays from buffers and never synthesizes on a cache miss', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/lib/script-audio.ts';
    const { PreparedScriptAudio } = await import(/* @vite-ignore */ modulePath);
    const calls: string[] = [];
    let missing = false;
    let sources = 0;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => {
      calls.push(cmd);
      if (cmd === 'script_audio_entitlement') return { paid: true };
      if (cmd === 'script_audio_status') return { status: missing ? 'missing' : 'ready', entries: [] };
      if (cmd === 'script_audio_read') return [0];
      throw new Error(`Unexpected native call ${cmd}`);
    } };
    class Context {
      state = 'running'; destination = {};
      async resume() {}
      async close() { this.state = 'closed'; }
      async decodeAudioData() { return { length: 32, numberOfChannels: 1 }; }
      createBufferSource() {
        sources++;
        return { buffer: null, onended: null as (() => void) | null, connect() {}, disconnect() {}, stop() {}, start() { queueMicrotask(() => this.onended?.()); } };
      }
    }
    (window as any).AudioContext = Context;
    const request = { scriptId: 's', revision: 'r', entries: [{ id: 'a', text: 'Hello', voiceId: 'chatterbox-turbo:default-en', rate: 1 }] };
    const voice = { engine: 'turbo', voiceId: 'chatterbox-turbo:default-en', rate: 1 };
    const player = new PreparedScriptAudio(request);
    await player.prepare();
    await player.speak('Hello', voice, new AbortController().signal);
    await player.speak('Hello', voice, new AbortController().signal);
    const controller = new AbortController(); controller.abort();
    let cancelled = false;
    try { await player.speak('Hello', voice, controller.signal); } catch { cancelled = true; }
    const lateAbort = new AbortController();
    const originalStop = player.stop.bind(player);
    player.stop = async () => { await originalStop(); lateAbort.abort(); };
    let lateCancelled = false;
    try { await player.speak('Hello', voice, lateAbort.signal); } catch { lateCancelled = true; }
    await player.dispose();
    missing = true;
    const stale = new PreparedScriptAudio(request);
    let blocked = false;
    try { await stale.prepare(); } catch { blocked = true; }
    await stale.dispose();
    delete (window as any).__TAURI_INTERNALS__;
    return { reads: calls.filter(cmd => cmd === 'script_audio_read').length, synthesis: calls.some(cmd => /speak|generate/.test(cmd)), sources, cancelled, lateCancelled, blocked };
  });
  expect(result).toEqual({ reads: 1, synthesis: false, sources: 2, cancelled: true, lateCancelled: true, blocked: true });
});

test('prepared audio progress follows the playback clock and stops at completion', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { PreparedScriptAudio } = await import('/src/lib/script-audio.ts');
    (window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => {
      if (cmd === 'script_audio_entitlement') return { paid: true };
      if (cmd === 'script_audio_status') return { status: 'ready', entries: [] };
      if (cmd === 'script_audio_read') return [0];
      throw new Error(`Unexpected native call ${cmd}`);
    } };
    class Context {
      state = 'running';
      destination = {};
      get currentTime() { return performance.now() / 1000; }
      async resume() {}
      async close() { this.state = 'closed'; }
      async decodeAudioData() {
        return { length: 32, numberOfChannels: 1, duration: 0.08 };
      }
      createBufferSource() {
        return {
          buffer: null,
          onended: null as (() => void) | null,
          connect() {},
          disconnect() {},
          stop() {},
          start() { setTimeout(() => this.onended?.(), 90); },
        };
      }
    }
    (window as any).AudioContext = Context;
    const request = {
      scriptId: 'timed',
      revision: 'r',
      entries: [{ id: 'a', text: 'One two three', voiceId: 'chatterbox-turbo:default-en', rate: 1 }],
    };
    const player = new PreparedScriptAudio(request);
    const progress: { charStart: number; charEnd: number }[] = [];
    await player.speak(
      'One two three',
      { engine: 'turbo', voiceId: 'chatterbox-turbo:default-en', rate: 1 },
      new AbortController().signal,
      value => progress.push(value),
    );
    const countAtCompletion = progress.length;
    await new Promise(resolve => setTimeout(resolve, 40));
    await player.dispose();
    delete (window as any).__TAURI_INTERNALS__;
    return {
      starts: progress.map(value => value.charStart),
      stopped: progress.length === countAtCompletion,
    };
  });
  expect(result.starts).toContain(0);
  expect(result.starts).toContain(8);
  expect(result.stopped).toBe(true);
});

test('Debug licence toggle persists and can return to Unlicensed', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Test', onboardingComplete: true }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Settings & backups', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Licensed mode' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.getByText('Licence mode: Licensed', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings & backups', exact: true }).click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByText('Licence mode: Unlicensed', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings & backups', exact: true }).click();
  await expect(toggle).not.toBeChecked();
});

test('generation traces worker stages and failures, filters other jobs, and removes its listener', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { generateAudio } = await import('/src/lib/script-audio.ts');
    const { clearFlowDebug, getFlowDebugSnapshot } = await import('/src/lib/flow/diagnostics.ts');
    let callback: (event: unknown) => void = () => {};
    let removed = 0;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback: (handler: typeof callback) => { callback = handler; return 1; },
      invoke: async (command: string) => {
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:event|unlisten') { removed++; return; }
        if (command === 'script_audio_generate') {
          callback({ payload: { scriptId: 'other', revision: 'r', stage: 'generation' } });
          callback({ payload: { scriptId: 's', revision: 'old', stage: 'generation' } });
          callback({ payload: { scriptId: 's', revision: 'r', stage: 'model_load' } });
          callback({ payload: { scriptId: 's', revision: 'r', stage: 'SECRET /Users/name/reference.wav' } });
          callback({ payload: { scriptId: 's', revision: 'r', stage: 'generation' } });
          throw 'SCENE_SPEECH_TURBO_GENERATION: private script';
        }
        throw new Error(`Unexpected command ${command}`);
      },
    };
    clearFlowDebug();
    let failed = false;
    try { await generateAudio({ scriptId: 's', revision: 'r', entries: [] }); }
    catch { failed = true; }
    const codes = getFlowDebugSnapshot().map((entry: { code: string }) => entry.code);
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__;
    return { codes, removed, failed };
  });
  expect(result).toEqual({
    codes: ['audio_generate_begin', 'audio_model_load', 'audio_generation', 'audio_generate_failed', 'error:SCENE_SPEECH_TURBO_GENERATION'],
    removed: 1, failed: true,
  });
});
