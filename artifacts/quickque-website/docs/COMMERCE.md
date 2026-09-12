# Quickque commerce runbook

## What is sold

Quickque for Mac is a **£77 GBP one-time** purchase. The purchased version may
be used forever. Future major upgrades may cost extra. The source is MIT
licensed. This website does not issue a licence key or download from a
sandbox payment.

The server owns the Stripe price (`quickque_mac_perpetual_gbp`) and always
validates the synced product metadata, amount, currency, one-time mode, and
browser binding. Browser input cannot select a price, amount, or Stripe mode.

## Prerequisites

- The Stripe Replit connection is attached; credentials are fetched at runtime
  through the connection API, never committed to the repository.
- PostgreSQL and `DATABASE_URL` are available, and `SESSION_SECRET` is set.
- The server startup runs `stripe-replit-sync` migrations, registers the
  managed webhook, and awaits a backfill. The raw webhook route must remain
  before JSON parsing.
- In development, seed the connected Stripe **test** account:

  ```sh
  pnpm --filter @workspace/scripts exec tsx src/seed-quickque.ts
  ```

  The seed is idempotent and refuses to alter live mode. It creates or
  validates the real product and price through Stripe's API and uses inclusive
  tax behavior. The provider product description deliberately identifies this
  as a sandbox catalogue entry for the unreleased Mac app; it must not claim a
  verified release.

## Sandbox versus release gate

**Current state: sandbox-only.** There is no fulfilment or download path in
this deployment. A successful test payment is only a payment-flow check and
does not make the Mac app available.

Development and the published demo can expose hosted Stripe Checkout only when
the connected runtime and validated catalogue are both in Stripe test mode and
the appropriate trusted origin is configured. The published demo intentionally
uses the same sandbox checkout and does not require live Stripe credentials.
A successful test payment is reported explicitly as a test result; it never
grants a licence or download.

Live charges stay impossible until all of the following are true:

1. A prebuilt Mac release exists and has been verified on Apple Silicon.
2. `productionOrigin` is a confirmed HTTPS production origin.
3. The release, product metadata, and live Stripe catalogue have been reviewed.
4. The seller has completed Stripe account activation, business identity and
   bank verification, and enabled the intended payment methods.
5. The seller has confirmed applicable UK/international VAT treatment,
   inclusive pricing/tax registration, refund/cancellation terms, support
   contact, and Stripe dispute handling.
6. A production webhook has been verified end to end without exposing secrets.

Until then `liveEnabled` remains `false`, release status remains `unavailable`,
and all environments reject live mode. Production may present the clearly
labelled sandbox CTA, but it cannot accept a live charge or issue a licence or
download.

## Payment data and operations

Stripe-hosted Checkout handles payment details. The website must not collect,
log, or return card numbers, payment methods, customer email addresses, or
other payment PII. Treat Stripe dashboard data and synced payment records as
restricted payment data. Only a bound browser can query its checkout session;
session IDs are not confirmation credentials.

For a real release, document the support/refund process before enabling live
payments. Test successful, unpaid, expired, provider-failure, replay, and
cross-browser session cases in Stripe test mode first. The result endpoint
continues to return `downloadUrl: null` until an independently verified
release and fulfilment flow are deliberately added.