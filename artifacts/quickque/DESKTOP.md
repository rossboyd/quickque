# Quickque for macOS

This directory contains a lightweight Tauri v2 wrapper around the same React
application used on the web. The native window supports transparency, while the
ordinary app remains visually opaque because the UI supplies its background.
Overlay opacity is likewise controlled by the UI's CSS RGBA colors, not by a
native whole-window opacity setting.

## Prerequisites

- A Mac with the Xcode Command Line Tools (`xcode-select --install`)
- The stable Rust toolchain installed with rustup
- Node.js and pnpm

From the repository root, install workspace dependencies normally, then run:

```sh
pnpm install
pnpm --filter @workspace/quickque desktop:dev
pnpm --filter @workspace/quickque desktop:build
```

The desktop Vite configuration uses local port 1420 and does not need Replit's
`PORT` or `BASE_PATH` environment variables. It produces `dist-desktop/` and
does not include the Replit development plugins. The app bundle loads packaged
assets only; the desktop CSP does not permit arbitrary network or remote font
loading.

Tauri writes native artifacts beneath `artifacts/quickque/src-tauri/target/`.
Release `.app` and `.dmg` outputs are normally in
`src-tauri/target/release/bundle/macos/` and
`src-tauri/target/release/bundle/dmg/`. A local build may be run unsigned for
local use. Distribution to other Macs requires an Apple Developer identity,
code signing, and normally notarization; those credentials are intentionally
not part of this repository.

## Overlay behavior and shortcuts

Entering overlay mode compacts the same window to 620 × 380, with a 360 × 260
minimum, hides native decorations, keeps it above ordinary windows, and asks
macOS to show it on all Spaces. Exiting restores the saved position, size,
decorations, and minimum size. The bridge registers shortcuts only while the
overlay is active and unregisters them on exit:

- Command-Shift-Space: `quickque:control` with detail `toggle`
- Command-Shift-Left: `quickque:control` with detail `previous`
- Command-Shift-Right: `quickque:control` with detail `next`

Registration errors, including a shortcut already owned by another app, reject
the bridge promise rather than being silently ignored. Browser bridge calls are
no-ops. A web page cannot pin itself above other windows and this project does
not claim browser pinning support.

macOS controls Space and full-screen placement. “All workspaces” improves
visibility across normal Spaces but does not guarantee that an overlay appears
above another application's exclusive full-screen Space. Screen sharing and
recording software may capture the overlay, including during full-screen
sharing; users should verify the selected capture source before presenting.

## Local data

The web origin and Tauri application have separate `localStorage`. Existing web
data is not migrated automatically. Use the application's export function in
the web version and import that file in the desktop version when migration is
needed.

## Platform validation

The Rust source and configuration can be inspected on Linux, but macOS window,
global-shortcut, `.app`, DMG, signing, notarization, Space, and full-screen
behavior must be validated on a Mac.