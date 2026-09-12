import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('../../../src-tauri/src/remote-mobile.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const sid = 'a'.repeat(64);
const scanned = `?session=${sid}&code=123456`;
const snapshot = { mode: 'manual', playing: false, section: 1, sectionCount: 3, elapsedMs: 42000, scrollSpeed: 50, fontSize: 48, position: 80 };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const settle = () => new Promise(resolve => setImmediate(resolve));

function browser({ search = scanned, storage = new Map(), route, crypto = webcrypto } = {}) {
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  function element(dataset = {}) {
    return { hidden: false, disabled: false, textContent: '', value: '', dataset, listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      hasAttribute(name) { return name === 'data-manual' && !!dataset.manual; },
    };
  }
  const elements = Object.fromEntries(['status', 'pairing', 'code', 'pairButton', 'controls', 'info'].map(id => [id, element()]));
  elements.pairing.hidden = true;
  elements.controls.hidden = true;
  const buttons = ['playPause', 'previous', 'next', 'scrollSpeed', 'fontSize', 'position'].map(action =>
    element({ action, ...(['scrollSpeed', 'position'].includes(action) ? { manual: true } : {}),
      ...(['scrollSpeed', 'fontSize', 'position'].includes(action) ? { value: '5' } : {}) }));
  const context = {
    document: { getElementById: id => elements[id], querySelectorAll: () => buttons },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    location: { search }, URLSearchParams, Uint8Array, AbortController, crypto,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(path, options) {
      requests.push({ path, options });
      return route ? route(path, options) : response(path === '/api/pair' ? { status: 'pending', token: 'token' } : { status: 'pending' });
    },
  };
  context.window = context;
  vm.runInNewContext(script, context);
  return { elements, buttons, requests, storage, timers,
    async tick() {
      const next = [...timers.entries()].find(([, value]) => value.delay !== 5000);
      assert.ok(next, 'poll or reconnect timer is scheduled');
      timers.delete(next[0]);
      await next[1].fn();
      await settle();
    },
  };
}

test('scanned URL automatically handshakes and never enables commands before approval', async () => {
  let approved = false;
  const b = browser({ route: path => response(path === '/api/pair' ? { status: 'pending', token: 'one' } :
    approved ? { status: 'connected', snapshot } : { status: 'pending' }) });
  await settle();
  assert.deepEqual(b.requests.map(x => x.path), ['/api/pair', '/api/events']);
  const payload = JSON.parse(b.requests[0].options.body);
  assert.equal(payload.sessionId, sid);
  assert.equal(payload.code, '123456');
  assert.match(payload.clientId, /^[a-f0-9]{32}$/);
  assert.equal(b.elements.status.dataset.state, 'pending');
  assert.equal(b.elements.pairing.hidden, true);
  assert.equal(b.elements.controls.hidden, true);
  assert.ok(b.buttons.every(x => x.disabled));
  approved = true;
  await b.tick();
  assert.equal(b.elements.status.dataset.state, 'connected');
  assert.equal(b.elements.controls.hidden, false);
  assert.match(b.elements.info.textContent, /Manual · Section 2\/3 · 0:42/);
  assert.match(b.elements.info.textContent, /Speed 50 · Font 48 · Position 80/);
  assert.ok(b.buttons.every(x => !x.disabled));
});

test('reload and repeat scan reuse the session credential rather than making a competing request', async () => {
  const first = browser();
  await settle();
  const second = browser({ storage: first.storage });
  await settle();
  assert.deepEqual(second.requests.map(x => x.path), ['/api/events']);
  assert.equal(second.requests[0].options.headers.Authorization, 'Bearer token');
  const different = browser({ storage: first.storage, search: `?session=${'b'.repeat(64)}&code=123456` });
  await settle();
  assert.equal(different.requests[0].path, '/api/pair');
  assert.notEqual(JSON.parse(different.requests[0].options.body).clientId, JSON.parse(first.requests[0].options.body).clientId);
});

test('a lost pairing response retries with exactly the same session and client id', async () => {
  let failed = false;
  const b = browser({ route: path => {
    if (!failed) { failed = true; throw new Error('LAN interrupted'); }
    return response(path === '/api/pair' ? { status: 'pending', token: 'one' } : { status: 'pending' });
  } });
  await settle();
  assert.equal(b.elements.status.dataset.state, 'unreachable');
  await b.tick();
  assert.equal(b.requests[0].options.body, b.requests[1].options.body);
  assert.equal(b.elements.status.dataset.state, 'pending');
});

for (const status of ['expired', 'rejected', 'busy']) {
  test(`${status} is terminal, asks for a new QR, and never silently enters another session`, async () => {
    const b = browser({ route: () => response({ status }, 403) });
    await settle();
    assert.equal(b.elements.status.dataset.state, status);
    assert.match(b.elements.status.textContent, /new QR code/);
    assert.equal(b.elements.controls.hidden, true);
    assert.equal(b.timers.size, 0);
    assert.ok(b.requests.every(x => x.path !== '/api/session'));
  });
}

test('revocation after pending is not misreported as still awaiting approval', async () => {
  let rejected = false;
  const b = browser({ route: path => response(path === '/api/pair' ? { status: 'pending', token: 'one' } :
    rejected ? { status: 'rejected' } : { status: 'pending' }, rejected ? 403 : 200) });
  await settle();
  rejected = true;
  await b.tick();
  assert.equal(b.elements.status.dataset.state, 'rejected');
  assert.equal(b.timers.size, 0);
});

test('brief same-address interruption disables controls and reconnects without a new handshake', async () => {
  let offline = false;
  const b = browser({ route: path => {
    if (offline) throw new Error('offline');
    return response(path === '/api/pair' ? { status: 'pending', token: 'one' } : { status: 'connected', snapshot });
  } });
  await settle();
  offline = true;
  await b.tick();
  assert.equal(b.elements.controls.hidden, true);
  assert.ok(b.buttons.every(x => x.disabled));
  offline = false;
  await b.tick();
  assert.equal(b.elements.status.dataset.state, 'connected');
  assert.equal(b.requests.filter(x => x.path === '/api/pair').length, 1);
});

test('bare local URL exposes only the optional manual-code form', async () => {
  const b = browser({ search: '', route: path => response(path === '/api/session' ? { sessionId: sid } :
    path === '/api/pair' ? { status: 'pending', token: 'one' } : { status: 'pending' }) });
  assert.equal(b.requests.length, 0);
  assert.equal(b.elements.pairing.hidden, false);
  b.elements.code.value = '123456';
  await b.elements.pairing.listeners.submit({ preventDefault() {} });
  await settle();
  assert.deepEqual(b.requests.map(x => x.path), ['/api/session', '/api/pair', '/api/events']);
  assert.equal(b.elements.status.dataset.state, 'pending');
});

test('malformed scanned URL cannot fall back to a different live session', async () => {
  for (const search of ['?code=123456', '?session=old&code=123456', `?session=${sid}`]) {
    const b = browser({ search });
    await settle();
    assert.equal(b.requests.length, 0);
    assert.equal(b.elements.status.dataset.state, 'expired');
    assert.equal(b.elements.pairing.hidden, true);
  }
});

test('unsupported HTTP browser gets clear guidance before pairing', async () => {
  const b = browser({ crypto: {} });
  await settle();
  assert.equal(b.requests.length, 0);
  assert.equal(b.elements.status.dataset.state, 'unsupported');
});

test('Voice Follow keeps manual speed and position disabled and sends shared command names', async () => {
  const b = browser({ route: path => response(path === '/api/pair' ? { status: 'pending', token: 'one' } :
    { status: 'connected', snapshot: { ...snapshot, mode: 'flow' } }) });
  await settle();
  assert.match(b.elements.info.textContent, /Voice Follow/);
  assert.ok(b.buttons.filter(x => x.dataset.manual).every(x => x.disabled));
  const next = b.buttons.find(x => x.dataset.action === 'next');
  next.listeners.click();
  await settle();
  const command = b.requests.find(x => x.path === '/api/control');
  assert.equal(command.options.headers.Authorization, 'Bearer one');
  assert.deepEqual(Object.keys(JSON.parse(command.options.body)).sort(), ['action', 'requestId']);
  assert.equal(JSON.parse(command.options.body).action, 'next');
  assert.match(JSON.parse(command.options.body).requestId, /^[a-f0-9]{32}$/);
});

test('Mac-hosted phone document has no internet-dependent assets or services', () => {
  assert.doesNotMatch(html, /https?:\/\/|@import|<script[^>]+src=|<link[^>]+href=["'](?!data:)/i);
  assert.doesNotMatch(html, /serviceWorker|sendBeacon|WebSocket|navigator\.geolocation/);
  for (const match of script.matchAll(/request\('([^']+)'/g)) {
    assert.match(match[1], /^\/api\/(?:pair|session|events|control)$/);
  }
  assert.match(html, /unencrypted local HTTP/);
  assert.match(html, /<noscript>/);
});