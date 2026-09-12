import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommerceService, readStripeCatalog } from '../lib/server/commerce.js';
import { readCommercePrice } from '../lib/server/commercePrice.js';

process.env.SESSION_SECRET = 'commerce-test-secret-long-enough';

test('GBP environment price is validated and converted to integer pence', () => {
  assert.deepEqual(readCommercePrice('77'), {
    amount: 7700,
    currency: 'gbp',
    displayPrice: '£77'
  });
  assert.deepEqual(readCommercePrice('77.50'), {
    amount: 7750,
    currency: 'gbp',
    displayPrice: '£77.50'
  });
  assert.throws(() => readCommercePrice('0'));
  assert.throws(() => readCommercePrice('77.999'));
  assert.throws(() => readCommercePrice('not-a-price'));
});

const config = {
  productionOrigin: null,
  release: { status: 'unavailable' },
  commerce: {
    name: 'Quickque for Mac',
    amount: 7700,
    currency: 'gbp',
    billing: 'one-time',
    licence: 'Use the purchased version forever.',
    updates: 'Future major upgrades may cost extra.',
    sourceLicence: 'MIT',
    liveEnabled: false
  }
};

const productMetadata = {
  product_key: 'quickque_mac_perpetual_gbp',
  product_name: 'Quickque for Mac',
  amount: '7700',
  currency: 'gbp',
  billing: 'one-time',
  licence: 'Use the purchased version forever.',
  updates: 'Future major upgrades may cost extra.',
  source_licence: 'MIT',
  live_enabled: 'false',
  release_status: 'unavailable',
  version: '0.1.0'
};

function catalog(overrides = {}) {
  return {
    productId: 'prod_quickque',
    priceId: 'price_quickque',
    productName: 'Quickque for Mac',
    amount: 7700,
    currency: 'gbp',
    mode: 'test',
    version: '0.1.0',
    productMetadata,
    priceMetadata: productMetadata,
    ...overrides
  };
}

function response() {
  const headers = {};
  const cookies = [];
  return {
    headers,
    cookies,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(values) {
      Object.assign(headers, typeof values === 'string' ? {} : values);
      return this;
    },
    append(name, value) {
      cookies.push(`${name}: ${value}`);
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

function request({ body = {}, cookie = '', query = {}, origin } = {}) {
  return {
    body,
    query,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {})
    },
    socket: { remoteAddress: 'commerce-test' }
  };
}

function makeClient() {
  let created;
  const client = {
    checkout: {
      sessions: {
        async create(params) {
          created = params;
          return { id: 'cs_test_123', url: 'https://checkout.stripe.test/cs_test_123' };
        },
        async retrieve() {
          return {
            id: 'cs_test_123',
            livemode: false,
            mode: 'payment',
            status: 'open',
            payment_status: 'unpaid',
            metadata: created.metadata,
            line_items: {
              data: [{
                quantity: 1,
                amount_total: 7700,
                price: {
                  id: 'price_quickque',
                  unit_amount: 7700,
                  currency: 'gbp',
                  product: { id: 'prod_quickque', name: 'Quickque for Mac', metadata: productMetadata }
                }
              }]
            }
          };
        }
      }
    },
    get created() {
      return created;
    }
  };
  return client;
}

function service(client = makeClient(), runtime = {}, options = {}) {
  return createCommerceService({
    config: options.config || config,
    basePath: '/website',
    isProduction: Boolean(options.isProduction),
    runtime: {
      mode: 'test',
      client,
      catalog: catalog(),
      ...runtime
    },
    trustedOrigin: options.trustedOrigin || 'https://quickque.test',
    sessionSecret: process.env.SESSION_SECRET
  });
}

test('catalog is read from the stripe sync schema and rejects wrong server-owned price', async () => {
  const sync = {
    postgresClient: {
      async query(_query, values) {
        assert.deepEqual(values, ['quickque_mac_perpetual_gbp']);
        return {
          rows: [{
            product_id: 'prod_quickque',
            product_name: 'Quickque for Mac',
            product_active: true,
            product_livemode: false,
            product_metadata: productMetadata,
            price_id: 'price_quickque',
            price_active: true,
            price_livemode: false,
            unit_amount: 7700,
            currency: 'gbp',
            price_type: 'one_time',
            recurring: null,
            lookup_key: 'quickque_mac_perpetual_gbp',
            price_metadata: productMetadata
          }]
        };
      }
    }
  };
  assert.equal((await readStripeCatalog(sync, config, 'test')).priceId, 'price_quickque');
  const wrong = await readStripeCatalog({
    postgresClient: {
      query: async (query, values) => {
        const result = await sync.postgresClient.query(query, values);
        return { rows: [{ ...result.rows[0], unit_amount: 1 }] };
      }
    }
  }, config, 'test');
  assert.equal(wrong, null);
});

test('status gate exposes sandbox only for a test catalogue', async () => {
  const gated = service(makeClient(), { mode: 'live' });
  const gatedResponse = response();
  const gatedStatus = await gated.status(request(), gatedResponse);
  assert.equal(gatedStatus.available, false);
  assert.equal(gatedStatus.mode, 'live');

  const available = service();
  const availableResponse = response();
  const status = await available.status(request(), availableResponse);
  assert.equal(status.available, true);
  assert.equal(status.mode, 'test');
  assert.ok(status.csrfToken);
});

test('production demo exposes only the validated sandbox checkout', async () => {
  const productionConfig = {
    ...config,
    productionOrigin: 'https://quickque.example'
  };
  const production = service(makeClient(), {}, {
    config: productionConfig,
    isProduction: true,
    trustedOrigin: productionConfig.productionOrigin
  });
  const statusResponse = response();
  const status = await production.status(request(), statusResponse);

  assert.equal(status.available, true);
  assert.equal(status.mode, 'test');
  assert.equal(status.message, 'Sandbox checkout is available.');
  assert.ok(status.csrfToken);

  const liveRuntime = service(makeClient(), { mode: 'live' }, {
    config: productionConfig,
    isProduction: true,
    trustedOrigin: productionConfig.productionOrigin
  });
  const liveStatus = await liveRuntime.status(request(), response());
  assert.equal(liveStatus.available, false);
  assert.equal(liveStatus.mode, 'live');
});

test('checkout requires terms and CSRF, and uses only the server-owned amount/currency price', async () => {
  const client = makeClient();
  const commerce = service(client);
  const statusResponse = response();
  const status = await commerce.status(request(), statusResponse);
  const csrf = status.csrfToken;
  // The response helper stores "Set-Cookie: ..." while append receives the
  // cookie string; locate the actual value independent of that representation.
  const cookieHeader = statusResponse.cookies.find((value) => value.includes('quickque_csrf='))?.replace(/^Set-Cookie:\s*/, '') || '';

  const missingTerms = response();
  await commerce.checkout(request({ body: { csrfToken: csrf }, cookie: cookieHeader, origin: 'https://quickque.test' }), missingTerms);
  assert.equal(missingTerms.statusCode, 400);

  const missingCsrf = response();
  await commerce.checkout(request({ body: { termsAccepted: true }, origin: 'https://quickque.test' }), missingCsrf);
  assert.equal(missingCsrf.statusCode, 403);

  const checkoutResponse = response();
  await commerce.checkout(request({
    body: { termsAccepted: true, csrfToken: csrf },
    cookie: cookieHeader,
    origin: 'https://quickque.test'
  }), checkoutResponse);
  assert.equal(checkoutResponse.body.url, 'https://checkout.stripe.test/cs_test_123');
  assert.deepEqual(client.created.line_items, [{ price: 'price_quickque', quantity: 1 }]);
  assert.equal(client.created.mode, 'payment');
  assert.equal(client.created.metadata.amount, '7700');
  assert.equal(client.created.metadata.currency, 'gbp');
  assert.ok(checkoutResponse.cookies.some((value) => value.includes('quickque_checkout=')));
});

test('bound guest session cannot be queried from another browser and unpaid is pending', async () => {
  const client = makeClient();
  const commerce = service(client);
  const statusResponse = response();
  const status = await commerce.status(request(), statusResponse);
  const csrfCookie = statusResponse.cookies.find((value) => value.includes('quickque_csrf='))?.replace(/^Set-Cookie:\s*/, '') || '';
  const checkoutResponse = response();
  await commerce.checkout(request({
    body: { termsAccepted: true, csrfToken: status.csrfToken },
    cookie: csrfCookie,
    origin: 'https://quickque.test'
  }), checkoutResponse);
  const checkoutCookie = checkoutResponse.cookies.find((value) => value.includes('quickque_checkout='))?.replace(/^Set-Cookie:\s*/, '') || '';

  const pendingResponse = response();
  const pending = await commerce.session(request({
    query: { session_id: 'cs_test_123' },
    cookie: `${checkoutCookie}; ${csrfCookie}`
  }), pendingResponse);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.downloadUrl, null);

  const foreign = await commerce.session(request({
    query: { session_id: 'cs_test_123' },
    cookie: 'quickque_checkout=not-the-same-browser'
  }), response());
  assert.equal(foreign.status, 'invalid');

  const tampered = await commerce.session(request({
    query: { session_id: 'cs_test_tampered' },
    cookie: checkoutCookie
  }), response());
  assert.equal(tampered.status, 'invalid');
});

test('provider failure is safe and does not return a URL', async () => {
  const client = makeClient();
  client.checkout.sessions.create = async () => {
    throw new Error('provider failure with private details');
  };
  const commerce = service(client);
  const statusResponse = response();
  const status = await commerce.status(request(), statusResponse);
  const csrfCookie = statusResponse.cookies.find((value) => value.includes('quickque_csrf='))?.replace(/^Set-Cookie:\s*/, '') || '';
  const failed = response();
  await commerce.checkout(request({
    body: { termsAccepted: true, csrfToken: status.csrfToken },
    cookie: csrfCookie,
    origin: 'https://quickque.test'
  }), failed);
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(failed.body, { error: 'Checkout is temporarily unavailable.' });
});