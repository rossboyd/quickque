# Quickque for macOS

This directory contains a lightweight Tauri v2 wrapper around the same React
application used on the web. The native window supports transparency, while the
ordinary app remains visually opaque because the UI supplies its background.
Overlay opacity is likewise controlled by the UI's CSS RGBA colors, not by a
native whole-window opacity setting.


## Presentation timer and microphone indicator

Presentations open in Voice Follow by default. Microphone capture still requires
an explicit Start action; Manual Scroll remains available in the mode selector.

The presentation screen includes an elapsed timer that runs during manual
playback or active Flow listening. Pausing, preparing Flow, an error, or the
30-second no-speech stop freezes the timer. Resuming continues the same elapsed
time; section jumps preserve it. Leaving the reader and opening a new
presentation starts at zero. The reset button resets only the elapsed timer,
without moving the script or changing microphone capture.

In Flow mode, the circular rings react to the actual microphone's loudness.
They show incoming sound, not whether a word was recognised or matched to the
script. Silent, paused, stopped, or stale audio settles the rings. Manual mode
does not open a microphone. Reduced-motion settings keep the indication static.
Only a bounded numeric level is sent to the display; no audio or transcripts
are saved, and level updates are excluded from diagnostic history.

## Prerequisites

For the supplied app icon, script font/colour preferences, exact resource checks
and installed-app offline verification, see
[`BRANDING_VALIDATION.md`](BRANDING_VALIDATION.md). The normal build command
retains the existing native build/test sequence and additionally checks the icon
inputs and the generated `.app` icon reference/resource.

- An Apple Silicon Mac running macOS Tahoe 26 or newer. Intel Macs and older
  macOS releases are unsupported for local Flow and fail closed; there is no
  browser or cloud fallback.
- Xcode 26 with the Swift 6.2 toolchain and the macOS 26 SDK. Install its
  command-line tools with `xcode-select --install`.
- The stable Rust toolchain installed with rustup
- Node.js and pnpm 10.26 or newer

From the repository root, install workspace dependencies normally, then run:

```sh
pnpm install
xcodebuild -version
xcrun --sdk macosx --show-sdk-version
xcrun --find swiftc
pnpm --filter @workspace/quickque desktop:dev
pnpm --filter @workspace/quickque desktop:build
```

The version checks should report Xcode 26, Swift 6.2, and a macOS 26 SDK before
building. The final command runs debug/release Swift tests, builds the Apple
Silicon helper, runs the Rust bridge/library tests, builds the desktop app,
and creates:

```text
artifacts/quickque/src-tauri/target/release/bundle/dmg/Quickque_0.1.0_aarch64.dmg
```

Open that DMG and drag Quickque into Applications. Because a local development
build is not signed or notarized, macOS may block its first launch. In Finder,
Control-click Quickque in Applications, choose **Open**, then confirm **Open**.
Do not bypass Gatekeeper for a DMG you did not build yourself or receive from a
trusted source.

Both desktop commands first run `native:build`. That command checks the Apple
toolchain, compiles the arm64 release helper, and places the target-suffixed
sidecar where Tauri packages it. To build the helper by itself:

```sh
pnpm --filter @workspace/quickque native:build
```

The helper uses Apple's SpeechAnalyzer and SpeechTranscriber APIs, with
SoundAnalysis speech classification used independently for the no-speech
timeout. The native source remains a normal Swift package, so it can also be
opened or built directly with SwiftPM. `scripts/build-flow-helper.sh` is the
supported packaging path because it gives the sidecar Tauri's required target
suffix. A confirmed Mac build works perfectly for Voice Follow as the default,
the presentation timer, and live microphone rings. This agent did not compile
or run that build; post-merge native validation here remains a static Linux
review, not an exhaustive check of every supported hardware case.

The desktop Vite configuration uses local port 1420 and does not need Replit's
`PORT` or `BASE_PATH` environment variables. It produces `dist-desktop/` and
does not include the Replit development plugins. The app bundle loads packaged
assets only; the desktop CSP does not permit arbitrary network or remote font
loading.

## Scene-partner Chatterbox speech

Scene-partner playback uses the bundled Chatterbox Turbo worker. It does not
call `/usr/bin/say`, use `AVSpeechSynthesizer`, start Flow, or substitute a
browser/system voice. On Apple Silicon the worker accepts the pinned default
conditioning or an approved local recording from the app-private cloned-voice
library. Missing Turbo setup, missing recordings, and integrity failures are
reported visibly so a character must be reassigned or repaired.

The Rust bridge runs one isolated Turbo worker per active turn. Starting a new
turn, pausing/leaving the reader through `stop`, an abort signal, and app exit
all terminate the active worker before another turn can start. The worker
has a generous per-turn safety deadline, and stale helper completion cannot
complete a later turn. The helper receives dialogue through stdin, returns only
a fixed completion/error shape through stdout, and does not log dialogue.

**Mac validation remains unverified.** This environment has no Apple Silicon
Mac, so real voice enumeration, synthesis, cancellation responsiveness,
speaker/microphone handoff with Flow, offline operation, and packaged-sidecar
lookup must be smoke-tested on a supported Mac before release. Browser or Linux
unit tests do not establish those native behaviors.

Before a Mac release, follow `SCENE_PARTNER.md` with a synthetic scene and:

1. Record the Mac model/RAM, macOS and Xcode versions; compile both Swift
   helpers and the Apple-target Tauri bridge. Check helper discovery from the
   installed app, not only a development launch.
2. Disconnect the network. Enumerate installed voices, explicitly preview at
   0.5×/1×/2×, and play consecutive partner turns without loading Flow assets.
   Verify only dialogue is audible, never labels or notes.
3. Exercise pause, replay, next/previous, start over, reader exit and app exit,
   including cancellation while the helper is starting. Confirm no lingering
   or overlapping speech and no microphone capture from manual turn-taking.
4. Opt into Flow on actor turns. Confirm the microphone is off during partner
   speech, starts only after acknowledged speech teardown, and cannot advance
   on old transcripts, a trailing phrase, uncertain matches or inactivity.
5. Verify names, cues, mirroring and all controls in the native 360×260 overlay,
   plus normal/full-window presentation and elapsed-time pause/resume.

The optional neural-engine benchmark is separate and remains **not run**;
release gates and exact pins are in `TURBO_EVALUATION.md`. No Turbo model,
runtime, reference voice or installer is included by the scene-partner changes.

## Apple on-device Flow and privacy

Flow is optional. Checking Apple speech support and language-asset status does
not request microphone permission and never downloads anything. Voice Follow
requires an Apple Silicon Mac running macOS Tahoe 26 or newer and uses Apple's
on-device `SpeechAnalyzer` and `SpeechTranscriber` APIs. There is no cloud
fallback.

Quickque requests Apple-managed English `en-GB` assets and accepts Apple's
supported equivalent English locale. Status messages name the selected locale,
including when Apple chooses an already installed regional variant. The user
must explicitly choose **Download language assets** when those assets are
missing. If macOS already reports the assets as ready, setup skips the download.
Starting listening never auto-downloads assets. Apple controls the asset
contents and availability; Quickque promises neither a fixed download size nor
a byte total, and it does not maintain a custom model cache, cache checksum, or
immutable model manifest.
An explicit installation request can schedule Apple's own background retries.
**Stop waiting** cancels Quickque's wait, not Apple's ownership of that request;
macOS may finish an already requested download after the helper exits. Checking
status or starting the microphone never creates a new installation request.
Microphone permission is requested only by Start. Audio is captured from the
selected microphone (never system audio), processed in memory, and is not sent
to a service or written to a recording. Transcripts are transient JSON events;
the helper does not persist or log them. The helper's actual stderr is captured
separately in bounded per-process RAM (at most 8192 bytes) to make native
failures actionable. It is not written to disk, logged to the console, or
included in the normal Flow trace. Error details are collapsed by default and
have a separate, explicit copy action because raw stderr may contain sensitive
text or paths.

The current input contract uses a bounded `AsyncStream` and a normalized
16 kHz mono PCM ring. The ring holds at most 80,000 frames (five seconds,
320,000 sample bytes), and the input pump drains bounded 200 ms work units.
When the ring is full, the oldest audio is dropped and a cumulative dropped
frame counter plus a queued-frame count bounded to 0..80,000 is reported as a
non-blocking warning.
An actual dropped-audio gap stops the current analysis with a recoverable error
and **Retry listening**. It does not splice speech across the missing audio or
silently continue the same decoder. This conservative Apple-engine recovery
differs from automatic recovery after a brief drop: ordinary bursts are absorbed
by the bounded queues, but a real overflow requires a fresh listening session.
These bounds still need targeted checks on supported Macs; this Linux review does
not establish exhaustive behavior.

Speech activity for the independent 30-second no-speech timeout uses Apple's
SoundAnalysis speech classification rather than transcript matching. The
macOS 26 `SpeechDetector` module does not expose usable client activity events.
SoundAnalysis supplies the independent signal instead. Its speech-confidence
threshold is an application heuristic, not an Apple accuracy guarantee; speech,
noise, off-script speech, and the exact silence boundary remain subject to
validation on a supported Mac.

The app and helper exchange commands/events through inherited stdin/stdout JSON
lines, with stderr captured separately for opt-in error details. No TCP
listener, account, API key, cloud inference, or silent fallback exists. Every
command and event carries the frontend's generation. Rust rejects output from
replaced helper processes, and every Start resets transcript sequence to zero
and creates fresh utterance context.

On the first desktop launch, Quickque opens a setup guide before requesting
either language-asset download or microphone access. The guide explains local
processing, shows available Apple asset progress without promising a total,
requests microphone access only after Apple reports speech ready, and confirms
setup only after listening starts. Choosing **Not now** leaves manual reading
available. Until setup succeeds, choosing Voice Follow opens the guide again;
afterward, **Setup Guide** in the Flow status panel reopens it. A previously
saved setup preference does not assume assets remain installed: status still
returns `ready` or `needs-model`, and the guide offers the explicit asset
download when needed.

Expected lifecycle failures are shown with a short fixed diagnostic code and
retry action. Quickque writes only those non-content codes to the JavaScript or
macOS console; it never logs event payloads, transcript text, or audio, and it
creates no diagnostic log file. Initial status, Apple asset preparation, asset
download, and analyzer startup have inactivity deadlines that stop the helper
instead of leaving capture or setup indefinitely active.

Tauri writes native artifacts beneath `artifacts/quickque/src-tauri/target/`.
Release `.app` and `.dmg` outputs are normally in
`src-tauri/target/release/bundle/macos/` and
`src-tauri/target/release/bundle/dmg/`. A local build may be run unsigned for
local use. Distribution to other Macs requires an Apple Developer identity,
code signing, and normally notarization; those credentials are intentionally
not part of this repository.

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


### Native script library storage

The desktop app can use a folder selected through the native directory picker for
its local script library. Quickque stores only a small app-owned configuration
record in its native application config directory; that record contains the
selected folder and a deterministic, folder-specific filename. The script file
is named `quickque-library-<folder fingerprint>.json`, and its ownership marker
prevents Quickque from replacing an unrelated file that happens to occupy that
name. A non-empty file without Quickque's marker is rejected with an actionable
error rather than being claimed.

Library saves are serialized in the native bridge, validate that the payload is
a JSON array, cap the payload at 8 MiB, write a sibling temporary file, flush it,
and atomically rename it into place. Before replacing an existing owned library,
Quickque atomically preserves the previous document as the matching `.bak` file.
Interrupted or failed writes therefore leave the previous library intact; the
bridge never scans a selected folder or writes arbitrary filenames. Folder
selection is persisted across native restarts, and cancelling the picker leaves
the existing selection unchanged. Re-selecting the currently configured folder
is safe. Selecting a different folder that already contains a non-empty owned
Quickque library (including its owned backup) is rejected before configuration
changes, with instructions to choose a new folder or import the existing
backup. Autosaves also carry the exact folder they were queued for; a stale
save is rejected if the configured folder changed before it writes. This
storage contains scripts only; it does not store audio, transcripts, or Flow
data.

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
behavior still require a supported Mac. A confirmed Mac build works
perfectly for Voice Follow as the default, the presentation timer, and live
microphone rings. This post-merge review remains a static Linux inspection; the
agent did not compile or run the Mac build and makes no claim of exhaustive
hardware or edge-case verification.

For a candidate, first record the toolchain versions and then run
`desktop:build`:

```sh
xcodebuild -version
xcrun --sdk macosx --show-sdk-version
xcrun --find swiftc
pnpm --filter @workspace/quickque desktop:build
```

Install the newly generated DMG and verify this sequence:

1. On a clean first launch, confirm the setup guide appears and **Not now**
   leaves the app usable in manual mode.
2. Reopen Voice Follow. If Apple reports English language assets ready, confirm
   setup skips download. Otherwise explicitly start the Apple language-asset
   download and confirm its status message and 0..1 progress advance without a
   promised byte total.
3. Start listening and confirm macOS requests Quickque permission. If
   permission is denied, confirm the guide shows a retryable error and directs
   the user to System Settings rather than claiming success.
4. Read through a script, pause and restart, jump backward and forward between
   sections, speak in short bursts, and confirm the UI remains aligned without
   joining text across a reported dropped-audio gap.
5. Produce a transient queue overrun if possible and confirm the non-blocking
   cumulative warning, queued catch-up time, recoverable error, and immediate
   **Retry listening** action. Confirm no asset reinstall action is offered.
6. Remain silent and confirm the independent SoundAnalysis speech-activity
   timeout stops listening after 30 seconds once native validation is complete.
   Confirm pause, Stop, closing setup, and quitting Quickque remove the active
   microphone indicator promptly.
7. Quit, disconnect networking, relaunch, and confirm installed Apple language
   assets permit Voice Follow to start without network access.
8. Inspect Quickque's Application Support and WebKit container changes. No
   custom model cache, checksum marker, audio recording, transcript export, or
   Quickque diagnostic log file is expected.

The confirmed Mac build result covers the default Flow presentation, timer, and
microphone rings. Installation, already-ready assets, explicit asset download,
offline start, pause/restart, section jumps, burst input, noise plus silence,
queue gaps, privacy, stderr handling, cleanup, and broader hardware behavior
still require targeted supported-Mac checks; they are not established by this
static Linux review.

If setup fails, record the visible diagnostic code. Optional Console.app or
other native log capture may be used for investigation, but it is not required
and must not be treated as the normal Flow trace. Normal diagnostics contain
lifecycle codes and generations only, never speech, script text, paths, or raw
stderr.

### Welcome guide

On first launch, Quickque asks for a display name and (on desktop) a local
script folder. The guide then offers optional Voice Follow setup, explains the
reader controls, and invites the user to try the welcome walkthrough or create
a first script. Cancelling Voice Follow does not prevent manual reading.
Fresh libraries have only the unchanged Welcome to Quickque script; upgrading
does not delete or replace any existing scripts. Settings can reopen the guide
and change the display name or library folder.

Browser preview uses browser storage, explicitly cannot choose a native folder,
and offers export/import backups instead. The display name is local app profile
data, not an online account.

### On-screen Flow debugger

The subtle **DEBUG** toggle is always present at the bottom left of the app
window, including during startup, welcome/setup guides, reading, and errors.
When enabled, **FLOW DEBUG** overlays the UI in green. Visibility persists
across navigation and restarts; the trace itself remains memory-only.
The overlay traces
listener registration, outgoing commands, Rust acknowledgements, helper
startup and command receipt, Apple support and language-asset checks, asset
download stages, microphone authorization, analyzer preparation, engine
startup, queue warnings, and timeouts. Each line has a timestamp and session
generation. The footer shows the last checkpoint and seconds since it arrived;
a quiet panel is not itself proof of a failure.
Hide/show using the bottom-left toggle, or use **Copy** to copy the trace
manually. If clipboard access is unavailable, select the green text or take a
screenshot. **Clear** clears only the trace, not Apple language assets or
scripts.

The trace holds at most 160 entries in memory and is cleared on app restart.
It accepts fixed lifecycle labels, command names, and numeric metadata only,
not arbitrary native messages, stderr, filesystem paths, audio, or transcript
payloads. Copying is explicit and does not automatically upload anything.
Diagnostic events do not extend operation deadlines or trigger downloads or
microphone access.

Useful checkpoint distinctions:

- `listener_ready`: the frontend subscribed; it does **not** prove that Rust
  or the helper has answered.
- `rust_command_received`: Rust accepted the command.
- `helper_command_sent`: Rust wrote to stdin; `helper_command_received`
  separately confirms that Swift decoded it.
- `helper_boot` / `helper_read_wait`: Swift reached main and its input read.
- `apple_support_check_begin` / `apple_support_check_complete`: Apple speech
  support was checked.
- `apple_assets_check_begin` / `apple_assets_check_complete`: Apple-managed
  language-asset availability was checked.
- `apple_assets_download_begin` / `apple_assets_download_complete`: the
  explicit Apple language-asset download started / completed.
- `apple_analyzer_prepare_begin` / `apple_analyzer_prepare_complete` /
  `apple_analyzer_ready`: analyzer preparation and readiness checkpoints.
- `microphone_request_begin` / `microphone_authorized`: authorization
  was checked or requested / granted.
- `command_resolved [stop]`: Rust completed helper cleanup for that command.

Browser-only visual inspection is available at `?flowDebug=1`; it explicitly
reports that native Flow is unavailable rather than simulating native results.


### Input-pipeline safeguards

The Apple microphone tap validates and copies input into bounded native
buffers. The current input contract normalizes to 16 kHz mono and pumps
bounded 200 ms work units into a bounded `AsyncStream`; its ring holds at most
80,000 frames (five seconds, 320,000 sample bytes). Invalid input and route
changes fail explicitly. Dropped frames stop the current analysis and require
**Retry listening**, rather than joining transcripts across missing audio.

The green trace distinguishes a natural `helper_exit_code` /
`helper_exit_signal` (numeric values only) from `helper_cleanup_forced`
performed by Rust. A signal identifies how the process terminated, not the
exact faulting stack frame. Raw stderr is never part of this trace.

The Xcode 26 / Swift 6.2 helper and Apple SpeechAnalyzer, SpeechTranscriber,
and SoundAnalysis behavior are native-only. The confirmed Mac build works
perfectly for the default Flow presentation, timer, and microphone rings, but
this agent did not compile or run it. Do not treat this static Linux inspection as
exhaustive proof of install behavior, exact timing, queue-gap recovery,
accuracy, latency, memory, or coexistence with a meeting app on every
supported Mac.
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

### Presentation timing: verification boundary

Presentation timing uses the same transport dispatch for toolbar, keyboard,
global shortcut and approved phone commands. The phone protocol is unchanged;
countdown and pending Flow preparation publish `playing: false`, and elapsed
time starts only when manual motion is enabled or Flow reports listening.

The TypeScript lifecycle, countdown cancellation, timer math, timed-distance
limits, logical resume metadata, and Flow/remote regressions are verified on
Linux. Browser verification covers DOM scrolling and reflow separately.
**Native smoke tests are awaiting a Mac.** No Mac installer was produced.
Chromium checks do not establish WKWebView behavior or real microphone teardown.

Before shipping the Mac build:

1. With a 5-second countdown, start/cancel using toolbar, Space,
   Command–Shift–Space and paired-phone play/pause. Exit or close the overlay
   just before expiry. Confirm no late scrolling or microphone capture and
   no phone snapshot claiming playback during countdown.
2. Use a 60-second manual target, pause for 10 seconds, resume, resize/reflow,
   jump sections and change speed from the phone. Confirm active time excludes
   pauses, remaining distance is recalculated, and speed edits visibly leave
   timed mode. Verify end-of-script, expired and too-fast target feedback.
   In Flow, jump sections while listening and confirm the clock and phone
   playing flag freeze while capture re-prepares, then resume on listening
   without another countdown or duplicate capture start.
3. Quit/reopen midway. Resume must restore the script-relative word paused,
   including after layout changes, without capture. Start over resets location
   and time. Edited copy safely opens at the beginning; completed copy offers
   Start over. Inspect a JSON export: no resume location or session time is in
   the script document, and no transcript/audio is added.
4. Enable pause-on-manual-scroll in Flow, then use trackpad, touchscreen (if
   available), scrollbar and keyboard scrolling. Capture must pause before
   reanchoring; automatic following must not trigger this preference.
5. Hide controls during playback, reveal them using Show controls, and reach
   buttons/settings by keyboard. Focused controls must not toggle playback
   through the global Space shortcut.

### Present layout: native acceptance checklist

The presentation-layout changes require the following checks in the packaged
Mac app. **Not run in this Linux environment.** Chromium geometry tests do not
prove WKWebView scrolling, native window restoration, transparent compositing,
or live Apple speech following.

1. Open an existing library with non-default font, size, speed and opacity.
   Confirm those choices survive migration, quitting and relaunching. Repeat
   with a chosen-folder library and a script in Trash.
2. Present a long, multi-section script in full mode, then compact overlay.
   Exercise no mirror, horizontal, vertical and combined mirrors. Read through
   a section boundary using manual scroll and Apple Voice Follow. Confirm text
   progresses in source order, the cue follows the mirror, and controls,
   dialogs and the paired phone remain unmirrored.
3. Test hidden, line and side-arrow cues at 10%, 30% and 80%. Jump forward and
   backward by toolbar, keyboard, global shortcut and approved phone remote.
   Confirm the section start and Flow word align with the same logical cue.
4. Mid-paragraph, change font, size, spacing, margins, cue position and mirror.
   Resize the window and toggle compact/full. Confirm the same reading word
   stays at the cue rather than moving to another paragraph. Repeat while
   paused and while Voice Follow is listening.
5. Test background/text/cue colours on light and dark app themes, including
   low contrast. Check compact opacity at 0%, 50% and 100% over light and dark
   external windows. Read/unread and active-word highlighting must remain
   distinguishable; contrast guidance cannot account for every window behind
   a transparent overlay.
6. Open Present settings at the native minimum overlay size (360 × 260).
   Reach all controls and resets by keyboard. Escape must close the dialog
   without exiting Present mode; range/select arrow keys must not jump script
   sections. Exit overlay and verify original size, position and decorations.
7. Change size/speed from the approved phone. Verify only the presented script
   changes, its preferences survive relaunch, and other scripts and future
   defaults remain unchanged. Duplicate and JSON-export/import that script;
   compare its preferences. Ordinary document imports must use current defaults.
