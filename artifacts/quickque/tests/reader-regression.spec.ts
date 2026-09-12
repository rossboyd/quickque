import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.use({
  baseURL: process.env.QUICKQUE_URL ?? 'http://127.0.0.1:80',
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH ??
      (existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined),
  },
});
const legacySettings = {
  fontSize: 37, speed: 27, backgroundOpacity: 68, darkTheme: true,
  compactMode: false, textColor: null, fontFamily: 'georgia',
};

function fixture(id: string, title: string) {
  const now = Date.now();
  return {
    id, title, createdAt: now, updatedAt: now,
    sections: Array.from({ length: 5 }, (_, section) => ({
      id: `${id}-sec-${section + 1}`,
      title: `${title} Section ${section + 1}`,
      content: Array.from({ length: 28 }, (_, line) =>
        `${title} UNIQUE_${id}_${section + 1}_${line + 1} line ${line + 1} anchor paragraph.`,
      ).join('\n\n'),
    })),
  };
}

async function seed(page: Page) {
  const scripts = [fixture('fixture-alpha', 'Fixture Alpha'), fixture('fixture-beta', 'Fixture Beta')];
  await page.goto('/');
  await page.evaluate(({ scripts, legacySettings }) => {
    localStorage.setItem('quickque_scripts', JSON.stringify(scripts));
    localStorage.setItem('quickque_active_script', 'fixture-alpha');
    localStorage.setItem('quickque_settings', JSON.stringify(legacySettings));
    localStorage.setItem('quickque_profile', JSON.stringify({
      name: 'Regression Tester', onboardingComplete: true,
    }));
    localStorage.setItem('quickque-flow-setup-done', 'true');
    localStorage.removeItem('quickque_presentation_defaults');
  }, { scripts, legacySettings });
  await page.reload();
}

async function settleLayout(page: Page) {
  // ResizeObserver and React's responsive layout commit after the resize event;
  // the control surfaces also have 300 ms CSS transitions.
  await page.waitForTimeout(350);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function anchorGeometry(page: Page, id: string, verticalOverride?: boolean) {
  return page.evaluate(({ id, verticalOverride }) => {
    const scroller = document.querySelector('div.absolute.inset-0.overflow-y-auto');
    const cue = document.querySelector('div.absolute.left-0.right-0.h-0.z-30');
    const anchor = document.querySelector(`[data-reader-anchor="${id}"]`);
    const vertical = verticalOverride ?? JSON.parse(localStorage.quickque_scripts).scripts
      .find((s: { id: string }) => s.id === 'fixture-alpha').presentation.mirrorVertical;
    if (!scroller || !cue || !anchor) throw new Error('reader geometry elements missing');
    const cueRect = cue.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    // The zero-height cue uses its top as its center. In vertical mirror mode
    // leading is the logical bottom edge, matching reader.tsx.
    const logical = (rect: DOMRect) => vertical
      ? innerHeight - rect.bottom : rect.top;
    const guide = logical(cueRect);
    return {
      scrollTop: scroller.scrollTop, anchorId: id,
      offset: logical(anchorRect) - guide,
      physicalOffset: anchorRect.top - cueRect.top,
      leadingOffset: (vertical ? anchorRect.bottom : anchorRect.top) - cueRect.top,
      vertical,
    };
  }, { id, verticalOverride });
}

async function headingGeometry(page: Page, index: number) {
  return page.evaluate((index) => {
    const cue = document.querySelector('div.absolute.left-0.right-0.h-0.z-30');
    const heading = document.querySelectorAll('h3')[index];
    const vertical = JSON.parse(localStorage.quickque_scripts).scripts
      .find((s: { id: string }) => s.id === 'fixture-alpha').presentation.mirrorVertical;
    if (!cue || !heading) throw new Error('section heading geometry missing');
    const guideRect = cue.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const logical = (rect: DOMRect) => vertical ? innerHeight - rect.bottom : rect.top;
    return { offset: logical(headingRect) - logical(guideRect) };
  }, index);
}

async function nearestVisibleAnchor(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('div.absolute.inset-0.overflow-y-auto');
    const cue = document.querySelector('div.absolute.left-0.right-0.h-0.z-30');
    if (!scroller || !cue) throw new Error('reader geometry elements missing');
    const vertical = JSON.parse(localStorage.quickque_scripts).scripts
      .find((s: { id: string }) => s.id === 'fixture-alpha').presentation.mirrorVertical;
    const logical = (rect: DOMRect) => vertical
      ? innerHeight - rect.bottom : rect.top;
    const guide = logical(cue.getBoundingClientRect());
    const candidates = [...document.querySelectorAll<HTMLElement>('[data-reader-anchor]')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom >= 0 && rect.top <= innerHeight)
      .sort((a, b) => Math.abs(logical(a.rect) - guide) - Math.abs(logical(b.rect) - guide));
    const target = candidates[0];
    if (!target) throw new Error('no visible reader token anchor');
    return {
      id: target.element.dataset.readerAnchor ?? '',
      offset: logical(target.rect) - guide,
      scrollTop: scroller.scrollTop,
    };
  });
}

test('reader preserves a saved middle token through mirrors, wheel, resize, and compact mode', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.locator('select').first().selectOption({ label: 'Manual Scroll' });

  const sectionSelect = page.locator('select').nth(1);
  await sectionSelect.selectOption({ label: '1. Fixture Alpha Section 1' });
  await settleLayout(page);
  // The section heading is the section top; the first body token is below it.
  const firstTop = await headingGeometry(page, 0);
  expect(Math.abs(firstTop.offset)).toBeLessThanOrEqual(2);
  await sectionSelect.selectOption({ label: '5. Fixture Alpha Section 5' });
  await settleLayout(page);
  const lastTop = await headingGeometry(page, 4);
  expect(Math.abs(lastTop.offset)).toBeLessThanOrEqual(2);
  expect(await sectionSelect.inputValue()).toBe('4');
  await sectionSelect.selectOption({ label: '1. Fixture Alpha Section 1' });
  await settleLayout(page);
  expect(await sectionSelect.inputValue()).toBe('0');

  const scroller = page.locator('div.absolute.inset-0.overflow-y-auto');
  await scroller.evaluate((element: HTMLElement) => {
    element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) / 2);
  });
  await settleLayout(page);
  const saved = await nearestVisibleAnchor(page);
  expect(saved.id).toContain('fixture-alpha-sec-');

  await page.getByRole('button', { name: 'Open present settings' }).click();
  const hBox = page.getByRole('checkbox', { name: 'Mirror Horizontal' });
  const vBox = page.getByRole('checkbox', { name: 'Mirror Vertical' });
  const states = [
    { name: 'none', h: false, v: false },
    { name: 'horizontal', h: true, v: false },
    { name: 'vertical', h: false, v: true },
    { name: 'combined', h: true, v: true },
  ] as const;
  const measurements = [];
  for (const state of states) {
    state.h ? await hBox.check() : await hBox.uncheck();
    state.v ? await vBox.check() : await vBox.uncheck();
    await settleLayout(page);
    const current = await anchorGeometry(page, saved.id);
    measurements.push({ ...state, ...current });
    console.log(JSON.stringify({ saved, state, current }));
  }
  for (const measurement of measurements) {
    expect.soft(measurement.anchorId).toBe(saved.id);
    // offset has ALREADY been mapped into logical coordinates above.
    const expectedOffset = saved.offset;
    expect.soft(Math.abs(measurement.offset - expectedOffset)).toBeLessThanOrEqual(2);
  }
  expect.soft(Math.sign(measurements[2].leadingOffset))
    .toBe(-Math.sign(measurements[0].leadingOffset));

  // Each adjustment preserves the word at the cue at the time of that change.
  for (const [label, value] of [
    ['Font Size', '52'],
    ['Line Spacing', '2.2'],
    ['Horizontal Margin', '18'],
    ['Vertical Position', '10'],
    ['Vertical Position', '80'],
  ]) {
    const beforeChange = await nearestVisibleAnchor(page);
    await page.getByRole('slider', { name: label, exact: true }).fill(value);
    await settleLayout(page);
    const afterChange = await anchorGeometry(page, beforeChange.id, true);
    expect(Math.abs(afterChange.offset - beforeChange.offset), label).toBeLessThanOrEqual(2);
  }

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const before = await scroller.evaluate((e: HTMLElement) => e.scrollTop);
  await scroller.hover();
  await page.mouse.wheel(0, 700);
  await settleLayout(page);
  const after = await scroller.evaluate((e: HTMLElement) => e.scrollTop);
  expect(after).toBeGreaterThan(before);
  // Scrolling intentionally changes the current word. Capture the new reading
  // location before resizing; the old, now off-cue word is not the anchor.
  const resizeAnchor = await nearestVisibleAnchor(page);

  await page.setViewportSize({ width: 360, height: 260 });
  await settleLayout(page);
  const afterResize = await anchorGeometry(page, resizeAnchor.id, true);
  console.log(JSON.stringify({ phase: 'resize', resizeAnchor, afterResize }));
  expect.soft(Math.abs(afterResize.offset - resizeAnchor.offset)).toBeLessThanOrEqual(2);
  const compactAnchor = await nearestVisibleAnchor(page);
  await page.getByRole('button', { name: 'Toggle Compact Overlay' }).click();
  await settleLayout(page);
  const afterCompact = await anchorGeometry(page, compactAnchor.id, true);
  console.log(JSON.stringify({ phase: 'compact', compactAnchor, afterCompact }));
  expect.soft(Math.abs(afterCompact.offset - compactAnchor.offset)).toBeLessThanOrEqual(2);
  await expect(page.getByRole('button', { name: 'Open present settings' })).toBeVisible();
});