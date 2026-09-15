---
name: Post-merge database safety
description: Why automatic schema push is unsafe here and why its exit status is insufficient.
---

Keep automatic post-merge dependency reconciliation separate from reviewed database migrations. Do not reinstate an unconditional Drizzle schema push without first establishing that its schema describes all existing tables.

**Why:** A reconciliation retry proposed deletion of populated tables because the Drizzle schema was only a scaffold. In a non-interactive shell, Drizzle printed a confirmation/TTY error but the setup runner still reported success. A zero exit status alone did not prove successful or safe reconciliation.

**How to apply:** Inspect setup stdout and stderr as well as the returned success flag. Never add force or automatic confirmation to silence schema-deletion prompts. Database changes need explicit, reviewed migrations rather than schema synchronization from an incomplete model.