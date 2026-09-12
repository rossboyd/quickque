import { getStripeMode, getUncachableStripeClient } from "./stripeClient";

const PRODUCT_KEY = "quickque_mac_perpetual_gbp";
const rawPrice = process.env.QUICKQUE_PRICE_GBP;
if (typeof rawPrice !== 'string' || !/^[1-9]\d{0,5}(?:\.\d{1,2})?$/.test(rawPrice.trim())) {
  throw new Error('QUICKQUE_PRICE_GBP must be a positive GBP amount with no more than two decimal places.');
}
const AMOUNT = Math.round(Number(rawPrice.trim()) * 100);
const CURRENCY = "gbp";
const VERSION = process.env.QUICKQUE_COMMERCE_VERSION || "0.1.0";
const PRODUCT_DESCRIPTION = "Sandbox catalogue entry for the unreleased Quickque Mac app.";

const metadata = {
  product_key: PRODUCT_KEY,
  product_name: "Quickque for Mac",
  amount: String(AMOUNT),
  currency: CURRENCY,
  billing: "one-time",
  licence: "Use the purchased version forever.",
  updates: "Future major upgrades may cost extra.",
  source_licence: "MIT",
  live_enabled: "false",
  release_status: "unavailable",
  version: VERSION,
};

function sanitizedProviderFailure(error: unknown, stage: string): string {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const constructorName = candidate.constructor && typeof candidate.constructor === "function"
    ? (candidate.constructor as { name?: unknown }).name
    : undefined;
  const className = typeof constructorName === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(constructorName)
    ? constructorName
    : "Error";
  const statusValue = candidate.statusCode ?? candidate.status;
  const status = typeof statusValue === "number" && Number.isInteger(statusValue) && statusValue >= 100 && statusValue <= 599
    ? String(statusValue)
    : "none";
  const code = typeof candidate.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(candidate.code)
    ? candidate.code
    : "none";
  return `Quickque test catalogue seed failed [stage=${stage} class=${className} httpstatus=${status} providercode=${code}].`;
}

let seedStage = "connection";
const runSeed = async () => {
  seedStage = "mode";
  const mode = await getStripeMode();
  if (mode !== "test") {
    const error = new Error("Quickque seed is test-mode only; no live product was changed.") as Error & { code?: string };
    error.code = mode === "live" ? "live_mode_refused" : "unknown_secret_mode";
    throw error;
  }

  seedStage = "stripe-client";
  const stripe = await getUncachableStripeClient();
  seedStage = "product-search";
  const products = await stripe.products.search({
    query: `metadata['product_key']:'${PRODUCT_KEY}'`,
    limit: 100,
  });
  let product = products.data.find((candidate) => candidate.active) || products.data[0];

  seedStage = "product-write";
  if (!product) {
    product = await stripe.products.create({
      name: metadata.product_name,
      description: PRODUCT_DESCRIPTION,
      metadata,
    });
  } else {
    product = await stripe.products.update(product.id, {
      active: true,
      name: metadata.product_name,
      description: PRODUCT_DESCRIPTION,
      metadata,
    });
  }

  seedStage = "price-search";
  const prices = await stripe.prices.list({
    lookup_keys: [PRODUCT_KEY],
    active: true,
    limit: 100,
  });
  let price = prices.data.find((candidate) => candidate.product === product.id);

  if (price && (
    price.unit_amount !== AMOUNT ||
    price.currency !== CURRENCY ||
    price.type !== "one_time" ||
    price.tax_behavior !== "inclusive"
  )) {
    throw new Error("The existing Quickque test price does not match the server-owned catalogue.");
  }

  seedStage = "price-write";
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: AMOUNT,
      currency: CURRENCY,
      tax_behavior: "inclusive",
      lookup_key: PRODUCT_KEY,
      metadata,
    });
  } else {
    price = await stripe.prices.update(price.id, { active: true, metadata });
  }

  seedStage = "default-price";
  if (product.default_price !== price.id) {
    await stripe.products.update(product.id, { default_price: price.id });
  }

  console.log(`Quickque test catalogue ready: ${product.id} / ${price.id}`);
};

runSeed().catch((error: unknown) => {
  console.error(sanitizedProviderFailure(error, seedStage));
  process.exitCode = 1;
});