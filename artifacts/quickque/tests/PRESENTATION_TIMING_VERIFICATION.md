# Presentation timing verification

## Verified in Linux / Chromium

- TypeScript typecheck passes.
- Vite production build passes with `PORT=24952 BASE_PATH=/demo/` supplied to the
  build command. Existing startup-script, source-map and chunk-size warnings
  remain non-fatal.
- 125 Node tests passed across presentation lifecycle/timer/scheduler, logical
  resume persistence, Flow, remote command/service regressions, presentation
  preferences and reader geometry/tokenization.
- A targeted 48-test lifecycle/Flow/remote pass also confirms that reanchor
  preparation freezes elapsed time, publishes `playing: false`, and resumes on
  listening without another countdown or capture start; pausing preparation
  rejects a late listening acknowledgement.
- Browser coverage: 11 timing tests plus the existing reader-layout regression
  passed. The initial integrated pass was followed only by omitted cases and
  focused regressions for reviewed end-state bugs, not repeated full suites.

Commands for future verification:

```sh
pnpm --filter @workspace/quickque typecheck
pnpm --filter @workspace/quickque test:presentation
pnpm --filter @workspace/quickque test:resume
pnpm --filter @workspace/quickque test:flow
pnpm --filter @workspace/quickque test:remote
pnpm --filter @workspace/quickque test:reader-browser
```

Coverage includes cancelled countdowns, native frontend toggle events, exit
during countdown, ordinary resume, pause-frozen time/progress, timed completion,
font/window reflow, persisted paused resume, speed override, hidden clocks and
controls, wheel interruption, focused-button Space, wrapped tokenless copy,
title-only tails, completed outward gestures and rewinding/reopening.

## Awaiting a Mac

No physical phone pairing, native global-shortcut registration, WKWebView
rendering, real microphone capture/teardown, Apple speech recognition or Mac
installer was verified here. Frontend CustomEvent/reducer tests are not proof
of native transport or hardware operation. Follow the presentation-timing
checklist in `../DESKTOP.md` before shipping the Mac build.