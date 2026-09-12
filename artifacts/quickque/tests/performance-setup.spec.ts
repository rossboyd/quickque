import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.use({
  baseURL: process.env.QUICKQUE_URL ?? 'http://127.0.0.1:80',
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
  },
});

async function openLibrary(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Performance Tester', onboardingComplete: true }));
    localStorage.setItem('quickque-flow-setup-done', 'true');
  });
  await page.reload();
}

async function createPerformance(page: Page) {
  await page.getByRole('button', { name: 'New script', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What are you preparing?' })).toBeVisible();
  await page.getByRole('button', { name: 'Performance / Self-tape' }).click();
  await expect(page.getByRole('combobox', { name: 'Script type' })).toHaveValue('performance');
  await page.getByRole('textbox', { name: 'Script Title', exact: true }).fill('Audition rehearsal');
}

for (const width of [390, 1280]) {
  test(`performance purpose survives audio toggle and reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openLibrary(page);
    await createPerformance(page);
    await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Turn', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
    await page.getByRole('switch', { name: 'Partner audio' }).click();
    await page.getByRole('button', { name: 'Close scene partner cast' }).click();
    await page.reload();
    if (width < 768) await page.getByRole('button', { name: 'Audition rehearsal', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Script type' })).toHaveValue('performance');
    await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
    await expect(page.getByRole('switch', { name: 'Partner audio' })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Close scene partner cast' }).click();
    await page.getByRole('combobox', { name: 'Script type' }).selectOption('presentation');
    await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Section', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Script type' }).selectOption('performance');
    await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toBeVisible();
    const action = await page.getByRole('button', { name: 'Rehearse', exact: true }).boundingBox();
    expect(action!.x).toBeGreaterThanOrEqual(0);
    expect(action!.x + action!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('incomplete performance blocks rehearsal with actionable setup links', async ({ page }) => {
  await openLibrary(page);
  await createPerformance(page);
  await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Finish setting up your performance' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/read\//);
  await page.getByRole('button', { name: /Add your cast in Scene Partner setup/ }).click();
  await expect(page.getByRole('button', { name: 'Add Character', exact: true })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`Markdown, cast colours and persistent rehearsal cues at ${width}px`, async ({ page }) => {
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
    if (width < 768) await page.getByRole('button', { name: 'The return', exact: true }).click();
    await page.getByRole('button', { name: 'Scene Partner setup', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Who performs Alex?', exact: true }).getByRole('button', { name: 'In Person', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Colour for Alex', { exact: true })).toHaveValue('#14b8a6');
    await page.getByRole('button', { name: 'Close scene partner cast' }).click();
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
    const now = page.getByLabel('Speaking now', { exact: true });
    const next = page.getByLabel('Up next', { exact: true });
    await expect(now).toContainText('Alex');
    await expect(now).toContainText('In Person');
    await expect(now).toHaveCSS('border-left-color', 'rgb(20, 184, 166)');
    await expect(next).toContainText('Jamie');
    await expect(next).toContainText('I had to come back.');
    await expect(next).toHaveCSS('border-left-color', 'rgb(245, 158, 11)');
    await page.getByRole('button', { name: 'Start or resume scene', exact: true }).click();
    await expect(page.getByLabel('Rehearsal cues', { exact: true })).toHaveAttribute('data-scene-phase', 'waiting');
    await page.getByTitle('Next turn (Right Arrow)', { exact: true }).click();
    await expect(now).toContainText('Jamie');
    await expect(next).toContainText('End of scene');
    await page.getByRole('button', { name: 'Previous turn (Left Arrow)', exact: true }).click();
    await expect(now).toContainText('Alex');
    await page.getByLabel('Script reading area', { exact: true }).evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(now).toBeInViewport();
    await expect(next).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/quickque-cues-${width}.png` });
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
      speak: (utterance: any) => { scope.__spoken.push(utterance.text); scope.__finishSpeech = () => utterance.onend(); },
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
  await page.reload();
  await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
  const now = page.getByLabel('Speaking now', { exact: true });
  const next = page.getByLabel('Up next', { exact: true });
  await expect(now).toContainText('In Person');
  await expect(next).toContainText('AI Partner');
  await page.getByRole('button', { name: 'Start or resume scene', exact: true }).click();
    await expect(page.getByLabel('Rehearsal cues', { exact: true })).toHaveAttribute('data-scene-phase', 'waiting');
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]);
  await page.getByTitle('Next turn (Right Arrow)', { exact: true }).click();
  await expect(now).toContainText('Jamie');
  await expect(now).toContainText('AI Partner');
  await expect(now).toContainText('Speaking');
  await expect(next).toContainText('Alex');
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual(['I had to come back.']);
  await page.evaluate(() => (window as any).__finishSpeech());
  await expect(now).toContainText('Alex');
  await expect(now).toContainText('Your turn');
  await page.getByRole('button', { name: 'Pause rehearsal', exact: true }).click();
  await page.getByRole('button', { name: 'Open rehearsal settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Mirror Horizontal', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Mirror Vertical', exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle Compact Overlay', exact: true }).click();
  await page.setViewportSize({ width: 500, height: 400 });
  await expect(now).toBeInViewport();
  await expect(next).toBeInViewport();
  await expect(page.getByLabel('Rehearsal cues').locator(':scope > div')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
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
  await expect(page.getByText('Open the Quickque Mac app to download and use Chatterbox.', { exact: true })).toBeVisible();
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
