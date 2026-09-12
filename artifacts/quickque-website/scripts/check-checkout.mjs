// Explicit, development-only smoke check. Creates then expires an unpaid
// Stripe test Checkout Session; it never supplies a card or makes a payment.
import assert from 'node:assert/strict';
import { readSiteConfigSync } from '../lib/server/content.js';
import { getUncachableStripeClient } from '../lib/server/stripeClient.js';
import { COMMERCE_AMOUNT, COMMERCE_CURRENCY } from '../lib/server/commerce.js';
import { COMMERCE_PRICE } from '../lib/server/commercePrice.js';

if (!process.env.REPLIT_DEV_DOMAIN || process.env.NODE_ENV === 'production') {
  throw new Error('Run this check only in the development workspace.');
}
const config = readSiteConfigSync();
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const base = `http://localhost:80${config.basePath}api/commerce/`;
const cookies = new Map();
function rememberCookies(response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}
function headers() {
  return {
    origin,
    cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
    'content-type': 'application/json',
  };
}

let createdSessionId;
let stripe;
try {
  const statusResponse = await fetch(`${base}status`);
  assert.equal(statusResponse.status, 200);
  rememberCookies(statusResponse);
  const status = await statusResponse.json();
  assert.equal(status.mode, 'test');
  assert.equal(status.available, true);
  const declined = await fetch(`${base}checkout`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ termsAccepted: false, csrfToken: status.csrfToken }),
  });
  assert.equal(declined.status, 400);
  const checkout = await fetch(`${base}checkout`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ termsAccepted: true, csrfToken: status.csrfToken }),
  });
  assert.equal(checkout.status, 200, 'Test Checkout Session creation');
  rememberCookies(checkout);
  const { url } = await checkout.json();
  const destination = new URL(url);
  assert.equal(destination.origin, 'https://checkout.stripe.com');
  // Extract the test session ID locally without printing its URL or binding.
  createdSessionId = destination.pathname.match(/cs_test_[A-Za-z0-9]+/)?.[0];
  assert.ok(createdSessionId, 'Stripe returned a test session');
  stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(createdSessionId);
  assert.equal(session.livemode, false);
  assert.equal(session.mode, 'payment');
  assert.equal(session.amount_total, COMMERCE_AMOUNT);
  assert.equal(session.currency, COMMERCE_CURRENCY);
  assert.equal(session.payment_status, 'unpaid');
  const verified = await fetch(`${base}session?session_id=${encodeURIComponent(createdSessionId)}`, { headers: headers() });
  assert.equal(verified.status, 200);
  const result = await verified.json();
  assert.equal(result.status, 'pending');
  assert.equal(result.mode, 'test');
  assert.equal(result.downloadUrl, null);
  const unbound = await fetch(`${base}session?session_id=${encodeURIComponent(createdSessionId)}`, { headers: { origin } });
  assert.equal((await unbound.json()).status, 'invalid');
  console.log(`Checkout smoke check passed: ${COMMERCE_PRICE.displayPrice} GBP, one-time, test-only, unpaid, browser-bound, no download.`);
} finally {
  if (stripe && createdSessionId) {
    await stripe.checkout.sessions.expire(createdSessionId);
    console.log('Unpaid test checkout expired.');
  }
}