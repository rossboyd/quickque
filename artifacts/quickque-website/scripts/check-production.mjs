import { spawn } from 'node:child_process';
import { createServer } from '../server.js';

// Start the production handler in-process on an ephemeral port. This is a test
// fixture, not a second preview workflow. No app data or native APIs are used.
const { app } = await createServer(new URL('../', import.meta.url).pathname, true, { skipExternalInitialization: true });
const server = await new Promise((resolve, reject) => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  listener.once('error', reject);
});
try {
  const address = server.address();
  const config = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../config/site.json', import.meta.url), 'utf8'));
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('check-site.mjs', import.meta.url).pathname], {
      stdio: 'inherit',
      env: { ...process.env, SITE_CHECK_URL: `http://127.0.0.1:${address.port}${config.basePath}` },
    });
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) process.exitCode = 1;
} finally {
  await new Promise(resolve => server.close(resolve));
}