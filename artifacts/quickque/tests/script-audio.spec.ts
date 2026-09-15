import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
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
  await expect(page.getByRole('heading', { name: 'Rehearsal audio', exact: true })).toBeVisible();
  await expect(page.getByTestId('audio-missing-cta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare audio', exact: true })).toBeDisabled();
  await expect(page.getByText(/AI audio is available in the Quickque Mac app/)).toBeVisible();
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Help & diagnostics' }).click();
  await page.getByText('Developer options', { exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Licensed mode' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.getByText('Licence mode: Licensed', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Help & diagnostics' }).click();
  await page.getByText('Developer options', { exact: true }).click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByText('Licence mode: Unlicensed', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Help & diagnostics' }).click();
  await page.getByText('Developer options', { exact: true }).click();
  await expect(toggle).not.toBeChecked();
});

test('generation traces worker stages and failures, filters other jobs, and removes its listener', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { generateAudio } = await import('/src/lib/script-audio.ts');
    const { clearFlowDebug, getFlowDebugSnapshot } = await import('/src/lib/flow/diagnostics.ts');
    let callback: (event: unknown) => void = () => {};
    let nextHandler: typeof callback = () => {};
    let removed = 0;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback: (handler: typeof callback) => { nextHandler = handler; return 1; },
      invoke: async (command: string, args: { event?: string }) => {
        if (command === 'plugin:event|listen') { if (args.event === 'script-audio-diagnostic') callback = nextHandler; return 1; }
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
    removed: 2, failed: true,
  });
});


test('desktop security policy permits local WAV blob playback', async ({ page }) => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  await page.route('**/audio-policy-test', route => route.fulfill({
    contentType: 'text/html', headers: { 'Content-Security-Policy': config.app.security.csp }, body: '<html><body>Audio policy test</body></html>',
  }));
  await page.goto('/audio-policy-test');
  const result = await page.evaluate(async () => {
    const data = new Uint8Array(44 + 3200);
    const view = new DataView(data.buffer);
    const tag = (offset: number, text: string) => [...text].forEach((v, i) => view.setUint8(offset + i, v.charCodeAt(0)));
    tag(0, 'RIFF'); view.setUint32(4, data.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, 'data'); view.setUint32(40, 3200, true);
    const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
    const audio = new Audio(url); audio.muted = true;
    try { await audio.play(); return 'playing'; } catch (error) { return String(error); }
    finally { audio.pause(); URL.revokeObjectURL(url); }
  });
  expect(result).toBe('playing');
});

test('saved audio is presented as an obvious mini player', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Sam', onboardingComplete: true })));
  await page.reload();
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { ScriptAudioPanel } = await import('/src/components/script-audio-panel.tsx');
    const { StoreProvider } = await import('/src/lib/store.tsx');
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === 'get_local_library') return { directory: null, scriptsJson: null };
        if (command === 'script_audio_entitlement') return { paid: true };
        if (command === 'voice_library_list') return [];
        if (command === 'script_audio_status') return { status: 'ready', entries: [] };
        throw new Error(command);
      },
    };
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const script = { id: 'ready-test', title: 'Launch keynote', purpose: 'presentation', createdAt: 1, updatedAt: 1, sections: [{ id: 'one', title: 'Opening', content: 'Hello everyone.' }] };
    createRoot(host).render(React.createElement(StoreProvider, null, React.createElement(ScriptAudioPanel, { script })));
  });
  await expect(page.getByTestId('audio-ready-player')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play saved audio', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export MP4', exact: true })).toBeVisible();
  await expect(page.getByText('Launch keynote', { exact: true })).toBeVisible();
  await expect(page.getByTestId('audio-missing-cta')).toHaveCount(0);
});

test('audio panel shows truthful progress and retains it when reopened without status polling', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Sam', onboardingComplete: true })));
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Welcome setup guide' })).toHaveCount(0);
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { ScriptAudioPanel } = await import('/src/components/script-audio-panel.tsx');
    const { StoreProvider } = await import('/src/lib/store.tsx');
    const callbacks = new Map<number, (event: unknown) => void>();
    const handlers = new Map<string, number>();
    let sequence = 0;
    let checks = 0;
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    (window as any).__TAURI_INTERNALS__ = {
      transformCallback: (handler: (event: unknown) => void) => { callbacks.set(++sequence, handler); return sequence; },
      invoke: async (command: string, args: any) => {
        if (command === 'plugin:event|listen') { handlers.set(args.event, args.handler); return args.handler; }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'get_local_library') return { directory: null, scriptsJson: null };
        if (command === 'script_audio_entitlement') return { paid: true };
        if (command === 'voice_library_list') return [];
        if (command === 'script_audio_status') { checks++; return { status: 'missing', entries: [] }; }
        if (command === 'script_audio_generate') {
          (window as any).audioRequest = args.request;
          callbacks.get(handlers.get('script-audio-diagnostic')!)?.({ payload: { ...args.request, stage: 'model_load' } });
          return new Promise(resolve => { (window as any).finishAudio = () => resolve({ status: 'ready', entries: [] }); });
        }
        throw new Error(command);
      },
    };
    (window as any).advanceAudio = () => {
      const request = (window as any).audioRequest;
      callbacks.get(handlers.get('script-audio-diagnostic')!)?.({ payload: { ...request, stage: 'generation' } });
      callbacks.get(handlers.get('script-audio-progress')!)?.({ payload: { ...request, completed: 0, total: request.entries.length } });
    };
    (window as any).statusChecks = () => checks;
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const script = { id: 'progress-test', title: 'Talk', purpose: 'presentation', createdAt: 1, updatedAt: 1, sections: [{ id: 'one', title: 'Opening', content: 'Hello everyone.' }] };
    const root = createRoot(host);
    let mount = 0;
    const render = () => root.render(React.createElement(StoreProvider, null, React.createElement(ScriptAudioPanel, { script, key: ++mount })));
    (window as any).remountAudio = render;
    render();
  });
  await expect(page.getByTestId('audio-missing-cta')).toBeVisible();
  await page.getByRole('button', { name: 'Prepare audio', exact: true }).click();
  await expect(page.getByText('Getting ready…')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Audio generation progress' })).not.toHaveAttribute('value');
  const checks = await page.evaluate(() => (window as any).statusChecks());
  await page.evaluate(() => (window as any).advanceAudio());
  await expect(page.getByRole('progressbar', { name: 'Audio generation progress' })).toHaveAttribute('value', '0');
  await expect(page.getByText('Working out the time remaining…')).toBeVisible();
  expect(await page.evaluate(() => (window as any).statusChecks())).toBe(checks);
  await page.evaluate(() => (window as any).remountAudio());
  await expect(page.getByText('Working out the time remaining…')).toBeVisible();
  expect(await page.evaluate(() => (window as any).statusChecks())).toBe(checks);
  await page.getByText('More options', { exact: true }).click();
  await page.getByText('Troubleshooting details', { exact: true }).click();
  await expect(page.getByText(/audio_model_load —/)).toBeVisible();
  await page.evaluate(() => (window as any).finishAudio());
  await expect(page.getByRole('progressbar', { name: 'Audio generation progress' })).toHaveCount(0);
});
