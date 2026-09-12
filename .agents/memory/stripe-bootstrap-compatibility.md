---
name: Stripe bootstrap compatibility
description: Runtime integration differences that can make a connected Stripe account appear unavailable.
---

Treat a missing template credential field as a possible adapter mismatch, not proof that Stripe needs reconnecting.

**Why:** The connected Stripe account returned its key under `settings.secret`, while the generic template checked only `secret_key`. The connection was healthy.

**How to apply:** Keep alias handling inside the server-side credential adapter. Diagnose using stage, error class and status only; never inspect or print credential values.

Await a complete catalogue backfill before advertising checkout availability.

**Why:** The default backfill call did not guarantee that the initial catalogue was queryable before readiness checks. Explicit `syncBackfill({ object: 'all' })` provided the awaited initial synchronization.

**How to apply:** Readiness needs a validated synced product/price, not merely a successful client construction.

Do not mix a connection-provided webhook secret with a separately registered managed webhook.

**Why:** The sync library prioritizes an explicitly supplied secret over its managed endpoint's stored secret. An unrelated connection secret can therefore reject legitimate managed events.

**How to apply:** Let managed-webhook verification select the managed endpoint secret; confirm an actual signed event reaches the synced records.