import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.use({ baseURL: process.env.QUICKQUE_URL ?? 'http://127.0.0.1:80', launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined) } });
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('quickque_profile', JSON.stringify({ name: 'Ross', onboardingComplete: true }));
    localStorage.setItem('quickque-flow-setup-done', 'true');
    localStorage.setItem('quickque_settings', JSON.stringify({ darkTheme: false }));
    localStorage.setItem('quickque_scripts', JSON.stringify([
      { id: 'talk', title: 'All hands', purpose: 'presentation', createdAt: 1, updatedAt: 1, sections: [{ id: 'one', title: 'Opening', content: 'Welcome everyone. Today we look at what comes next.' }] },
      { id: 'scene', title: 'Audition', purpose: 'performance', createdAt: 2, updatedAt: 2, actor: { enabled: true, characters: [], myRoleIds: [] }, sections: [{ id: 'two', title: 'Opening', content: 'I thought you would be here.' }] },
    ]));
    localStorage.setItem('quickque_active_script', 'scene');
  });
  await page.reload();
}
for (const width of [390, 1440]) {
  test(`workspace opens scripts directly for editing or playback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await seed(page);
    await expect(page.getByRole('heading', { name: 'Your scripts', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Script Title', exact: true })).toHaveCount(0);
    const card = page.getByRole('article', { name: 'All hands', exact: true });
    if (width < 768) expect((await card.boundingBox())!.width).toBeGreaterThan(300);
    await card.getByRole('button', { name: 'Edit All hands', exact: true }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByRole('textbox', { name: 'Script Title', exact: true })).toHaveValue('All hands');
    if (width >= 768) {
      await page.getByRole('button', { name: 'Collapse library', exact: true }).first().click();
      await expect(page.getByRole('button', { name: 'Show library', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Show library', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Show library', exact: true }).click();
    }
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Script Title', exact: true })).toHaveValue('All hands');
    await page.getByRole('button', { name: width < 768 ? 'Back to library' : 'Back to workspace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your scripts', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Present All hands', exact: true }).click();
    await expect(page).toHaveURL(/\/read\/talk$/);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your scripts', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('home search, sorting, trash and direct rehearsal setup work', async ({ page }) => {
  await seed(page);
  await page.getByRole('textbox', { name: 'Search scripts', exact: true }).fill('comes next');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search scripts', exact: true }).fill('');
  await page.getByRole('combobox', { name: 'Sort scripts', exact: true }).selectOption('az');
  await expect(page.getByRole('article').first()).toHaveAccessibleName('All hands');
  await expect(page.getByRole('button', { name: 'Rehearse Audition', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish setup Audition', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up Audition' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and leave', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Audition', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByRole('textbox', { name: 'Script Title', exact: true })).toHaveValue('Audition');
  await page.goto('/');
  await page.getByRole('article', { name: 'All hands', exact: true }).getByRole('button', { name: 'Options for All hands', exact: true }).click();
  await page.getByRole('menuitem', { name: /Move to Trash/ }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('article', { name: 'All hands', exact: true })).toHaveCount(0);
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(navigation.getByRole('button', { name: /Trash/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Trash, 1 deleted script', exact: true }).click();
  await expect(page).toHaveURL(/\/trash$/);
  await expect(page.getByRole('heading', { name: 'Trash', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'All hands', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to scripts', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('Your Voices is a first-class workspace destination', async ({ page }) => {
  await seed(page);
  const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
  await expect(navigation.getByRole('button', { name: 'Your Voices', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Your Voices', exact: true }).click();
  await expect(page).toHaveURL(/\/voices$/);
  await expect(page.getByRole('heading', { name: 'Your Voices', exact: true })).toBeVisible();
  await expect(page.getByText(/Create as many local voices as you like/i)).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Voices & audio' }).click();
  await expect(page.getByRole('button', { name: 'Open Your Voices', exact: true })).toBeVisible();
});

test('scripts can be pinned to a persistent top section', async ({ page }) => {
  await seed(page);
  const talk = page.getByRole('article', { name: 'All hands', exact: true });
  await talk.getByRole('button', { name: 'Options for All hands', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pin to top', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible();
  await expect(page.getByRole('article').first()).toHaveAccessibleName('All hands');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible();
  await expect(page.getByRole('article').first()).toHaveAccessibleName('All hands');
  await talk.getByRole('button', { name: 'Options for All hands', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Unpin from top', exact: true })).toBeVisible();
});

test('sections can be reordered by dragging while buttons remain available', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await seed(page);
  await page.getByRole('article', { name: 'All hands', exact: true }).getByRole('button', { name: 'Edit All hands', exact: true }).click();
  await page.getByRole('button', { name: 'Add Section', exact: true }).click();
  const titles = page.getByRole('textbox', { name: 'Section Title', exact: true });
  await titles.nth(1).fill('Closing');
  await expect(page.getByRole('button', { name: 'Move section "Opening" down', exact: true })).toBeVisible();
  const handle = page.getByRole('button', { name: 'Drag section "Opening" to reorder', exact: true });
  const target = page.getByTestId(/section-editor-/).nth(1);
  const handleBounds = await handle.boundingBox();
  const targetBounds = await target.boundingBox();
  if (!handleBounds || !targetBounds) throw new Error('Section drag controls are not visible.');
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height * 0.75, { steps: 8 });
  await page.mouse.up();
  await expect(titles.nth(0)).toHaveValue('Closing');
  await expect(titles.nth(1)).toHaveValue('Opening');
  await page.reload();
  await expect(titles.nth(0)).toHaveValue('Closing');
  await expect(titles.nth(1)).toHaveValue('Opening');
});

test('editor sidebar uses compact actions and expands search on demand', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await seed(page);
  await page.getByRole('article', { name: 'All hands', exact: true }).getByRole('button', { name: 'Edit All hands', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search scripts input', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New script', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import Document', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New script', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import document', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search scripts', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search scripts input', exact: true });
  await expect(search).toBeFocused();
  await search.fill('All hands');
  await expect(page.getByText('1 results', { exact: true })).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveCount(0);
});
