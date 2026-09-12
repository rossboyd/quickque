/**
 * Reusable Playwright assertion for a paused Manual reader with a long script.
 * The caller supplies an already-open page; no native speech mock is involved.
 * Example: await verifyReaderFontAnchor(page, { nextFont: 'monospace' }).
 */
export async function verifyReaderFontAnchor(page, { nextFont = 'monospace' } = {}) {
  const before = await page.evaluate(() => {
    const copy = document.querySelector('[data-reader-anchor]');
    const container = copy?.closest('.overflow-y-auto');
    if (!container) throw new Error('Open a paused Manual reader before running this check.');
    const max = container.scrollHeight - container.clientHeight;
    if (max < container.clientHeight * 2) throw new Error('Use a longer script to exercise line reflow.');
    container.scrollTop = max * 0.4;
    const guideTop = container.getBoundingClientRect().top + container.clientHeight * 0.3;
    const spans = [...container.querySelectorAll('[data-reader-anchor]')];
    const anchor = spans.reduce((nearest, span) =>
      Math.abs(span.getBoundingClientRect().top - guideTop) <
      Math.abs(nearest.getBoundingClientRect().top - guideTop) ? span : nearest);
    return {
      id: anchor.dataset.readerAnchor,
      offset: anchor.getBoundingClientRect().top - guideTop,
      scrollHeight: container.scrollHeight,
    };
  });
  await page.getByRole('button', { name: 'Open script appearance settings' }).click();
  const font = page.getByRole('combobox', { name: 'Script font' });
  if (await font.inputValue() === nextFont) throw new Error('Choose a different font for the reflow check.');
  await font.selectOption(nextFont);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const after = await page.evaluate((id) => {
    const anchor = [...document.querySelectorAll('[data-reader-anchor]')]
      .find(span => span.dataset.readerAnchor === id);
    if (!anchor) throw new Error('The same word must survive the font change.');
    const container = anchor.closest('.overflow-y-auto');
    const guideTop = container.getBoundingClientRect().top + container.clientHeight * 0.3;
    return {
      offset: anchor.getBoundingClientRect().top - guideTop,
      scrollHeight: container.scrollHeight,
    };
  }, before.id);
  if (Math.abs(after.offset - before.offset) > 1) {
    throw new Error(`Reading word moved by ${after.offset - before.offset}px after reflow.`);
  }
  return { before, after };
}