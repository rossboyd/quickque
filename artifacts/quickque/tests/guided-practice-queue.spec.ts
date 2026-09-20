import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

test.use({
  baseURL: process.env.QUICKQUE_URL ?? 'http://127.0.0.1:80',
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
  },
});
const artifactPath = (process.env.QUICKQUE_ARTIFACT_PATH ?? '/demo').replace(/\/$/, '');

test('computer partner queue keeps its scene ready across bookmark and note edits', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as any).__qqReadinessCalls = calls;
    class Context {
      state = 'running'; currentTime = 0; destination = {};
      async resume() {}
      async close() { this.state = 'closed'; }
      async decodeAudioData() { return { length: 32, numberOfChannels: 1, duration: 0.05 }; }
      createBufferSource() {
        return { buffer: null, onended: null as (() => void) | null, connect() {}, disconnect() {}, stop() {},
          start() { setTimeout(() => this.onended?.(), 60); } };
      }
    }
    (window as any).AudioContext = Context;
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (callback: unknown) => { (window as any).__qqFlowCallback = callback; return 1; },
      invoke: async (command: string, args?: any) => {
        if (command === 'voice_library_list') {
          calls.push(command);
          await new Promise(resolve => setTimeout(resolve, 50));
          return [{ id: 'partner', name: 'Partner', revision: 1, durationSeconds: 15, sampleRate: 24000, recordingSha256: 'fixture', consentConfirmed: true, createdAt: 1, updatedAt: 1 }];
        }
        if (command === 'get_local_library') return { directory: '/fixture', scriptsJson: null };
        if (command === 'save_local_library') return undefined;
        if (command === 'licence_status') return { status: 'active', configured: true, message: '' };
        if (command === 'plugin:event|listen' || command === 'plugin:event|unlisten') return 1;
        if (command === 'plugin:window|set_always_on_top') return undefined;
        if (command === 'flow_command') return undefined;
        if (command === 'script_audio_status') {
          calls.push(command);
          await new Promise(resolve => setTimeout(resolve, 50));
          return { status: 'ready', revision: args?.request?.revision ?? 'fixture-r1', entries: [] };
        }
        if (command === 'script_audio_read') return [0];
        if (command === 'script_audio_entitlement') return { paid: true };
        if (command === 'scene_speech_list_local_voices') {
          return { voices: [{ id: 'partner', name: 'Partner', engine: 'turbo', language: 'en-US' }] };
        }
        if (command === 'scene_speech_next_request_id') return 1;
        if (command === 'scene_speech_speak' || command === 'scene_speech_stop') return undefined;
        throw new Error(`Unexpected native call ${command}`);
      },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
      registerListener: () => Promise.resolve(() => {}),
    };
  });
  await page.goto(`${artifactPath}/`);
  const script = {
    id: 'partner-queue-fixture',
    title: 'Partner queue fixture',
    purpose: 'performance',
    createdAt: 1,
    updatedAt: 1,
    actor: {
      enabled: true,
      characters: [
        { id: 'learner', name: 'Learner', age: '', gender: '', style: '', voice: { engine: 'turbo', voiceId: '', rate: 1 } },
        { id: 'partner', name: 'Partner', age: '', gender: '', style: '', voice: { engine: 'turbo', voiceId: 'chatterbox-local:partner', voiceRevision: 1, rate: 1 } },
      ],
      myRoleIds: ['learner'],
      roleAssignments: { learner: 'my-role', partner: 'computer-partner' },
    },
    sections: [
      { id: 'turn-one', title: 'First', content: 'First learner line', characterId: 'learner' },
      { id: 'gap-two', title: 'Gap two', content: 'Gap two line', characterId: 'learner' },
      { id: 'turn-three', title: 'Third', content: 'Third learner line', characterId: 'learner' },
      { id: 'gap-four', title: 'Gap four', content: 'Gap four line', characterId: 'learner' },
      { id: 'turn-five', title: 'Last', content: 'Last partner line', characterId: 'partner' },
    ],
    practice: { mode: 'off-book', startTurn: 0, endTurn: 4, difficultSectionIds: ['turn-five', 'turn-one', 'turn-three'] },
    personalNotes: [],
  };
  await page.evaluate(({ script }) => {
    localStorage.clear();
    localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Partner tester', onboardingComplete: true }));
    localStorage.setItem('quickque-flow-setup-done', 'true');
    localStorage.setItem('quickque_scripts', JSON.stringify([script]));
    localStorage.setItem('quickque_active_script', script.id);
  }, { script });
  const fingerprint = await page.evaluate(async ({ script, artifactPath }) => {
    const { getScriptFingerprint } = await import(`${artifactPath}/src/lib/script-readiness.ts`);
    return getScriptFingerprint(script as any);
  }, { script, artifactPath });
  await page.evaluate(({ script, fingerprint }) => {
    localStorage.setItem('quickque_setup_checkpoints_v1', JSON.stringify({
      [script.id]: {
        version: 1,
        scriptId: script.id,
        scriptFingerprint: fingerprint,
        currentStep: 'ready',
        completedSteps: ['add-script', 'review-script-and-cast', 'choose-your-role', 'set-up-partners', 'prepare-and-test', 'ready'],
        mode: 'partner-audio',
        roleAssignments: script.actor.roleAssignments,
        updatedAt: 1,
      },
    }));
  }, { script, fingerprint });
  await page.goto(`${artifactPath}/read/partner-queue-fixture`);
  const cancelVoiceSetup = page.getByRole('button', { name: 'Cancel Setup' });
  await expect(cancelVoiceSetup).toBeVisible({ timeout: 10000 });
  await cancelVoiceSetup.click();
  const continueScript = page.getByRole('heading', { name: 'Continue this script?', exact: true });
  if (await continueScript.isVisible()) await page.getByRole('button', { name: 'Start over' }).click();
  const practiceButton = page.getByRole('button', { name: 'Open guided practice' });
  if (await practiceButton.count()) await practiceButton.click();
  else await page.getByRole('button', { name: 'Practice', exact: true }).click();
  await page.getByRole('radio', { name: /Try without my lines/ }).check();
  await page.getByRole('radio', { name: 'Bookmarked passages only (3)' }).check();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Start or resume scene' }).click();
  await expect(page.getByRole('button', { name: 'Pause rehearsal' })).toBeVisible();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Next turn (Right Arrow)' }).click();
  await expect(page.getByRole('combobox', { name: 'Turn navigation' })).toHaveValue('2');
  const readinessCalls = await page.evaluate(() => (window as any).__qqReadinessCalls.length);
  await page.getByRole('button', { name: 'Difficult passage marked' }).click();
  await expect(page.getByRole('button', { name: 'Mark as difficult' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Private reflection' }).fill('third-turn note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('combobox', { name: 'Turn navigation' })).toHaveValue('2');
  await expect(page.getByText('Private reflection saved on this device.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__qqReadinessCalls.length)).toBe(readinessCalls);
  await expect(page.getByText(/Checking rehearsal readiness/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Start or resume scene' }).click();
  await page.getByRole('button', { name: 'Next turn (Right Arrow)' }).click();
  await expect(page.getByRole('combobox', { name: 'Turn navigation' })).toHaveValue('4');
  await expect(page.getByRole('heading', { name: 'Bookmarked queue complete' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Completed passages' }).getByRole('listitem'))
    .toHaveText(['Turn 1 · First', 'Turn 3 · Third', 'Turn 5 · Last']);
  const stored = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('quickque_scripts')!);
    const script = Array.isArray(raw) ? raw[0] : raw.scripts[0];
    return { practice: script.practice, personalNotes: script.personalNotes, sections: script.sections };
  });
  expect(stored.personalNotes).toEqual(expect.arrayContaining([
    expect.objectContaining({ sectionId: 'turn-three', content: 'third-turn note' }),
  ]));
  expect(stored.sections.find((section: any) => section.id === 'turn-three').content).toBe('Third learner line');
  expect(stored.practice.difficultSectionIds).toEqual(['turn-five', 'turn-one']);
  expect(stored.sections).toEqual(script.sections);
  await page.getByRole('button', { name: 'Choose another passage' }).click();
  await expect(page.getByRole('radio', { name: 'Bookmarked passages only (2)' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Bookmarked passages queue' }).getByRole('listitem'))
    .toHaveText(['Turn 1 · First', 'Turn 5 · Last']);
});