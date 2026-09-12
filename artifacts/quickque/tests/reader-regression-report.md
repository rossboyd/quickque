# Presentation layout validation

## Browser — passed, 2026-09-12

Run with the Quickque web workflow serving the app:

```sh
pnpm --filter @workspace/quickque run test:reader-browser
```

`QUICKQUE_URL` optionally selects another running app URL. `CHROMIUM_PATH`
optionally selects a local Chromium executable. Tests use an isolated browser
context and test-only localStorage fixtures.

The final repeatable regression checks:

- First/last section headings align with the logical cue.
- No mirror, horizontal, vertical and combined mirror preserve the same word's
  logical guide-relative offset. The physical leading edge reverses under
  vertical mirroring; the already-normalized logical offset must not reverse.
- Font size, line spacing, margins and cue positions of 10% and 80% preserve
  the word captured immediately before each change, within 2 CSS pixels.
- Wheel scrolling advances the source document; the newly current word is
  captured before testing resize, not the word from before the wheel gesture.
- Resizing from the full reader to 360 × 260 preserves that word within 2px.
  Final observed offsets were 9.375px before and 9.078125px afterward.
- Compact-mode transition preserves the new reading location.

The initial browser inspection also confirmed:

- Legacy settings migration and per-script preference persistence on reload.
- Hidden, line and side-arrow cues; all mirror controls; labelled range inputs.
- Escape closes Present settings without exiting the reader; range arrow keys
  do not navigate sections; controls remain unmirrored.
- Speed 150 persists in future defaults without changing existing scripts.
- Reset future defaults leaves existing scripts unchanged; reset current script
  affects only that script; duplication retains its presentation preferences.
- Simulated default-storage failure shows an error and retains stored values.

Earlier exploratory reports were superseded by fixes and this deterministic
regression. In particular, viewport spacers now live inside the content, avoiding
a padding/height feedback loop in very short windows. Mirror tests compare
logical leading edges, not unconditionally the painted top edge.

## Automated code checks — passed

Typecheck and production frontend build passed. Library, preference, appearance,
reader geometry/tokenization/surface, Flow and phone-command suites passed.
The production build retains non-blocking startup-script, source-map and bundle
size warnings.

## Native Mac / WKWebView — not run

This Linux browser validation does **not** validate native transparency,
window restoration, physical phone pairing, Apple speech capture or WKWebView
layout behavior. See the separate native acceptance checklist in `DESKTOP.md`.