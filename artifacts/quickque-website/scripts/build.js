import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadSiteDataSync } from '../lib/server/content.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  // Validate before invoking Vite so missing config, malformed origins, and a
  // release status other than "unavailable" fail closed without stale output.
  try {
    loadSiteDataSync(packageRoot);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to load website content.');
    process.exitCode = 1;
    return;
  }

  const clientCode = await run('pnpm', ['exec', 'vite', 'build', '--outDir', 'dist/client']);
  if (clientCode !== 0) {
    process.exitCode = clientCode;
    return;
  }

  const serverCode = await run('pnpm', [
    'exec', 'vite',
    'build',
    '--ssr',
    'src/entry-server.tsx',
    '--outDir',
    'dist/server'
  ]);
  if (serverCode !== 0) {
    process.exitCode = serverCode;
    return;
  }

  const outputs = ['dist/client/index.html', 'dist/server/entry-server.js'];
  if (outputs.some((output) => !fs.existsSync(path.resolve(packageRoot, output)))) {
    console.error('Quickque website build did not produce both client and server output.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Quickque website build failed.');
  process.exitCode = 1;
});