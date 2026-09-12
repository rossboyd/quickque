# Quickque

A local-first personal teleprompter for live meetings, with an interruption-friendly reader and a lightweight macOS desktop wrapper.

## Run & Operate

- `artifacts/quickque: web` — managed workflow for the browser preview
- `pnpm --filter @workspace/quickque run desktop:dev` — run the native app on a Mac with prerequisites installed
- `pnpm --filter @workspace/quickque run desktop:build` — build the Mac app locally
- `pnpm run typecheck` — full typecheck across all packages
- See `artifacts/quickque/DESKTOP.md` for Mac prerequisites and packaging details.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- Desktop: Tauri 2, using the macOS system webview rather than bundling a browser
- Persistence: local device storage, no account or server required
- Local Flow: Apple Silicon Swift sidecar using Apple SpeechAnalyzer/SpeechTranscriber on macOS Tahoe 26+. Apple-managed language-asset download is explicit; inference is on-device. Building requires Xcode 26+.
- The scaffolded API/database packages are not used by Quickque.

## Where things live

- `artifacts/quickque/src/` — application and reader
- `artifacts/quickque/src/lib/desktop.ts` — browser/native capability boundary
- `artifacts/quickque/src-tauri/` — desktop wrapper and permissions

## Architecture decisions

- Keep scripts local-first because this is a personal meeting utility; do not introduce cloud accounts or server-side script storage without a new requirement.
- Flow is Mac-first and on-device by user choice. Do not add cloud transcription, API billing, keys, or authentication as a fallback. iPhone work is deferred.
- Apple Speech is the selected engine; do not restore the retired FluidAudio/Parakeet path or an older-macOS/cloud fallback without a new requirement.
- The user explicitly values no recordings: audio and recognition text are transient memory buffers, never saved, backed up, or logged. Only scripts/settings/models persist. Do not describe this as forensic memory erasure.
- Native stderr is an explicit troubleshooting exception: a bounded RAM-only per-helper tail behind collapsed error details and a separate copy action. Never include it in the content-free Flow trace or automatic logs.
- Use explicit pause for interruptions. Automatic speaker identification is outside the current scope; never suggest manual playback listens to or recognizes speech.
- The native helper owns speech-inactivity timing: 30 seconds without detected speech stops capture. Off-script speech counts, and webview timer throttling must not delay shutdown.
- Distinguish browser preview from native capabilities. Browser transparency cannot reveal another application's window, and browser code cannot reliably pin a window above Zoom or Meet.
- Document import is on-device plain-text extraction only. Keep parsers and worker assets bundled locally; never render imported HTML or fetch embedded resources. See `src/lib/document-import/PARSERS.md` under the Quickque artifact for limits and supported subsets.
- Library, active selection, Trash and ordering metadata must persist in one atomic record before any mutation is shown as successful. This avoids partial saves on quota failures. Continue accepting legacy arrays and v1 envelopes; new full backups use a versioned envelope, while selected-script JSON remains a portable scripts array.
- Trash stays on the device without automatic expiry. Full backups include Trash and library ordering, but not presentation settings; selected-script exports exclude Trash. Normal backup import merges instead of replacing. Replacement is reserved for explicit, confirmed recovery of unreadable storage.
- New, duplicated, document-imported and restored scripts go to the start of Custom order. Backup imports prepend their saved relative order without changing the destination sort preference. Newest/Oldest refer to creation time, not last edit. Custom reordering is disabled while searching.

## Product

Create and edit sectioned scripts, navigate sections while reading, pause without losing position, and adjust reading speed and appearance. The Mac reader is designed to float above meeting windows. Optional Flow follows locally transcribed English speech; browser preview keeps manual reading and explains the native requirement.

## User preferences

The requested product name is Quickque. The user wants a lightweight personal Mac application inspired by Speakflow, not a copy of its branding.

## Gotchas

- Native macOS window behavior and installer signing must be validated on macOS. A working browser preview is not proof of native desktop behavior.
- The overlay does not modify camera video, but may appear in screen sharing. Advise sharing only the intended application/window, not the whole display.
- Browser and desktop storage are separate; backups are necessary for migration and recovery.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
