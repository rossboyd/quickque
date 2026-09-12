# Chatterbox Turbo in Quickque

The user requested open-source Chatterbox with a free voice for an M2 / 24 GB
Mac. The integrated engine uses **Chatterbox Default**, the default `conds.pt`
from ResembleAI/chatterbox-turbo. The upstream model metadata and Chatterbox
source are MIT. No paid service, key, account, or user Python is required.

## User flow

Scene Partner setup → expand an AI Partner character → Voice Engine →
**Chatterbox Turbo (Free · Local)** → **Download Chatterbox · 2.99 GB**.
When installed, preview **Chatterbox Default**, close setup, and rehearse.
Each character keeps its assignment and colour. This version offers one
English voice shared by all Chatterbox characters, at its natural rate (1×).
Existing system-voice assignments are preserved until the user changes them.
The browser can edit/save the assignment; synthesis runs in the Mac app.

The download is explicit and cancellable. Model files and default conditioning
are pinned by SHA-256 and size in `model-lock.json`. No extra decoder or arbitrary
reference audio is downloaded. Incomplete downloads cannot become installed
models; staging is recovered on the next attempt after a hard cancellation.
Normal synthesis has offline environment flags and Python network connections
blocked. Scripts enter the worker on stdin, never as arguments or files.
Audio is played directly from RAM. The official Perth watermark is retained.

## Desktop build

Run `pnpm --filter @workspace/quickque desktop:build` on Apple Silicon with the
existing Xcode/macOS 26 toolchain and `uv` installed on the build machine.
The build creates an isolated Python 3.11 environment from the committed
`requirements-macos.lock`, freezes a native arm64 **onedir** worker using
PyInstaller, includes package metadata/notices and Perth's model assets, and
places that directory in the app's resources. A frozen-runtime check imports
Chatterbox and sounddevice, loads the Perth watermarker and requires MPS before
Tauri packaging proceeds. Runtime dependencies are never installed on launch.

Model files are installed beneath Tauri's Quickque app-data directory in
`chatterbox-turbo-v1`. They are separate from app updates and script backups.
The packaged helper lives at `Contents/Resources/turbo-runtime/quickque-turbo`.
A developer can override its path with `QUICKQUE_TURBO_HELPER`; that executable
must implement the same CLI and JSON protocol. No override is needed in builds.

Upstream pins:

- Chatterbox: `5de7a54aa4e5e2baadb0182dde554908b48b85c2`
- Model: `749d1c1a46eb10492095d68fbcf55691ccf137cd`
- Perth: `ff1c8ac55a976971245cdd53c18d6131ca00d993`
- Default conditioning SHA-256:
  `b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033`

Source and model: https://huggingface.co/ResembleAI/chatterbox-turbo
Source licences are in `CHATTERBOX-LICENSE.txt` and `PERTH-LICENSE.txt`.
The user's explicit request supersedes the earlier commissioned-voice-pack gate
for this upstream default. We do not label it as a particular actor or claim an
independent voice-consent audit.

## Tests and practical limits

`pnpm turbo:test` tests default-voice integrity, invalid requests, bounded text
splitting without dropping words, download cancellation and partial-file safety.
Scene adapter tests verify native engine routing and browser rejection; library
and browser tests cover setup validation and persistence of the assignment.

The existing native child-process stop barrier covers Turbo as well as system
speech: stop kills/reaps the worker before microphone following can resume.
The worker is onedir (no extraction subprocess). Within a turn it prepares and
plays one bounded passage at a time. Output bounds are checked after generation,
so peak model memory still needs measurement. It does not cache whole scripts.

This first integration loads/verifies the model for each turn. Cold starts and
gaps between passages may be noticeable; no low-latency or peak-memory guarantee
has been measured. A warm resident worker is a future optimisation, requiring
its own cancellation and invalidation tests.

**Not verified on this Linux development host:** frozen arm64 build, actual
speaker output, no-network operation at OS level, Mac cancellation latency,
M2 memory use, native signing/notarization and the resulting DMG. Run the Mac
build and a rehearsal/preview smoke test before distributing that build. The
runtime build check is necessary but does not replace an audible end-to-end test.
