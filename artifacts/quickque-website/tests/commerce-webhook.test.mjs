import test from 'node:test';
import assert from 'node:assert/strict';
import { getStripeSync } from '../lib/server/stripeClient.js';

test('StripeSync resolves the managed webhook secret from the database', async () => {
  const previous = {
    hostname: process.env.REPLIT_CONNECTORS_HOSTNAME,
    identity: process.env.REPL_IDENTITY,
    database: process.env.DATABASE_URL,
    fetch: globalThis.fetch
  };
  process.env.REPLIT_CONNECTORS_HOSTNAME = 'connectors.test';
  process.env.REPL_IDENTITY = 'repl unit-test-identity';
  process.env.DATABASE_URL = 'postgres://unit-test.invalid/stripe';
  globalThis.fetch = async () => new Response(JSON.stringify({
    items: [{
      settings: {
        secret: 'sk_test_unit_test_key',
        webhook_secret: 'whsec_connector_secret_that_is_not_managed'
      }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const sync = await getStripeSync();
    assert.equal(sync.config.stripeWebhookSecret, '');
  } finally {
    if (previous.hostname === undefined) delete process.env.REPLIT_CONNECTORS_HOSTNAME;
    else process.env.REPLIT_CONNECTORS_HOSTNAME = previous.hostname;
    if (previous.identity === undefined) delete process.env.REPL_IDENTITY;
    else process.env.REPL_IDENTITY = previous.identity;
    if (previous.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.database;
    globalThis.fetch = previous.fetch;
  }
});