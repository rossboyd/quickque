---
name: Reader reflow anchoring
description: Why font changes need pre-update word measurements, not scroll percentages or parent layout cleanup.
---

Preserve a stable word and its guide-relative viewport offset when changing
script font metrics. Capture the old geometry synchronously before requesting
the state update, and restore after the new layout commits.

**Why:** Relative scroll percentages drift when sections wrap differently or
contain fixed padding. React may mutate descendant host styles before a parent
layout-effect cleanup, so measuring in that cleanup can silently record the new
font instead of the old one. Pure arithmetic tests cannot catch this ordering
failure.

**How to apply:** Keep local appearance controls and phone font-size updates on
the same pre-update measurement path. Verify actual DOM span identity and
guide-relative offset after a font change; a passing scroll-math test alone does
not establish reading-position preservation.