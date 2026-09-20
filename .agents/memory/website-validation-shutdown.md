---
name: Website validation shutdown
description: Node website link-check behavior after SSR and asset fetches
---

The Quickque website link validator should exit explicitly after its final success output because Node's fetch connection pool can retain idle sockets in the managed preview environment.

**Why:** The validator completed all assertions and printed its success summary but otherwise remained alive until the command timeout, which made a passing route check look failed to automation.

**How to apply:** Keep the explicit exit at the end of `artifacts/quickque-website/scripts/check-site.mjs`, after all assertions and success output. Do not use it to bypass assertion failures.