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

When checking a reflow, measure the *previously captured span*, not merely the
new nearest span. A changed line wrap can put another word on the same line or
closer to the guide without losing the saved word.

**Why:** Nearest-span identity alone produced ambiguous browser evidence when
typography and mirroring changed together. Conversely, staying in the same
section is too weak to establish preservation of the reading location.

**How to apply:** Record a stable span id and its logical guide-relative offset
before each change, then compare that same span afterward. For external window
resizes, use a pre-resize snapshot kept current during scrolling; measurements
made after ResizeObserver fires already reflect the new layout.

Keep viewport-relative spacers inside the scroll content, not as padding on the
element whose client height determines those spacers.

**Why:** In short overlay windows the padding can exceed the available height,
so measuring and recalculating padding becomes a self-referential resize loop.
This escaped arithmetic unit tests and appeared only in the 360 × 260 DOM test.

Do not use Flow token counts or a final inline span's leading edge to decide
where manual reading ends. Measure the trailing edge of the rendered section.

**Why:** Manual copy can be scrollable without speech tokens (emoji or
punctuation), and one inline text span can wrap across many lines. A trailing
section may also contain only its visible heading. Token-based endpoints or
leading-edge-plus-one-line estimates silently mark these scripts complete early.

**How to apply:** Include wrapped non-token copy and title-only final sections
when checking completion or remaining-distance calculations, in both mirrors.