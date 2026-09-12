import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

type StripeCredentials = {
  secretKey: string;
  webhookSecret?: string;
};

async function getStripeCredentials(): Promise<StripeCredentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !xReplitToken) {
    const error = new Error("Stripe connection is not configured.") as Error & { code?: string };
    error.code = "missing_connection_context";
    throw error;
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: xReplitToken,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    let providerCode: string | undefined;
    try {
      const body = await response.json() as { code?: unknown; error?: { code?: unknown } };
      const candidate = body.code ?? body.error?.code;
      if (typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(candidate)) {
        providerCode = candidate;
      }
    } catch {
      // The response body is deliberately not retained or surfaced.
    }
    const error = new Error(`Stripe connection request failed (${response.status}).`) as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = response.status;
    if (providerCode) error.code = providerCode;
    throw error;
  }

  const data = await response.json() as {
    items?: Array<{
      settings?: { secret_key?: string; secretKey?: string; secret?: string; publishable_key?: string; webhook_secret?: string; webhookSecret?: string };
      config?: { secret_key?: string; secretKey?: string; secret?: string; publishable_key?: string; webhook_secret?: string; webhookSecret?: string };
      connector_config?: { secret_key?: string; secretKey?: string; secret?: string; publishable_key?: string; webhook_secret?: string; webhookSecret?: string };
    }>;
  };
  const item = data.items?.[0];
  const settings = item?.settings ?? item?.config ?? item?.connector_config;
  const secretKey = [settings?.secret_key, settings?.secretKey, settings?.secret]
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  if (!secretKey) {
    const error = new Error("Stripe connection has no secret key.") as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = response.status;
    const configField = item && typeof item === "object"
      ? ["settings", "config", "connector_config"].find((key) => Object.prototype.hasOwnProperty.call(item, key))
      : undefined;
    const settingKey = settings && typeof settings === "object"
      ? ["secret_key", "secretKey", "secret", "api_key", "apiKey", "private_key", "privateKey", "stripe_secret_key"]
        .find((key) => Object.prototype.hasOwnProperty.call(settings, key))
      : undefined;
    error.code = configField
      ? `missing_secret_key_${configField}_${settingKey || "no_known_key"}`
      : "missing_secret_key_no_config";
    throw error;
  }
  return {
    secretKey,
    webhookSecret: settings?.webhook_secret ?? settings?.webhookSecret,
  };
}

export function stripeModeFromSecret(secretKey: string): "test" | "live" | "unavailable" {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return "unavailable";
}

export async function getStripeMode(): Promise<"test" | "live" | "unavailable"> {
  const { secretKey } = await getStripeCredentials();
  return stripeModeFromSecret(secretKey);
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync(): Promise<StripeSync> {
  if (!process.env.DATABASE_URL) throw new Error("PostgreSQL is not configured.");
  const { secretKey } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: process.env.DATABASE_URL },
    stripeSecretKey: secretKey,
    // Managed webhook processing must resolve the endpoint secret stored in
    // stripe._managed_webhooks, not a connector-level webhook secret.
    stripeWebhookSecret: "",
  });
}