import fs from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('../config/site.json', import.meta.url), 'utf8'));
const file = new URL('README.md', root);
const text = await fs.readFile(file, 'utf8');
const pattern = /<!-- source-build:start -->[\s\S]*?<!-- source-build:end -->/;
if (!pattern.test(text)) throw new Error('README is missing its source-build markers');
const replacement = `<!-- source-build:start -->\n\`\`\`sh\n${config.sourceCommand}\n\`\`\`\n<!-- source-build:end -->`;
const updated = text.replace(pattern, replacement);
if (process.argv.includes('--check')) {
  if (updated !== text) throw new Error('README source instructions drifted. Run node artifacts/quickque-website/scripts/sync-readme.mjs');
} else {
  await fs.writeFile(file, updated);
}