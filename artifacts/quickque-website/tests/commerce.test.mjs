import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from '../server.js';
import { readCommercePrice } from '../lib/server/commercePrice.js';

test('GBP display price remains valid copy for the planned offer', () => {
  assert.deepEqual(readCommercePrice('25'), {
    amount: 2500,
    currency: 'gbp',
    displayPrice: '£25'
  });
});

test('website startup and active pages do not import payment runtime modules', () => {
  const serverSource = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const pricingSource = fs.readFileSync(new URL('../src/pages/Pricing.tsx', import.meta.url), 'utf8');
  const resultSource = fs.readFileSync(new URL('../src/pages/CheckoutResult.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(serverSource, /payment provider|managed webhook/i);
  assert.doesNotMatch(pricingSource, /fetch\(|api\/commerce/);
  assert.doesNotMatch(resultSource, /fetch\(|session_id|api\/commerce/);
});

test('legacy payment endpoints are disabled and cannot create or verify purchases', async (t) => {
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async (...args) => {
    const url = String(args[0]);
    if (!url.startsWith('http://127.0.0.1:')) externalCalls += 1;
    return originalFetch(...args);
  };

  const { httpServer } = await createServer(new URL('../', import.meta.url).pathname, true);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    globalThis.fetch = originalFetch;
    httpServer.close();
  });
  const address = httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;

  const cases = [
    ['GET', '/api/commerce/status'],
    ['POST', '/api/commerce/checkout'],
    ['GET', '/api/commerce/session?session_id=disabled']
  ];
  for (const [method, route] of cases) {
    const response = await fetch(`${base}${route}`, { method });
    assert.equal(response.status, 410);
    const body = await response.json();
    assert.match(JSON.stringify(body), /disabled/i);
    assert.doesNotMatch(JSON.stringify(body), /https?:\/\//);
  }
  assert.equal(externalCalls, 0);
});