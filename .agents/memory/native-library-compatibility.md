---
name: Native library compatibility
description: Preserve chosen-folder scripts and browser-owned library metadata during hydration.
---

Treat the chosen native folder as a readable source, not merely a destination
for autosaving the browser cache. Preserve browser-owned trash, ordering and
selection metadata when hydrating its script-only payload.

**Why:** A valid native library may be the only copy when browser storage is
fresh. Conversely, older native snapshots cannot express newer browser deletion
intent and must not resurrect trashed scripts. Neither source can blindly
replace the other.

**How to apply:** Retain edits made while native reads are pending, exclude
trashed identities, and commit the reconciled browser state atomically. Recovery
must block native writes both when scheduled and when a queued write executes,
so clearing visible state for recovery never overwrites a good native file.