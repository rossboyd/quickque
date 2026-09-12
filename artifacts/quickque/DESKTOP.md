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

The final command runs the native layout test, builds the Apple Silicon helper,
builds the desktop app, and creates:

```text
artifacts/quickque/src-tauri/target/release/bundle/dmg/Quickque_0.1.0_aarch64.dmg
```

Open that DMG and drag Quickque into Applications. Because a local development
build is not signed or notarized, macOS may block its first launch. In Finder,
Control-click Quickque in Applications, choose **Open**, then confirm **Open**.
Do not bypass Gatekeeper for a DMG you did not build yourself or receive from a
trusted source.

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

The ASR cache follows FluidAudio's pinned
`Models/parakeet-eou-streaming/160ms` layout. The VAD cache follows its pinned
`Models/silero-vad/silero-vad-unified-256ms-v6.2.1.mlmodelc` layout. A native
Swift test asserts both paths before the helper and DMG are built.

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

## Local phone remote

Click the small **Phone Remote** icon in the desktop reader. Quickque starts
the local session automatically and displays a QR code after a brief loading
state. Scan it with the phone's normal camera, open the link in its browser,
and approve the phone on the Mac. There is no separate server-start or phone
Pair step. Closing and reopening the dialog preserves the active session.
The optional manual local URL and six-digit code are a fallback, not required
for scanning.

The Mac serves the entire phone interface (including inline CSS and JavaScript)
on a local HTTP port. It needs no internet connection even on the phone's first
visit, and no app-store download, PWA installation, account, certificate
installation, public website, cloud relay, or network discovery service.
The browser preview cannot host this service; its manual reader remains usable.

The Tauri bridge:

* `remote_start()` is idempotent and returns
  `{ url, pairingUrl, code, expiresInSeconds, sessionId }`.
* `remote_status()` returns `{ status, sessionInfo, approved }`, distinguishing
  awaiting scan, awaiting approval, connected, disconnected, rejected, expired,
  and stopped. Recent phone activity determines connection status independently
  of approval.
* `remote_approve({ sessionId })` approves the one phone currently waiting for
  presenter approval; `remote_reject()` rejects that session's request.
* `remote_stop()` invalidates the session and its credentials immediately;
  replacement creates a new session and QR code.
* `remote_snapshot()` returns the intentionally minimal presentation state:
  `connected`, `approved`, `mode`, `section`, `sectionCount`, `elapsedMs`,
  `playing`, `fontSize`, `scrollSpeed`, and `position`.
* `remote_publish_state({ snapshot })` publishes the reader's authoritative
  state to the connected phone; its `connected` and `approved` flags remain
  controlled by the native session.
* `remote_take_commands()` returns and consumes each validated
  `{ action, value?, requestId }` exactly once; the reader polls this and routes
  actions through its normal command reducer.

The QR contains `pairingUrl`, a private LAN address and local port with a unique
session ID and a five-minute pairing code. The scanned page automatically sends
JSON `{ sessionId, code, clientId }` to `POST /api/pair`. The random client ID and
returned bearer token are stored in browser storage scoped to this session so
reloads, rescans in the same browser, and retries do not create competing
requests. They do not establish a persistent trusted-device identity.
The token cannot control the reader before explicit presenter approval.

`GET /api/events` with the controller token in the `Authorization: Bearer`
header returns `{ status, snapshot? }`. Pending approval is a distinct state,
not a generic authorization error; rejected and expired sessions give explicit
new-QR guidance. The bare local URL offers a manual-code form, obtaining the
current session ID from `/api/session` only when that form is submitted. A
stale scanned URL never silently switches to the current session.

Commands are JSON
`POST /api/control` requests with the same authorization header and
`{ action, value?, requestId }`;
actions are `playPause`, `previous`, `next`, `scrollSpeed`, `fontSize`, and
`position`. Request IDs are single-use replay protection. Pairing expires in
five minutes (including approval); an approved controller remains authorized
for the active session after that pairing window closes. Only one controller
is allowed and requests are rate limited.
No script, audio, transcript, or library contents are served. The service is
closed and all credentials invalidated on stop, replacement, leaving the
reader, and application exit.

The URL uses a usable private IPv4 LAN address discovered on the Mac, never
loopback or a public pairing service. With no usable address, Quickque explains
the problem instead of displaying a localhost QR. Both devices must be on the
same reachable trusted LAN: the Mac may use Ethernet while the phone uses
Wi-Fi. The Mac firewall and local-network permissions must permit Quickque;
guest Wi-Fi/client isolation, sleep, VPN routing, or unsupported browsers can
prevent connection. Use a current Safari, Chrome, or Firefox browser with
JavaScript, local storage, Fetch, AbortController, and Web Crypto random-value
support on HTTP. An embedded camera browser may need “Open in browser.”
The local page uses HTTP because ordinary phone browsers cannot trust an
app-generated LAN certificate. The token is kept out of URLs and browser
history, but the trusted-network requirement remains important because local
HTTP traffic is not encrypted.
The phone disables controls during unreachable or unapproved states and retries
at the same address after brief interruptions. Commands are never automatically
resent after ambiguous network failures. Network/IP changes require a new QR
session; automatic address-change recovery is not implemented.

### Remote verification

Run `pnpm --filter @workspace/quickque test:remote` for the phone script,
desktop lifecycle, and shared reader-command regressions. The protocol has
Rust tests alongside the service; run `sh tests/remote-protocol/run.sh` from
the repository root for its platform-neutral harness, which also runs on
Linux without the full Tauri GTK/WebKit dependency chain. These checks are
not proof of macOS firewall behavior or camera-to-browser behavior on a phone.

**Physical verification remains outstanding:** this development environment
has no Mac or physical phone. Before release, follow
[`REMOTE_OFFLINE_CHECKLIST.md`](REMOTE_OFFLINE_CHECKLIST.md), with the router's
internet uplink disconnected **before the first phone visit and camera scan**.
Record hardware/browser versions and actual results; do not mark the checklist
passed based on automated tests or the browser preview.

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

### Transparent overlay acceptance check

Browser transparency does not verify how the native macOS WebView composites
the transparent window. Before releasing a packaged macOS build:

1. Open Google Meet or an equivalent window showing a moving face or video.
2. Place Quickque's compact overlay over the video.
3. Set Background Opacity to 0%. The reading area must be fully clear and the
   video beneath it must remain sharp, with no frosted or blurred region.
4. Set Background Opacity to an intermediate value such as 40%. The video must
   remain sharp beneath only the selected background tint.
5. Confirm text, borders, status messages, and controls remain readable.
6. Leave compact mode, exit the reader, reopen it, and switch between compact
   and full reader modes. Full reader and library screens must remain opaque.

## Local data

The web origin and Tauri application have separate `localStorage`. Existing web
data is not migrated automatically. Use the application's export function in
the web version and import that file in the desktop version when migration is
needed.


### Document import

**Import Document** in the library accepts one TXT, DOCX, RTF, or text-based
PDF, from the file picker or by dropping a file. Review and edit its title and
plain text, then choose **Save as Script**. Cancel creates nothing. Duplicate
filenames create separate scripts. Rich styling and images are not retained;
PDF columns and reading order must be checked in the preview. Scans require
copying text or using OCR in another application.

Extraction is local, with no account, upload, document-triggered resource
downloads, or runtime CDN. A disposable bundled worker is terminated on cancel,
completion, or a 20-second deadline. Input is limited to 10 MiB, expanded content
to 32 MiB, PDF length to 500 pages, and output to 500,000 UTF-16 characters.
Parser-specific supported subsets and resource enforcement are documented in
`src/lib/document-import/PARSERS.md`.

Script saves use a single atomic local-storage record containing the library
and selection. Existing array storage is migrated locally, while **Backup
JSON / Restore JSON** remain the separate scripts-array backup format. Import
confirmation only succeeds after storage accepts the write. Storage errors
keep the review open and leave the old library and selection unchanged.

The Tauri window disables native drag/drop interception so Finder drops can
reach the webview's DOM file handlers. The CSP allows same-origin workers only.
Neither setting is proof of functioning WKWebView file access.

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

#### Mac-only import acceptance checks (not run in this Linux environment)

Use the packaged Apple Silicon `.app`, not just the Vite development server:

1. Disconnect from the internet. Import the fixtures in
   `src/lib/document-import/fixtures/` using the file picker. Repeat with a
   Finder drop on the library. Test TXT, DOCX, RTF, and compressed PDF; verify
   Unicode, paragraphs, editable preview, Save, Present, and app quit/relaunch.
2. In Web Inspector, verify the packaged module worker loads from the app's
   local origin without CSP errors or network requests. Verify processing a
   large document and cancelling it terminates the worker; the next import
   should still work. Test on the minimum supported macOS version as well.
3. Cancel the native picker, cancel extraction, and dismiss the review with
   Escape. Verify no script or selection changes. Reimport the same filename
   twice and confirm two independent scripts.
4. Import malformed, oversized, password-protected, empty, and scanned PDFs.
   Confirm actionable errors and that the library remains usable. Simulate a
   local-storage write failure in Web Inspector; ensure the review is retained
   and nothing is reported as saved.
5. **Settings → Backup JSON** must save a downloadable JSON file through
   WKWebView; **Restore JSON** must accept it via the native picker. Check the
   filename and file bytes in Finder. Existing blob-download behavior is
   unchanged and must not be assumed to work from a Chromium browser check.

Native file-picker, Finder drag/drop, WKWebView module-worker/CSP behavior, and
JSON download behavior remain **unverified on macOS** until those checks are
performed. Browser tests and a successful desktop frontend build do not
substitute for these checks.
