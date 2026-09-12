import { runMigrations } from 'stripe-replit-sync';
import {
  getStripeMode,
  getStripeSync,
  getUncachableStripeClient
} from './stripeClient.js';

function configuredOrigin(config, isProduction) {
  if (isProduction) return config?.productionOrigin || null;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (typeof domain !== 'string' || !domain.trim()) return null;
  const value = domain.trim().startsWith('http') ? domain.trim() : `https://${domain.trim()}`;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Prepare the sync schema, managed webhook, and local catalog. Any provider
 * failure is contained so the documentation site can continue to serve while
 * commerce reports unavailable.
 */
export async function initializeStripeRuntime({ config, isProduction = false, basePath = '/website' } = {}) {
  if (!process.env.DATABASE_URL) {
    return {
      mode: 'unavailable',
      sync: null,
      client: null,
      message: 'Checkout is temporarily unavailable.'
    };
  }

  try {
    await runMigrations({
      databaseUrl: process.env.DATABASE_URL,
      schema: 'stripe'
    });

    const sync = await getStripeSync();
    const origin = configuredOrigin(config, isProduction);
    if (origin) {
      const prefix = basePath ? `/${basePath.replace(/^\/+|\/+$/g, '')}` : '';
      await sync.findOrCreateManagedWebhook(`${origin.replace(/\/+$/, '')}${prefix}/api/stripe/webhook`);
    }

    // Await the backfill before exposing status so the catalog comes from the
    // same PostgreSQL sync database as checkout validation.
    await sync.syncBackfill({ object: 'all' });
    const mode = await getStripeMode();
    const client = sync.stripe || await getUncachableStripeClient();
    return {
      mode,
      sync,
      client,
      message: mode === 'test' ? 'Sandbox checkout is available.' : 'Live checkout is not enabled for this release.'
    };
  } catch {
    return {
      mode: 'unavailable',
      sync: null,
      client: null,
      message: 'Checkout is temporarily unavailable.'
    };
  }
}