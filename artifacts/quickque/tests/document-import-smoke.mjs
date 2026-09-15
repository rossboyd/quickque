import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

/**
 * Reusable browser regression routine. Supply an isolated Playwright Page and
 * the running app's base URL from your browser test harness. No API, account,
 * upload service, or browser-test dependency is added to the shipped app.
 */
export async function documentImportSmoke(page, baseURL) {
  const fixture = fileURLToPath(new URL('../src/lib/document-import/fixtures/tiny-unicode.docx', import.meta.url));
  const title = `Import smoke ${randomUUID()}`;
  const text = '  Hello — 世界\n\nSecond paragraph.\n<script>literal, not code</script>  ';
  const stored = () => page.evaluate(() => localStorage.getItem('quickque_scripts'));
  const openReview = async () => {
    await page.getByRole('button', { name: 'Import Document', exact: true }).click();
    await page.locator('input[type=file][accept*=".docx"]').setInputFiles(fixture);
    await page.getByRole('button', { name: 'Performance / scene', exact: false }).waitFor();
  };
  await page.goto(baseURL);
  await page.getByRole('button', { name: 'Import Document', exact: true }).waitFor();
  const original = await stored();
  await openReview();
  const extractedText = await page.locator('#import-text').inputValue();
  assert.match(extractedText, /世界/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await stored(), original, 'Review cancellation must not write anything');
  await page.getByRole('button', { name: 'Import Document', exact: true }).click();
  await page.getByRole('textbox', { name: 'Paste script content' }).fill('Opening prose.\n\nSecond paragraph.');
  await page.getByRole('button', { name: 'Review pasted content', exact: true }).click();
  await page.getByRole('button', { name: 'Performance / scene', exact: false }).click();
  const unresolvedSave = page.getByRole('button', { name: 'Save and continue to setup', exact: true });
  assert.equal(await unresolvedSave.isDisabled(), true, 'Unresolved performance structure must not save');
  await page.getByRole('button', { name: 'Split into paragraph turns', exact: true }).click();
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  for (const speaker of await page.getByRole('combobox', { name: /Speaker for turn/ }).all()) {
    await speaker.selectOption({ label: 'Character 1' });
  }
  assert.equal(await unresolvedSave.isEnabled(), true, 'Manual turn assignments should resolve the review');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await stored(), original, 'Manual review cancellation must not write anything');
  await openReview();
  await page.locator('#import-title').fill(title);
  await page.getByRole('button', { name: 'Presentation', exact: true }).click();
  await page.getByRole('button', { name: 'Save presentation', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const imported = JSON.parse(await stored());
  const script = imported.scripts.find(item => item.id === imported.activeScriptId);
  assert.equal(script.title, title);
  assert.equal(script.sections[0].content, extractedText);
  assert.equal(script.importSource.originalText, extractedText);
  const edited = extractedText + '\n\nEdited after import.';
  await page.getByPlaceholder('Type your script here...').fill(edited);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.waitForURL(/\/read\//);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Import Document', exact: true }).waitFor();
  await page.reload();
  await page.getByPlaceholder('Script Title').waitFor();
  assert.equal(await page.getByPlaceholder('Script Title').inputValue(), title);
  assert.equal(await page.getByPlaceholder('Type your script here...').inputValue(), edited);
  const reloaded = JSON.parse(await stored());
  assert.equal(reloaded.activeScriptId, script.id);
}