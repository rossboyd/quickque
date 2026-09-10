# Quickque for macOS

This directory contains a lightweight Tauri v2 wrapper around the same React
application used on the web. The native window supports transparency, while the
ordinary app remains visually opaque because the UI supplies its background.
Overlay opacity is likewise controlled by the UI's CSS RGBA colors, not by a
native whole-window opacity setting.

## Prerequisites

- An Apple Silicon Mac running macOS 14 or newer. Intel Macs are unsupported
  for local Flow and fail closed; there is no browser or cloud fallback.
- Xcode 16 (including the Swift 6 toolchain) or a compatible newer Xcode.
  Install its command-line tools with `xcode-select --install`.
- The stable Rust toolchain installed with rustup
- Node.js and pnpm

From the repository root, install workspace dependencies normally, then run:

```sh
pnpm install
pnpm --filter @workspace/quickque desktop:dev
pnpm --filter @workspace/quickque desktop:build
```

Both desktop commands first run `native:build`. That command resolves the
Swift package, compiles an arm64 release helper, and places the target-suffixed
sidecar where Tauri packages it. To build the helper by itself:

```sh
pnpm --filter @workspace/quickque native:build
```

The helper pins FluidAudio directly to immutable upstream commit
`41540ea237350afe5117a082b5c28eda642d0612` (the 0.15.7 release) through Swift Package Manager and
uses its real `StreamingEouAsrManager` with the 160 ms Parakeet EOU variant.
The native source remains a normal Swift package, so it can also be opened or
built directly with SwiftPM. `scripts/build-flow-helper.sh` is the supported
packaging path because it gives the sidecar Tauri's required target suffix.

The desktop Vite configuration uses local port 1420 and does not need Replit's
`PORT` or `BASE_PATH` environment variables. It produces `dist-desktop/` and
does not include the Replit development plugins. The app bundle loads packaged
assets only; the desktop CSP does not permit arbitrary network or remote font
loading.

## Local Flow model and privacy

Flow is optional. Checking model status does not request microphone permission
and never downloads anything. The user must explicitly choose Download before
the helper contacts these documented Hugging Face repositories:

- `FluidInference/parakeet-realtime-eou-120m-coreml`, 160 ms variant, for
  English streaming ASR (the integration recorded model revision
  `40a23f4c0b333aa17ad8c0f2ea47ec2347f2f355`)
- `FluidInference/silero-vad-coreml` for transcript-independent speech activity
  (revision `b419383c55c110e2c9271fa6ee0ea83d03c70d96`)

The helper lists and downloads only through Hugging Face URLs containing the
immutable commit hashes above; it never uses `tree/main` or `resolve/main`.
The progress total is calculated from that immutable manifest. Quickque checks
every downloaded file against its immutable-manifest length, moves each
completed temporary download atomically into the cache, then enables
FluidAudio's offline mode and loads every required CoreML graph. It writes its installation
marker atomically only after both ASR and VAD load successfully. The marker
contains a SHA-256 digest over the installed model trees, which is rechecked by
Status and Start. Missing, changed, empty, incomplete, or unloadable models fail
closed. Cancel never marks an incomplete installation as usable. Models are durably cached under:

```text
~/Library/Application Support/Quickque/Flow/
```

After installation, Start forces FluidAudio offline mode. It cannot repair or
download a model while requesting microphone access. A damaged cache produces
an actionable error and must be repaired with another explicit Download.

Microphone permission is requested only by Start. Audio is captured from the
selected microphone (never system audio), processed in memory, and is not sent
to a service or written to a recording. Transcripts are transient JSON events;
the helper does not persist or log them. The pinned FluidAudio EOU/VAD paths
were audited for transcript logging: they log model lifecycle, chunk counters,
and EOU timestamps, but not audio or transcript text. Quickque explicitly
disables FluidAudio debug-feature capture and discards the helper's diagnostic
stderr. No transcript logger is registered.

One serial FIFO holds at most four 256 ms microphone buffers (including the
buffer in inference), allowing ordinary CoreAudio bursts without accumulating
an unbounded in-memory recording. Capacity overflow fails visibly, clears
pending buffers, tears down capture, and exits the helper. A continuous utterance is finalized and resets
native decoder context after two minutes, bounding rolling transcript state.
Rust also caps each helper event line at 1 MiB and terminates malformed helpers.
Native Silero VAD, not transcription
or script matching, resets a monotonic 30-second silence deadline, including
while the overlay is in the background. Off-script speech therefore keeps the
session alive. Pause, Stop, cancel, a replacement generation, application exit,
and shutdown terminate the helper process, microphone tap, inference, and any
active download.

The app and helper communicate only through inherited stdin/stdout JSON lines.
No TCP listener, account, API key, cloud inference, or silent fallback exists.
Every command and event carries the frontend's generation. Rust rejects output
from replaced helper processes, and every Start resets transcript sequence to
zero and creates fresh utterance context.

FluidAudio is Apache-2.0 licensed. The Parakeet weights are separately licensed
under the **NVIDIA Open Model License**, not MIT or Apache-2.0. Silero VAD is
MIT licensed. The packaged `THIRD_PARTY_NOTICES.txt` records sources, revisions,
and license links.

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

This implementation has not been natively compiled or run in the Linux
development environment. In particular, microphone authorization, helper
packaging, model download/cancellation and offline reload, CoreML/ANE behavior,
the exact 30-second stop boundary, helper cleanup, accuracy, latency, memory,
CPU/ANE use, and coexistence with a meeting app remain Mac-only validation
items. Do not treat an ordinary web build or Linux static inspection as a
verified macOS installer.

Upstream's model card reports the selected 160 ms model at 8.29% WER on
LibriSpeech test-clean and 4.78× real-time throughput on an M2. Those are
upstream benchmark figures, not measurements of Quickque or promises of
performance. Quickque-specific accuracy, end-to-end latency, and resource use
must be measured on supported hardware before release.