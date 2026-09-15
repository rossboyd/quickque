---
name: Rehearsal role authority
description: Keeps explicit human and computer cast responsibilities consistent across setup and playback.
---

An explicit cast responsibility is authoritative across setup checks, generated audio and live scene execution. A human role must never become synthetic speech merely because it is not the user's own role.

**Why:** A readiness-only role distinction can approve an all-human rehearsal while older playback or audio logic still treats every non-user role as a computer partner. That creates a false-ready state and can request missing voices after setup succeeds.

**How to apply:** Whenever rehearsal role categories change, audit the shared readiness gate, audio request derivation, scene lifecycle inputs and every launch entry path as one contract. Gate microphone setup only when word-follow is selected for a human turn.