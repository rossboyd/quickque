---
name: Flow diagnostic evidence
description: Distinguish absent native events from a slow model check when debugging Mac-only startup.
---

Do not infer which native operation is stuck from a frontend timeout alone.
Separate listener subscription, Rust command receipt, helper startup, stdin
receipt, and model integrity checking using checkpoints emitted at those stages.

**Why:** A Rust loading acknowledgement proves only the Rust bridge, not
execution of a Swift model check. Attributing a timeout to model hashing
without an input-receipt checkpoint led to unnecessary rebuilds.

**How to apply:** Use the last observed checkpoint to narrow the fault before
changing deadlines or asking for another rebuild. Report an unobserved stage
as unknown, not successful. Keep traces restricted to fixed labels and numeric
metadata so troubleshooting cannot retain speech content.

Persistent command pipes must deliver short messages without requiring the
writer to close or the requested buffer size to fill.

**Why:** High-level buffered read behavior can differ from the "up to" semantics
suggested by an API name. A pipe producer keeping its writer open is normal,
not evidence that a command has not been flushed.

**How to apply:** Verify input transport with an open writer and a short message
before changing model startup or microphone behavior.
