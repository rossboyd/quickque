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
