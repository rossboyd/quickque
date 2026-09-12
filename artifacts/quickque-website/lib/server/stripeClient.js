import Stripe from 'stripe';
import { StripeSync } from 'stripe-replit-sync';

/**
 * Fetch Stripe credentials from the Replit connection API.
 *
 * Credentials intentionally are not read from source-controlled configuration or
 * cached in a module global. Replit can rotate a connection without a rebuild.
 */
export async function getStripeCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error('Stripe connection is not configured.');
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: {
        Accept: 'application/json',
        X_REPLIT_TOKEN: xReplitToken
      },
      signal: AbortSignal.timeout(10_000)
    }
  );

  if (!response.ok) {
    throw new Error(`Stripe connection request failed (${response.status}).`);
  }

  const data = await response.json();
  const connection = data?.items?.[0];
  const settings = connection?.settings || connection?.config || connection?.connector_config;
  const secretKey = [settings?.secret_key, settings?.secretKey, settings?.secret]
    .find((candidate) => typeof candidate === 'string' && candidate.length > 0);
  if (!secretKey) {
    throw new Error('Stripe connection has no secret key.');
  }

  return {
    secretKey,
    webhookSecret: typeof settings.webhook_secret === 'string'
      ? settings.webhook_secret
      : typeof settings.webhookSecret === 'string'
        ? settings.webhookSecret
        : ''
  };
}

export function stripeModeFromSecret(secretKey) {
  if (secretKey.startsWith('sk_test_')) return 'test';
  if (secretKey.startsWith('sk_live_')) return 'live';
  return 'unavailable';
}

export async function getStripeMode() {
  const { secretKey } = await getStripeCredentials();
  return stripeModeFromSecret(secretKey);
}

/**
 * Return a fresh Stripe client so credential rotation is respected.
 */
export async function getUncachableStripeClient() {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

/**
 * Return a fresh sync engine. Migrations must be run before calling this
 * function in a normal runtime.
 */
export async function getStripeSync() {
  if (!process.env.DATABASE_URL) {
    throw new Error('PostgreSQL is not configured.');
  }

  const { secretKey } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: process.env.DATABASE_URL },
    stripeSecretKey: secretKey,
    // The connector secret is not necessarily the secret for the managed
    // endpoint created below. StripeSync resolves the DB-managed secret when
    // this is empty.
    stripeWebhookSecret: ''
  });
}

/**
 * Keep webhook processing deliberately minimal. The sync engine owns Stripe
 * schema writes; the website never writes to stripe.* tables directly.
 */
export async function processStripeWebhook(payload, signature, sync = null) {
  if (!Buffer.isBuffer(payload)) {
    throw new Error('Stripe webhook payload must be raw bytes.');
  }
  if (typeof signature !== 'string' || !signature) {
    throw new Error('Stripe webhook signature is missing.');
  }
  const stripeSync = sync || await getStripeSync();
  await stripeSync.processWebhook(payload, signature);
}