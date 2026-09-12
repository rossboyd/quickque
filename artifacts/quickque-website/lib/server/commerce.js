import crypto from 'node:crypto';
import { COMMERCE_PRICE } from './commercePrice.js';

export const COMMERCE_PRODUCT_KEY = 'quickque_mac_perpetual_gbp';
export const COMMERCE_COOKIE = 'quickque_checkout';
export const CSRF_COOKIE = 'quickque_csrf';
export const COMMERCE_AMOUNT = COMMERCE_PRICE.amount;
export const COMMERCE_CURRENCY = COMMERCE_PRICE.currency;
export const COMMERCE_BILLING = 'one-time';

const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_CHECKOUT_LIMIT = 12;
const DEFAULT_SESSION_LIMIT = 45;

export class CommerceUnavailableError extends Error {
  constructor(message = 'Commerce is temporarily unavailable.') {
    super(message);
    this.name = 'CommerceUnavailableError';
  }
}

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function metadataObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function expectedMetadata(config) {
  const commerce = config?.commerce || {};
  return {
    product_key: COMMERCE_PRODUCT_KEY,
    product_name: safeText(commerce.name),
    amount: String(COMMERCE_AMOUNT),
    currency: COMMERCE_CURRENCY,
    billing: COMMERCE_BILLING,
    licence: safeText(commerce.licence),
    updates: safeText(commerce.updates),
    source_licence: safeText(commerce.sourceLicence),
    live_enabled: String(Boolean(commerce.liveEnabled)),
    release_status: safeText(config?.release?.status)
  };
}

function productMetadataIsCorrect(metadata, config) {
  const actual = metadataObject(metadata);
  const expected = expectedMetadata(config);
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function catalogIsCorrect(catalog, config, mode) {
  return Boolean(
    catalog &&
      catalog.productId &&
      catalog.priceId &&
      catalog.mode === mode &&
      Number(catalog.amount) === COMMERCE_AMOUNT &&
      String(catalog.currency).toLowerCase() === COMMERCE_CURRENCY &&
      catalog.productName === safeText(config?.commerce?.name) &&
      productMetadataIsCorrect(catalog.productMetadata, config)
  );
}

function extractVersion(metadata) {
  const version = metadataObject(metadata).version;
  return typeof version === 'string' && version.trim() ? version : null;
}

function rowBoolean(value) {
  return value === true || value === 'true' || value === 1;
}

/**
 * Read the catalog from stripe-replit-sync's PostgreSQL client. This is
 * intentionally a SELECT-only query against the sync-owned schema.
 */
export async function readStripeCatalog(sync, config, mode = 'test') {
  if (!sync?.postgresClient || typeof sync.postgresClient.query !== 'function') {
    throw new CommerceUnavailableError();
  }

  const result = await sync.postgresClient.query(
    `SELECT
       p.id AS product_id,
       p.name AS product_name,
       p.active AS product_active,
       p.livemode AS product_livemode,
       p.metadata AS product_metadata,
       pr.id AS price_id,
       pr.active AS price_active,
       pr.livemode AS price_livemode,
       pr.unit_amount,
       pr.currency,
       pr.type AS price_type,
       pr.recurring,
       pr.lookup_key,
       pr.metadata AS price_metadata
     FROM stripe.products p
     INNER JOIN stripe.prices pr ON pr.product = p.id
     WHERE p.active = true
       AND pr.active = true
       AND pr.lookup_key = $1
     ORDER BY pr.created DESC
     LIMIT 1`,
    [COMMERCE_PRODUCT_KEY]
  );

  const row = result?.rows?.[0];
  if (!row) return null;

  const productMetadata = metadataObject(row.product_metadata);
  const priceMetadata = metadataObject(row.price_metadata);
  const livemode = rowBoolean(row.product_livemode) || rowBoolean(row.price_livemode);
  const expectedLiveMode = mode === 'live';
  const recurring = metadataObject(row.recurring);
  const isOneTime = row.price_type === 'one_time' && Object.keys(recurring).length === 0;

  if (
    !row.product_id ||
    !row.price_id ||
    row.lookup_key !== COMMERCE_PRODUCT_KEY ||
    !productMetadataIsCorrect(productMetadata, config) ||
    Number(row.unit_amount) !== COMMERCE_AMOUNT ||
    String(row.currency).toLowerCase() !== COMMERCE_CURRENCY ||
    !isOneTime ||
    livemode !== expectedLiveMode
  ) {
    return null;
  }

  return {
    productId: String(row.product_id),
    priceId: String(row.price_id),
    productName: safeText(row.product_name),
    amount: COMMERCE_AMOUNT,
    currency: COMMERCE_CURRENCY,
    mode,
    version: extractVersion(productMetadata),
    productMetadata,
    priceMetadata
  };
}

function normaliseOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function developmentOrigin(domain = process.env.REPLIT_DEV_DOMAIN) {
  if (typeof domain !== 'string' || !domain.trim()) return null;
  const value = domain.trim().startsWith('http') ? domain.trim() : `https://${domain.trim()}`;
  return normaliseOrigin(value);
}

export function trustedOriginFor(config, isProduction, override = null) {
  if (override) return normaliseOrigin(override);
  if (isProduction) return normaliseOrigin(config?.productionOrigin);
  return developmentOrigin();
}

export function createBoundedRateLimiter({
  windowMs = DEFAULT_RATE_WINDOW_MS,
  max = DEFAULT_CHECKOUT_LIMIT,
  maxKeys = 2_000
} = {}) {
  const entries = new Map();
  return {
    check(key) {
      const now = Date.now();
      const current = entries.get(key);
      if (!current || now - current.startedAt >= windowMs) {
        entries.set(key, { startedAt: now, count: 1 });
      } else {
        current.count += 1;
        if (current.count > max) return false;
      }

      if (entries.size > maxKeys) {
        for (const [entryKey, entry] of entries) {
          if (now - entry.startedAt >= windowMs) entries.delete(entryKey);
          if (entries.size <= maxKeys) break;
        }
      }
      return true;
    }
  };
}

function requestKey(req) {
  return safeText(req?.socket?.remoteAddress) || 'unknown';
}

function hashBinding(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signToken(token, secret) {
  return crypto.createHmac('sha256', secret).update(token).digest('base64url');
}

function timingSafeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string') return cookies;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function cookiePath(basePath) {
  const path = typeof basePath === 'string' && basePath ? basePath : '/';
  return path.endsWith('/') ? path : `${path}/`;
}

function appendCookie(res, name, value, { basePath, httpOnly, secure }) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${cookiePath(basePath)}`,
    'SameSite=Lax',
    'Max-Age=1800'
  ];
  if (httpOnly) attributes.push('HttpOnly');
  if (secure) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
}

function setNoStore(res) {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow'
  });
}

function validSessionId(value) {
  return typeof value === 'string' && /^cs_(?:test_|live_)[A-Za-z0-9]+$/.test(value) && value.length <= 255;
}

function originMatches(req, trustedOrigin) {
  const requestOrigin = req?.headers?.origin;
  if (requestOrigin === undefined) {
    const referer = req?.headers?.referer;
    if (!referer) return true;
    try {
      return normaliseOrigin(new URL(referer).origin) === trustedOrigin;
    } catch {
      return false;
    }
  }
  return normaliseOrigin(requestOrigin) === trustedOrigin;
}

function safeClientError(res, status, message) {
  setNoStore(res);
  return res.status(status).json({ error: message });
}

function safeStatus(mode, message, csrfToken, available = false) {
  const status = { available, mode, message };
  if (csrfToken) status.csrfToken = csrfToken;
  return status;
}

function checkoutMetadata(catalog, config, bindingToken, mode) {
  const expected = expectedMetadata(config);
  const metadata = {
    ...expected,
    mode,
    price_id: catalog.priceId,
    product_id: catalog.productId,
    browser_binding: hashBinding(bindingToken)
  };
  if (catalog.version) metadata.version = catalog.version;
  return metadata;
}

function lineItemFromSession(session) {
  return session?.line_items?.data?.[0] || null;
}

async function expandedSessionProduct(client, session) {
  let lineItem = lineItemFromSession(session);
  if (!lineItem && client?.checkout?.sessions?.listLineItems) {
    const result = await client.checkout.sessions.listLineItems(session.id, {
      limit: 1,
      expand: ['data.price.product']
    });
    lineItem = result?.data?.[0] || null;
  }
  if (!lineItem) return { lineItem: null, price: null, product: null };

  let price = lineItem.price;
  if (typeof price === 'string' && client?.prices?.retrieve) {
    price = await client.prices.retrieve(price);
  }
  let product = price?.product;
  if (typeof product === 'string' && client?.products?.retrieve) {
    product = await client.products.retrieve(product);
  }
  return { lineItem, price, product };
}

function sessionProductIsCorrect(session, lineItem, price, product, catalog, config) {
  if (
    !lineItem ||
    !price ||
    !product ||
    String(price.id) !== catalog.priceId ||
    String(price.product?.id || product.id) !== catalog.productId ||
    safeText(product.name) !== safeText(config?.commerce?.name) ||
    Number(price.unit_amount) !== COMMERCE_AMOUNT ||
    String(price.currency).toLowerCase() !== COMMERCE_CURRENCY ||
    (price.tax_behavior !== undefined && price.tax_behavior !== 'inclusive') ||
    Number(lineItem.quantity) !== 1 ||
    Number(lineItem.amount_total ?? price.unit_amount) !== COMMERCE_AMOUNT ||
    !productMetadataIsCorrect(product.metadata, config)
  ) {
    return false;
  }
  return true;
}

function sessionResult(status, mode, message, version = null) {
  return {
    status,
    mode,
    amount: COMMERCE_AMOUNT,
    currency: COMMERCE_CURRENCY,
    version,
    downloadUrl: null,
    message
  };
}

export function createCommerceService({
  config,
  basePath = '/website',
  isProduction = false,
  runtime = {},
  trustedOrigin = trustedOriginFor(config, isProduction),
  sessionSecret = process.env.SESSION_SECRET,
  checkoutLimiter = createBoundedRateLimiter({ max: DEFAULT_CHECKOUT_LIMIT }),
  sessionLimiter = createBoundedRateLimiter({ max: DEFAULT_SESSION_LIMIT })
} = {}) {
  const resolvedOrigin = normaliseOrigin(trustedOrigin);
  const secureCookies = isProduction || resolvedOrigin?.startsWith('https://');

  async function currentRuntime() {
    return typeof runtime.getRuntime === 'function' ? runtime.getRuntime() : runtime;
  }

  async function readyState() {
    if (!sessionSecret || typeof sessionSecret !== 'string') {
      return { mode: 'unavailable', catalog: null, client: null, message: 'Checkout is temporarily unavailable.' };
    }
    const activeRuntime = await currentRuntime();
    const mode = activeRuntime?.mode || 'unavailable';
    if (mode !== 'test') {
      return {
        mode,
        catalog: null,
        client: null,
        message: mode === 'live' ? 'Live checkout is not enabled for this release.' : 'Checkout is temporarily unavailable.'
      };
    }
    if (!resolvedOrigin) {
      return { mode: 'unavailable', catalog: null, client: null, message: 'Checkout is temporarily unavailable.' };
    }

    try {
      let catalog = activeRuntime.catalog;
      if (!catalog && activeRuntime.sync) {
        catalog = await readStripeCatalog(activeRuntime.sync, config, mode);
      }
      if (!catalogIsCorrect(catalog, config, mode)) {
        return { mode, catalog: null, client: null, message: 'Checkout is temporarily unavailable.' };
      }
      const client = activeRuntime.client || (typeof activeRuntime.getClient === 'function' ? await activeRuntime.getClient() : null);
      if (!client?.checkout?.sessions?.create) {
        return { mode, catalog: null, client: null, message: 'Checkout is temporarily unavailable.' };
      }
      return { mode, catalog, client, message: 'Sandbox checkout is available.' };
    } catch {
      return { mode, catalog: null, client: null, message: 'Checkout is temporarily unavailable.' };
    }
  }

  async function status(req, res) {
    const state = await readyState();
    if (!state.catalog) {
      setNoStore(res);
      return safeStatus(state.mode, state.message);
    }
    const cookies = parseCookies(req.headers.cookie);
    let csrfToken = cookies[CSRF_COOKIE];
    if (!csrfToken || csrfToken.length > 256) {
      csrfToken = crypto.randomBytes(32).toString('base64url');
      appendCookie(res, CSRF_COOKIE, csrfToken, {
        basePath,
        httpOnly: false,
        secure: secureCookies
      });
    }
    setNoStore(res);
    return safeStatus('test', state.message, csrfToken, true);
  }

  async function checkout(req, res) {
    if (!checkoutLimiter.check(requestKey(req))) {
      return safeClientError(res, 429, 'Too many checkout attempts. Please try again later.');
    }
    const state = await readyState();
    if (!state.catalog) {
      return safeClientError(res, 503, state.message);
    }
    if (!originMatches(req, resolvedOrigin)) {
      return safeClientError(res, 403, 'Checkout request origin is not allowed.');
    }
    if (req.body?.termsAccepted !== true) {
      return safeClientError(res, 400, 'You must accept the purchase terms.');
    }

    const cookies = parseCookies(req.headers.cookie);
    const csrfCookie = cookies[CSRF_COOKIE];
    const csrfToken = req.body?.csrfToken;
    if (
      typeof csrfToken !== 'string' ||
      csrfToken.length > 256 ||
      !csrfCookie ||
      !timingSafeEqualText(csrfToken, csrfCookie)
    ) {
      return safeClientError(res, 403, 'Checkout security validation failed.');
    }

    if (!sessionSecret) return safeClientError(res, 503, 'Checkout is temporarily unavailable.');
    const bindingToken = crypto.randomBytes(32).toString('base64url');
    const metadata = checkoutMetadata(state.catalog, config, bindingToken, state.mode);
    const successUrl = `${resolvedOrigin}${basePath ? `${basePath.replace(/\/+$/, '')}/` : '/'}checkout/result?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${resolvedOrigin}${basePath ? `${basePath.replace(/\/+$/, '')}/` : '/'}pricing?checkout=cancelled`;

    let session;
    try {
      session = await state.client.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: state.catalog.priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
        client_reference_id: hashBinding(bindingToken),
        payment_method_types: ['card'],
        customer_creation: 'always',
        automatic_tax: { enabled: false }
      });
    } catch {
      return safeClientError(res, 503, 'Checkout is temporarily unavailable.');
    }

    if (!session?.url || typeof session.url !== 'string') {
      return safeClientError(res, 503, 'Checkout is temporarily unavailable.');
    }
    appendCookie(res, COMMERCE_COOKIE, `${bindingToken}.${signToken(bindingToken, sessionSecret)}`, {
      basePath,
      httpOnly: true,
      secure: secureCookies
    });
    setNoStore(res);
    return res.json({ url: session.url });
  }

  async function session(req, res) {
    if (!sessionLimiter.check(requestKey(req))) {
      return safeClientError(res, 429, 'Too many session checks. Please try again later.');
    }
    const id = req.query?.session_id;
    if (!validSessionId(id)) {
      setNoStore(res);
      return sessionResult('invalid', 'unavailable', 'Checkout session is invalid.');
    }
    const cookies = parseCookies(req.headers.cookie);
    const rawBinding = cookies[COMMERCE_COOKIE];
    const separator = typeof rawBinding === 'string' ? rawBinding.lastIndexOf('.') : -1;
    let bindingToken = '';
    let signature = '';
    if (separator > 0) {
      try {
        bindingToken = decodeURIComponent(rawBinding.slice(0, separator));
        signature = decodeURIComponent(rawBinding.slice(separator + 1));
      } catch {
        bindingToken = '';
        signature = '';
      }
    }
    if (
      !sessionSecret ||
      !bindingToken ||
      !signature ||
      !timingSafeEqualText(signature, signToken(bindingToken, sessionSecret))
    ) {
      setNoStore(res);
      return sessionResult('invalid', 'unavailable', 'Checkout session is invalid.');
    }

    const state = await readyState();
    if (!state.catalog || !state.client?.checkout?.sessions?.retrieve) {
      setNoStore(res);
      return sessionResult('invalid', state.mode, 'Checkout session is invalid.');
    }

    let stripeSession;
    try {
      stripeSession = await state.client.checkout.sessions.retrieve(id, {
        expand: ['line_items.data.price.product']
      });
    } catch {
      setNoStore(res);
      return sessionResult('invalid', state.mode, 'Checkout session is invalid.');
    }

    const mode = stripeSession?.livemode ? 'live' : 'test';
    const sessionMetadata = metadataObject(stripeSession?.metadata);
    const expectedSessionMetadata = expectedMetadata(config);
    if (
      stripeSession.id !== id ||
      mode !== state.mode ||
      sessionMetadata.browser_binding !== hashBinding(bindingToken) ||
      sessionMetadata.price_id !== state.catalog.priceId ||
      stripeSession.mode !== 'payment' ||
      Object.entries(expectedSessionMetadata).some(([key, value]) => sessionMetadata[key] !== value)
    ) {
      setNoStore(res);
      return sessionResult('invalid', mode, 'Checkout session is invalid.');
    }

    let expanded;
    try {
      expanded = await expandedSessionProduct(state.client, stripeSession);
    } catch {
      setNoStore(res);
      return sessionResult('invalid', mode, 'Checkout session is invalid.');
    }
    if (!sessionProductIsCorrect(stripeSession, expanded.lineItem, expanded.price, expanded.product, state.catalog, config)) {
      setNoStore(res);
      return sessionResult('invalid', mode, 'Checkout session is invalid.');
    }

    const verifiedVersion = extractVersion(expanded.product.metadata);
    let result;
    if (stripeSession.status === 'expired' || stripeSession.status === 'canceled' || stripeSession.status === 'cancelled') {
      result = sessionResult('cancelled', mode, 'Checkout expired or was cancelled.', verifiedVersion);
    } else if (stripeSession.status === 'complete' && stripeSession.payment_status === 'paid') {
      result = sessionResult(
        'paid',
        mode,
        'Payment confirmed in sandbox. No licence or download is issued by this test checkout.',
        verifiedVersion
      );
    } else if (stripeSession.status === 'open' || stripeSession.payment_status === 'unpaid') {
      result = sessionResult('pending', mode, 'Payment is not complete yet.', verifiedVersion);
    } else {
      result = sessionResult('invalid', mode, 'Checkout session is invalid.', verifiedVersion);
    }
    setNoStore(res);
    return result;
  }

  return {
    status,
    checkout,
    session,
    readyState,
    expectedMetadata: () => expectedMetadata(config),
    constants: {
      productKey: COMMERCE_PRODUCT_KEY,
      amount: COMMERCE_AMOUNT,
      currency: COMMERCE_CURRENCY,
      billing: COMMERCE_BILLING
    }
  };
}
