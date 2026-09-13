# Chatterbox Turbo in Quickque

The user requested open-source Chatterbox with a free voice for an M2 / 24 GB
Mac. The integrated engine uses **Chatterbox Default**, the default `conds.pt`
from ResembleAI/chatterbox-turbo. The upstream model metadata and Chatterbox
source are MIT. No external paid voice service, key, account, or user Python is required.
Saved script audio and MP4 export are Quickque paid features; the model itself remains free.

## User flow

Scene Partner setup → expand an AI Partner character → **Chatterbox Turbo
(Free · Local)** → **Download Chatterbox · 2.99 GB**. When installed, preview
**Chatterbox Default** or a voice recorded in Quickque. Paid users generate saved audio
before rehearsing; the performance editor schedules generation after saved edits.
Presentations offer an optional **Generate audio** action.
Each character keeps its assignment and colour. Turbo uses its natural rate (1×).
The browser can edit/save the assignment; synthesis and voice recording run in
the Mac app. Existing system-voice assignments are not synthesized or migrated
to another engine; they must be reassigned to Turbo or a local recording.

## Local cloned voices

The desktop app can record one clean, mono 16-bit PCM sample between 5 and 10
seconds. Recording is a separate lifecycle from Flow capture: the user must
grant microphone access, review/retry the sample, and confirm permission to use
the voice before it is committed. A complete recording and its metadata are
atomically committed beneath `cloned-voices-v1/<voice-id>` in the app-private
data directory. Metadata includes a revision and SHA-256 digest; every preview
or generation verifies both before passing the recording to Turbo.

Voice references are stable `chatterbox-local:<voice-id>` identities. Audio and
conditioning data never enter script JSON or backups. Renaming increments
metadata revision; re-recording increments revision and invalidates generated
audio keys; deleting a voice does not silently reassign characters or
narrators, which instead report a missing local reference until reassigned.
The worker accepts only IDs confined beneath the app-provided voices directory,
and requires consent, revision, duration, format, and digest validation.

The download is explicit and cancellable. Model files and default conditioning
are pinned by SHA-256 and size in `model-lock.json`. No extra decoder or arbitrary
reference audio is downloaded. Incomplete downloads cannot become installed
models; staging is recovered on the next attempt after a hard cancellation.
Normal synthesis has offline environment flags and Python network connections
blocked. Scripts enter the worker on stdin, never as arguments or files.
Voice previews play directly from RAM. Explicit script generation persists PCM16 WAV
audio beneath `script-audio-v1/<sha256(scriptId)>` in Quickque app data, linked by script ID.
The official Perth watermark is retained. Script JSON backups do not include these
audio files; MP4 export creates a portable listening copy.

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

The existing native child-process stop barrier covers Turbo playback: stop
kills/reaps the worker before microphone following can resume.
The worker is onedir (no extraction subprocess). Saved audio generation verifies
and loads the model once per batch, generates missing passages and atomically
commits a complete revision. Keys include model/cache version, text, voice and
rate; unchanged passages are reused. Cancellation retains the prior complete
revision, and partial WAVs never qualify as playable. Rehearsal preloads saved
WAVs into Web Audio buffers before Start; it never falls back to live synthesis
on a missing Chatterbox passage. Model memory still needs Mac measurement.

Generation/read/export use the temporary Settings → Debug → Licensed mode
toggle, including packaged test builds. It defaults to Unlicensed and persists
on the Mac. This owner-requested simulation replaces the environment override;
it does not verify a licence or payment. Removing audio never requires payment.
Old content revisions remain available for reuse until **Remove audio** is used.

MP4 export concatenates the committed revision in script order and invokes the
bundled `quickque-audio-export` Swift helper, which encodes AAC in a real audio-only
MP4 container. It uses a native save dialog and atomic final rename; temporary
WAV/MP4 files are removed on success, cancellation or failure. Export and generation
are serialized. An operating-system hard kill can leave temporary files.

Python cache tests additionally cover reuse, changed passages, corrupt WAVs,
interrupted revisions and invalid identities. Native unit tests cover WAV parsing
and cache identity validation. Linux typechecking with Tauri stubs is only a
structural check, not a substitute for the native Mac build.

**Not verified on this Linux development host:** frozen arm64 build, actual
speaker output, no-network operation at OS level, Mac cancellation latency,
M2 memory use, native signing/notarization and the resulting DMG. Run the Mac
build and a rehearsal/preview smoke test before distributing that build. The
runtime build check is necessary but does not replace an audible end-to-end test.
