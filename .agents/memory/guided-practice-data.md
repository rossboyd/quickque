---
name: Guided practice data
description: Ownership and portability rules for actor learning preferences and reflections.
---

Practice mode, selected ranges, and difficult-passage bookmarks are device-local learning choices. Preserve them in the local/full library, but omit them from portable script sharing. Reflections use the separate personal-note layer.

**Why:** These fields describe the actor's private learning process, not the writer's source material. Protected scripts must accept them without allowing dialogue or writer-direction edits.

**How to apply:** Any new practice preference needs a protected-safe mutation path, bounded validation, content-change cleanup, and explicit portable-export exclusion.

Bookmark changes should affect the next practice run rather than silently changing the passage being rehearsed. Deleted source turns must still be excluded immediately.

**Why:** An actor may unmark a difficult passage after improving it while still writing a reflection or replaying it. Mutating the running selection would interrupt that work and make navigation unpredictable.

**How to apply:** Distinguish editing saved bookmarks from changing source content. Resolve a run against current source identities, not stored numerical positions, and never transfer a note draft to a different passage.

Test in-session personal-data edits with a computer-partner cast, not only all-human casts.

**Why:** All-human readiness resolves immediately and React may batch away its checking state. A computer partner awaits native checks, exposing a checking interval that can disable the scene and discard the active queue if unrelated personal edits retrigger readiness.

**How to apply:** Keep runtime readiness keyed to playback-relevant inputs and exercise delayed partner readiness when checking whether note/bookmark saves preserve a session.