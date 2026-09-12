import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('retained Stripe bootstrap is isolated from website startup', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /stripeBootstrap|stripeClient|stripe-replit-sync/);
  assert.match(source, /Payment webhooks are disabled while dummy checkout is active/);
});