import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.use({
  baseURL: process.env.QUICKQUE_URL ?? 'http://127.0.0.1:80',
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
  },
});

function script(presentation: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 'presentation-timing',
    title: 'Presentation timing fixture',
    createdAt: now,
    updatedAt: now,
    presentation: {
      countdownSeconds: 0,
      targetDurationSeconds: null,
      speed: 120,
      ...presentation,
    },
    sections: [{
      id: 'timing-section-1',
      title: 'Timing section',
      content: Array.from({ length: 36 }, (_, i) =>
        `TIMING_ANCHOR_${i + 1} presentation regression paragraph.`
      ).join('\n\n'),
    }],
  };
}

async function openReader(page: Page, presentation: Record<string, unknown> = {}) {
  const value = script(presentation);
  await page.goto('/');
  await page.evaluate((value) => {
    localStorage.setItem('quickque_scripts', JSON.stringify([value]));
    localStorage.setItem('quickque_active_script', value.id);
    localStorage.setItem('quickque_profile', JSON.stringify({
      name: 'Presentation regression tester', onboardingComplete: true,
    }));
    localStorage.setItem('quickque-flow-setup-done', 'true');
  }, value);
  await page.goto(`/read/${value.id}`);
  await page.getByRole('combobox').first().selectOption('manual');
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
}

async function openEdgeReader(page: Page, value = script()) {
  await page.goto('/');
  await page.evaluate((value) => {
    localStorage.setItem('quickque_scripts', JSON.stringify([value]));
    localStorage.setItem('quickque_active_script', value.id);
    localStorage.setItem('quickque_profile', JSON.stringify({
      name: 'Presentation edge tester', onboardingComplete: true,
    }));
    localStorage.setItem('quickque-flow-setup-done', 'true');
    localStorage.removeItem('quickque_reader_resume');
  }, value);
  await page.goto(`/read/${value.id}`);
}

test('countdown can be cancelled by button and Space without movement or active time', async ({ page }) => {
  await openReader(page, { countdownSeconds: 3 });
  const scroller = page.locator('div.absolute.inset-0.overflow-y-auto');
  const before = await scroller.evaluate((e: HTMLElement) => e.scrollTop);
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByText('Cancel countdown')).toBeVisible();
  await expect(page.getByText('Elapsed')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel countdown' }).click();
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  await expect(page.getByText('00:00')).toBeVisible();
  expect(await scroller.evaluate((e: HTMLElement) => e.scrollTop)).toBe(before);

  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByText('Cancel countdown')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  await expect(page.getByText('00:00')).toBeVisible();
});

test('ordinary resume starts without another countdown and pause freezes HUD', async ({ page }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Pause presentation' }).click();
  const elapsed = await page.locator('text=/^\\d\\d:\\d\\d$/').first().textContent();
  const progress = await page.locator('text=/%$/').first().textContent();
  await page.waitForTimeout(700);
  expect(await page.locator('text=/^\\d\\d:\\d\\d$/').first().textContent()).toBe(elapsed);
  expect(await page.locator('text=/%$/').first().textContent()).toBe(progress);
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByText('Cancel countdown')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toBeVisible();
});

test('target duration completes and controls survive reflow and local speed override', async ({ page }) => {
  // The fixture is deliberately long enough that the controller's 3000px/s
  // safety limit is not the condition under test.
  await openReader(page, { targetDurationSeconds: 10 });
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toBeVisible();
  await page.waitForTimeout(10800);
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();

  await page.getByRole('button', { name: 'Open present settings' }).click();
  await expect(page.getByRole('slider', { name: 'Font Size' })).toBeVisible();
  await page.getByRole('slider', { name: 'Font Size' }).fill('52');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 420 });
  await expect(page.getByRole('button', { name: 'Open present settings' })).toBeVisible();
  await page.getByText('Start over', { exact: true }).last().click();
  await expect(page.getByText('00:00')).toBeVisible();
  await page.screenshot({ path: 'test-results/presentation-timing-final.png', fullPage: true });
});

test('interactive controls consume Space without toggling global playback twice', async ({ page }) => {
  await openReader(page);
  const settings = page.getByRole('button', { name: 'Open present settings' });
  await settings.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
});

test('reopen offers Resume and restores the logical position paused after typography reflow', async ({ page }) => {
  await openReader(page);
  const scroller = page.locator('div.absolute.inset-0.overflow-y-auto');
  await scroller.evaluate((e: HTMLElement) => {
    e.scrollTop = Math.round((e.scrollHeight - e.clientHeight) * 0.45);
  });
  await page.waitForTimeout(1200);
  const savedTop = await scroller.evaluate((e: HTMLElement) => e.scrollTop);
  expect(savedTop).toBeGreaterThan(0);
  await page.goto('/read/presentation-timing');
  await expect(page.getByRole('dialog')).toContainText('Continue this script?');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  expect(await scroller.evaluate((e: HTMLElement) => e.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Open present settings' }).click();
  await page.getByRole('slider', { name: 'Font Size' }).fill('58');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
});

test('wheel input interrupts automatic manual scrolling and leaves playback paused', async ({ page }) => {
  await openReader(page, { pauseOnManualScroll: true, speed: 120 });
  const scroller = page.locator('div.absolute.inset-0.overflow-y-auto');
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toBeVisible();
  await page.waitForTimeout(300);
  await scroller.hover();
  await page.mouse.wheel(0, 450);
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  const pausedTop = await scroller.evaluate((e: HTMLElement) => e.scrollTop);
  await page.waitForTimeout(500);
  expect(await scroller.evaluate((e: HTMLElement) => e.scrollTop)).toBe(pausedTop);
});

test('native CustomEvent toggles countdown, and leaving the reader cancels countdown/unmount', async ({ page }) => {
  await openReader(page, { countdownSeconds: 3 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('quickque:control', { detail: 'toggle' })));
  await expect(page.getByText('Cancel countdown')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('quickque:control', { detail: 'toggle' })));
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByText('Cancel countdown')).toBeVisible();
  await page.goto('/');
  await page.goto('/read/presentation-timing');
  await page.getByRole('combobox').first().selectOption('manual');
  await expect(page.getByText('Cancel countdown')).toHaveCount(0);
  await expect(page.getByText('00:00')).toBeVisible();
});

test('hiding clocks and controls is reversible, and speed override exits timed mode with feedback', async ({ page }) => {
  await openReader(page, {
    showTiming: false,
    hideControlsWhilePlaying: true,
    targetDurationSeconds: 30,
  });
  await expect(page.getByLabel('Presentation elapsed time')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toBeVisible();
  await page.waitForTimeout(3400);
  await expect(page.getByRole('button', { name: 'Show controls' })).toBeVisible();
  await page.mouse.move(200, 200);
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toBeVisible();
  await page.locator('input[title="Scroll Speed"]').fill('130');
  await expect(page.getByRole('status')).toContainText('Timed scrolling turned off');
});

test('manual timing uses the wrapped copy trailing edge and includes a title-only final section', async ({ page }) => {
  const value = script({ speed: 150, targetDurationSeconds: 5 });
  value.sections = [
    {
      id: 'emoji-section',
      title: 'Emoji and punctuation',
      content: `${'😀!? '.repeat(220)}\n\n${'…—,. '.repeat(220)}`,
    },
    { id: 'title-only-section', title: 'Final title only', content: '' },
  ];
  await openEdgeReader(page, value);
  await page.getByRole('combobox').first().selectOption('manual');
  const scroller = page.locator('div.absolute.inset-0.overflow-y-auto');
  const cue = page.locator('div.absolute.left-0.right-0.h-0.z-30');
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible({ timeout: 9000 });
  const geometry = await page.evaluate(() => {
    const scroller = document.querySelector('div.absolute.inset-0.overflow-y-auto')!;
    const cue = document.querySelector('div.absolute.left-0.right-0.h-0.z-30')!;
    const blocks = [...document.querySelectorAll('div.max-w-4xl.mx-auto > div')];
    const tail = blocks[blocks.length - 1]?.getBoundingClientRect();
    const cueRect = cue.getBoundingClientRect();
    return {
      scrollTop: (scroller as HTMLElement).scrollTop,
      maxScroll: (scroller as HTMLElement).scrollHeight - (scroller as HTMLElement).clientHeight,
      tailBottom: tail?.bottom ?? 0,
      cueTop: cueRect.top,
      blocks: blocks.length,
    };
  });
  expect(geometry.blocks).toBe(2);
  expect(geometry.tailBottom).toBeLessThanOrEqual(geometry.cueTop + 2);
});

test('completed playback can rewind, resume, and reopens as an active Resume rather than completed', async ({ page }) => {
  const value = script({ speed: 150, targetDurationSeconds: 5, pauseOnManualScroll: false });
  value.sections = [{
    id: 'completion-section',
    title: 'Completion section',
    content: `${'completion boundary '.repeat(180)}\n\n${'final trailing block '.repeat(90)}`,
  }];
  await openEdgeReader(page, value);
  await page.getByRole('combobox').first().selectOption('manual');
  const scroller = page.locator('div.absolute.inset-0.overflow-y-auto');
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByText('100%')).toBeVisible({ timeout: 9000 });
  const completedTop = await scroller.evaluate((e: HTMLElement) => e.scrollTop);
  await scroller.hover();
  await page.mouse.wheel(0, 500); // outward at the end: no actual displacement
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('Script completed');
  await page.getByRole('dialog').getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('combobox').first().selectOption('manual');
  await page.getByRole('button', { name: 'Play presentation' }).click();
  await expect(page.getByText('100%')).toBeVisible({ timeout: 9000 });
  await scroller.hover();
  await page.mouse.wheel(0, -500); // actual backward displacement clears completed
  await page.waitForTimeout(1200);
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('Continue this script?');
  await expect(page.getByRole('dialog')).not.toContainText('Script completed');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Play presentation' })).toBeVisible();
  expect(await scroller.evaluate((e: HTMLElement) => e.scrollTop)).toBeGreaterThan(0);
});

test('unsupported browser Flow stays unsupported when Start over is pressed', async ({ page }) => {
  await openEdgeReader(page);
  await expect(page.getByText('Voice Following')).toBeVisible();
  await expect(page.getByText('browser preview supports manual reading only')).toBeVisible();
  await page.getByText('Start over', { exact: true }).last().click();
  await expect(page.getByText('Voice Following')).toBeVisible();
  await expect(page.getByText('browser preview supports manual reading only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause presentation' })).toHaveCount(0);
});