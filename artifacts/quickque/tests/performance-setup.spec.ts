import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.use({
  baseURL: process.env.QUICKQUE_URL ?? 'http://127.0.0.1:80',
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
  },
});
const artifactPath = (process.env.QUICKQUE_ARTIFACT_PATH ?? '').replace(/\/$/, '');

async function openLibrary(page: Page) {
  await page.goto(`${artifactPath}/`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Performance Tester', onboardingComplete: true }));
    localStorage.setItem('quickque-flow-setup-done', 'true');
  });
  await page.reload();
}

async function createPerformance(page: Page) {
  await page.getByRole('button', { name: 'New script', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start a new script' })).toBeVisible();
  await page.getByRole('button', { name: 'Performance / Self-tape' }).click();
  await expect(page.getByRole('heading', { name: /Set up Untitled Performance/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save and leave', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Script type' })).toHaveValue('performance');
  await page.getByRole('textbox', { name: 'Script Title', exact: true }).fill('Audition rehearsal');
}

for (const width of [390, 1280]) {
  test(`performance purpose survives audio toggle and reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openLibrary(page);
    await createPerformance(page);
    await expect(page.getByRole('button', { name: 'Finish setup', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add Turn', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
    await page.getByRole('switch', { name: 'Partner audio' }).click();
    await page.getByRole('button', { name: 'Close scene partner cast' }).click();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Script type' })).toHaveValue('performance');
    await expect(page.getByRole('button', { name: 'Finish setup', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Partner audio' })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Close scene partner cast' }).click();
    await page.getByRole('combobox', { name: 'Script type' }).selectOption('presentation');
    await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Section', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Script type' }).selectOption('performance');
    await expect(page.getByRole('button', { name: 'Finish setup', exact: true })).toBeVisible();
    const action = await page.getByRole('button', { name: 'Finish setup', exact: true }).boundingBox();
    expect(action!.x).toBeGreaterThanOrEqual(0);
    expect(action!.x + action!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('incomplete performance blocks rehearsal with actionable setup links', async ({ page }) => {
  await openLibrary(page);
  await createPerformance(page);
  await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up Audition rehearsal' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/read\//);
  await expect(page.getByRole('alert')).toContainText('Add a title and at least one line before continuing.');
});

for (const width of [390, 1280]) {
  test(`Markdown, cast colours and script-first rehearsal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openLibrary(page);
    await createPerformance(page);
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    const markdown = page.getByRole('textbox', { name: 'Script Markdown' });
    await markdown.fill('# The return\n## Opening\n**Alex:** Welcome back.\n> Take a breath.\n**Jamie:** I had to come back.');
    await page.getByRole('button', { name: 'Save script', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Added Alex, Jamie' })).toBeVisible();
    // A second save exercises snapshot tracking rather than stale draft rejection.
    await markdown.fill((await markdown.inputValue()).replace('Welcome back.', 'Welcome home.'));
    await page.getByRole('button', { name: 'Save script', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved. Cast assignments' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to sections', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Turn content for "Opening"' })).toHaveValue('Welcome home.');
    await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
    await page.getByRole('group', { name: 'Who performs Alex?', exact: true }).getByRole('button', { name: 'In Person', exact: true }).click();
    await page.getByRole('group', { name: 'Colour presets for Alex', exact: true }).getByRole('button', { name: 'Teal', exact: true }).click();
    await page.getByRole('group', { name: 'Who performs Jamie?', exact: true }).getByRole('button', { name: 'In Person', exact: true }).click();
    await page.getByRole('group', { name: 'Colour presets for Jamie', exact: true }).getByRole('button', { name: 'Amber', exact: true }).click();
    await page.getByRole('button', { name: 'Close scene partner cast' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Who performs Alex?', exact: true }).getByRole('button', { name: 'In Person', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Colour for Alex', { exact: true })).toHaveValue('#14b8a6');
    await page.getByRole('button', { name: 'Close scene partner cast' }).click();
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
    await expect(page.getByLabel('Speaking now', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Up next', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Alex · In Person', { exact: true })).toBeVisible();
    await expect(page.locator('[data-scene-current="true"]')).toHaveText('Jamie · In Person');
    await page.getByRole('button', { name: 'Start or resume scene', exact: true }).click();
    await page.getByTitle('Next turn (Right Arrow)', { exact: true }).click();
    await expect(page.getByText('Jamie · In Person', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Previous turn (Left Arrow)', exact: true }).click();
    await expect(page.locator('[data-scene-current="true"]')).toHaveText('Alex · In Person');
    await page.getByLabel('Script reading area', { exact: true }).evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('Markdown errors and cancel preserve the saved script and draft', async ({ page }) => {
  await openLibrary(page);
  await createPerformance(page);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Script Markdown' });
  await field.fill('# First\n# Second');
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Line 2' })).toBeVisible();
  await expect(field).toHaveValue('# First\n# Second');
  await page.getByRole('button', { name: 'Back to sections', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(field).toHaveValue('# First\n# Second');
  await page.getByRole('button', { name: 'Back to sections', exact: true }).click();
  await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Script Title', exact: true })).toHaveValue('Audition rehearsal');
});

test('AI Partner speaking hands back to In Person and cues remain visible in compact mirrored mode', async ({ page }) => {
  await page.addInitScript(() => {
    const scope = window as any;
    scope.__spoken = [];
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'test-local', name: 'Local test voice', lang: 'en-GB', localService: true }],
      speak: (utterance: any) => {
        scope.__spoken.push(utterance.text);
        scope.__activeUtterance = utterance;
        scope.__finishSpeech = () => utterance.onend();
      },
      cancel: () => {},
    } });
  });
  await openLibrary(page);
  await page.evaluate(() => {
    const character = (id: string, name: string, accentColor: string) => ({ id, name, accentColor, age: '', gender: '', style: '', voice: { engine: 'system', voiceId: 'test-local', rate: 1 } });
    const script = { id: 'cue-fixture', title: 'Cue rehearsal', purpose: 'performance', createdAt: 1, updatedAt: 1,
      actor: { enabled: true, characters: [character('alex', 'Alex', '#14b8a6'), character('jamie', 'Jamie', '#f59e0b')], myRoleIds: ['alex'] },
      sections: [
        { id: 'cue-one', title: 'Opening', content: 'Welcome home.', characterId: 'alex' },
        { id: 'cue-two', title: 'Response', content: 'I had to come back.', characterId: 'jamie' },
        { id: 'cue-three', title: 'Ending', content: 'Then let us start again.', characterId: 'alex' },
      ],
    };
    localStorage.setItem('quickque_scripts', JSON.stringify([script]));
    localStorage.setItem('quickque_active_script', script.id);
  });
  await page.goto(`${artifactPath}/edit`);
  await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
  await expect(page.getByLabel('Speaking now', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Up next', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start or resume scene', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
  await page.getByTitle('Next turn (Right Arrow)', { exact: true }).click();
  await expect(page.locator('[data-scene-current="true"]')).toHaveText('Jamie · AI Partner');
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['I had to come back.']);
  await page.evaluate(() => {
    const utterance = (window as any).__activeUtterance;
    utterance?.onboundary?.({ name: 'word', charIndex: 2, charLength: 3 });
  });
  await expect(page.locator('[data-spoken-word="active"]')).toHaveText('had');
  await page.evaluate(() => (window as any).__finishSpeech());
  await expect(page.locator('[data-scene-current="true"]')).toHaveText('Alex · In Person');
  await page.getByRole('button', { name: 'Pause rehearsal', exact: true }).click();
  await page.getByRole('button', { name: 'Open rehearsal settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Mirror Horizontal', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Mirror Vertical', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle Compact Overlay', exact: true }).click();
  await page.setViewportSize({ width: 500, height: 400 });
  await expect(page.getByLabel('Speaking now')).toHaveCount(0);
  await expect(page.getByLabel('Up next')).toHaveCount(0);
  const reading = await page.getByLabel('Script reading area', { exact: true }).boundingBox();
  expect(reading!.height).toBeGreaterThan(100);
  await expect(page.getByText('Then let us start again.', { exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: '/tmp/quickque-cues-compact.png' });
});

test('Markdown storage failure retains the draft and supports retry', async ({ page }) => {
  await openLibrary(page);
  await createPerformance(page);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Script Markdown' });
  await field.fill('# Keep this draft\n## Opening\n\nSaved after retry.');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).__restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === 'quickque_scripts') throw new DOMException('Storage full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your Markdown draft is still here' })).toBeVisible();
  await expect(field).toHaveValue('# Keep this draft\n## Opening\n\nSaved after retry.');
  await page.evaluate(() => (window as any).__restoreStorage());
  await page.getByRole('button', { name: 'Save script', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved. Cast assignments' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to sections', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Script Title', exact: true })).toHaveValue('Keep this draft');
});

test('Matilda sample opens as an independent performance with roles, colours and notes', async ({ page }) => {
  await openLibrary(page);
  await page.getByRole('button', { name: 'New script', exact: true }).click();
  await page.getByRole('button', { name: 'Try Matilda sample' }).click();
  await expect(page.getByRole('textbox', { name: 'Script Title', exact: true })).toHaveValue('Matilda · Classroom sample');
  await expect(page.getByRole('combobox', { name: 'Script type' })).toHaveValue('performance');
  await expect(page.getByRole('combobox', { name: 'Character for turn 1', exact: true }).locator('option:checked')).toHaveText('Nigel · AI Partner');
  await expect(page.getByRole('combobox', { name: 'Character for turn 9', exact: true }).locator('option:checked')).toHaveText('Matilda · In Person');
  await expect(page.getByRole('textbox', { name: 'Turn content for "2. Miss Honey"' })).toHaveValue('Very well, Nigel.');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Script Markdown' })).toHaveValue(/> After this line: NIGEL opens his mouth/);
  await page.getByRole('button', { name: 'Back to sections', exact: true }).click();
  await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Who performs Matilda?', exact: true }).getByRole('button', { name: 'In Person', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Who performs Miss Honey?', exact: true }).getByRole('button', { name: 'AI Partner', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Colour for Matilda', { exact: true })).toHaveValue('#c084fc');
  await page.getByRole('button', { name: 'Close scene partner cast' }).click();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Script Title', exact: true })).toHaveValue('Matilda · Classroom sample');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quickque_scripts')!).scripts.length)).toBe(2);
});

test('voice preview explains missing selection and refresh confirms the installed list', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ voiceURI: 'test-local', name: 'Local test voice', lang: 'en-GB', localService: true }],
      speak: (utterance: any) => { queueMicrotask(() => utterance.onerror({ error: 'synthesis-failed' })); },
      cancel: () => {},
    } });
  });
  await openLibrary(page);
  await createPerformance(page);
  await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
  await page.getByRole('button', { name: 'Add Character', exact: true }).click();
  await page.getByRole('button', { name: 'Preview voice for New Character', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'SCENE_SPEECH_VOICE_REQUIRED' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh voices', exact: true }).first().click();
  await expect(page.getByRole('status').filter({ hasText: '1 installed voice found' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'SCENE_SPEECH_VOICE_REQUIRED' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Voice Selection', exact: true }).selectOption('test-local');
  await page.getByRole('button', { name: 'Preview voice for New Character', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'synthesis-failed' })).toBeVisible();
});

test('free Chatterbox voice can be assigned and persists without enabling browser synthesis', async ({ page }) => {
  await openLibrary(page);
  await createPerformance(page);
  await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
  await page.getByRole('button', { name: 'Add Character', exact: true }).click();
  await page.getByRole('combobox', { name: 'Voice Engine', exact: true }).selectOption('turbo');
  await expect(page.getByText('Chatterbox Turbo · Free local voice', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Installation is available in the Quickque Mac app.' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Voice Selection', exact: true })).toHaveValue('chatterbox-turbo:default-en');
  await page.getByRole('button', { name: 'Preview voice for New Character', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'SCENE_SPEECH_TURBO_UNSUPPORTED' })).toBeVisible();
  await page.getByRole('button', { name: 'Close scene partner cast' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
  await page.getByRole('button', { name: 'Edit New Character', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Voice Engine', exact: true })).toHaveValue('turbo');
  await expect(page.getByRole('combobox', { name: 'Voice Selection', exact: true })).toHaveValue('chatterbox-turbo:default-en');
});

test('guided practice bounds a passage, hides only learner dialogue, and saves private review', async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(() => {
    const character = (id: string, name: string) => ({
      id, name, age: '', gender: '', style: '',
      voice: { engine: 'turbo', voiceId: '', rate: 1 },
    });
    const script = {
      id: 'practice-fixture',
      title: 'Practice fixture',
      purpose: 'performance',
      createdAt: 1,
      updatedAt: 1,
      actor: {
        enabled: true,
        characters: [character('learner', 'Learner'), character('friend', 'Friend')],
        myRoleIds: ['learner', 'friend'],
        roleAssignments: { learner: 'my-role', friend: 'another-person' },
      },
      sections: [
        { id: 'turn-one', title: 'Cue', content: 'Are you ready?', characterId: 'friend', notes: 'Wait for the bell.', notesProvenance: 'writer' },
        { id: 'turn-two', title: 'Answer', content: 'I have been ready all morning.', characterId: 'learner' },
        { id: 'turn-three', title: 'Exit', content: 'Then let us go.', characterId: 'learner' },
      ],
    };
    localStorage.setItem('quickque_scripts', JSON.stringify([script]));
    localStorage.setItem('quickque_active_script', script.id);
  });
  await page.goto(`${artifactPath}/edit`);
  await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
  const flowSetup = page.getByRole('heading', { name: 'Voice Follow setup', exact: true });
  if (await flowSetup.isVisible()) await page.getByRole('button', { name: 'Cancel Setup' }).click();
  await page.getByRole('button', { name: 'Open guided practice' }).click();
  await page.getByLabel('Try without my lines').check();
  await page.getByText('From turn').locator('select').selectOption('1');
  await page.getByText('To turn').locator('select').selectOption('1');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Start or resume scene' }).click();
  const hiddenLine = page.getByLabel('Your dialogue is hidden');
  await expect(hiddenLine).toBeVisible();
  await expect(hiddenLine.locator('[aria-hidden="true"].text-transparent')).toContainText('I have been ready all morning.');
  await expect(page.getByText('Then let us go.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal my line' }).click();
  await expect(page.getByText('I have been ready all morning.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as difficult' }).click();
  await page.getByRole('textbox', { name: 'Private reflection' }).fill('Pause before the final phrase.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.getByTitle('Next turn (Right Arrow)').click();
  await expect(page.getByRole('heading', { name: 'Passage complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Repeat this passage' }).click();
  await expect(page.getByLabel('Your dialogue is hidden')).toBeVisible();

  const stored = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('quickque_scripts')!);
    return Array.isArray(raw) ? raw[0] : raw.scripts[0];
  });
  expect(stored.sections[0].notes).toBe('Wait for the bell.');
  expect(stored.sections[1].content).toBe('I have been ready all morning.');
  expect(stored.practice.difficultSectionIds).toEqual(['turn-two']);
  expect(stored.personalNotes[0]).toMatchObject({
    sectionId: 'turn-two',
    content: 'Pause before the final phrase.',
  });
});
