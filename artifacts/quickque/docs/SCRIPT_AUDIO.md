# Saved AI rehearsal audio

Chatterbox AI Partner lines are prepared locally after saved performance edits
settle for 1.5 seconds. The observer reads committed library state, so Markdown
drafts do not generate until saved. In Person dialogue, unassigned turns,
system-voice turns, titles and director notes are excluded. System voices keep
using the system speech path. Presentation narration is optional and requires
**Generate audio** in Edit → AI rehearsal audio. It uses Chatterbox Default;
this does not clone the user's voice.

The editor offers Generate, Listen, Stop, Cancel generation, Export MP4 and
Remove saved audio. The native cache lives under the app's application-support
folder, in `script-audio-v1`, associated with the script identity. It survives
restarts. Script JSON backups and imports do not embed audio; imported or
changed scripts can regenerate it. Removing audio deletes that script's cache.
Trash does not itself delete audio; restore preserves script identity. Permanent
script deletion can leave cache data until explicitly removed before deletion.

The generation request includes an ordered list of spoken passages and a SHA256
revision. Each passage has its own content key including model/voice settings.
Unchanged audio is reused; changed passages are generated in one worker/model
session. WAV files and the final manifest are published atomically. An old
revision cannot be played as the current script. A newly edited revision may
wait for the current generation job, then prepares the latest committed text.
Failures are shown in the audio panel and can be retried explicitly.

Rehearsal preloads matching WAVs into Web Audio buffers before Start. No model
runs on a Chatterbox turn and there is no live synthesis fallback when audio is
missing, stale, corrupt or access is denied. Pause, navigation and unmount stop
playback and invalidate pending starts. Decoded audio is bounded to 256 MiB per
loaded script; split larger scripts. Preload and initial audio-device startup
still take time; zero-latency playback has not been measured on a Mac.

MP4 export joins the generated passages in script order and uses the bundled
`quickque-audio-export` helper to encode AAC in a real audio-only MP4 container.
A native save dialog chooses the destination. It exports speech only: no video,
notes or timed gaps for In Person turns. Exported files remain usable outside
Quickque independently of subscription status. Generated audio retains the
Chatterbox/Perth watermark; upstream notices remain applicable.

## Paid access and development

Monthly (£2.50) and lifetime (£25) include generation, saved playback and MP4
export. Native commands enforce access, not a frontend/localStorage flag.
Settings → Debug → Licensed mode is the temporary access switch requested by the
owner. It is available in packaged Mac test builds, defaults to Unlicensed and
persists across restarts. Turning it on enables paid audio and unlimited Voice
Follow; turning it off stops paid audio and restores the session's used allowance.
The saved native setting controls the app; browser preview keeps a separate local
simulation and still cannot generate Mac audio. This is not licence verification
and creates no purchase. The old environment-variable override is replaced.
No payment provider is configured; checkout remains dummy.

## Verification

Run `node --test src/lib/script-audio-model.test.ts`, `pnpm turbo:test`,
`pnpm typecheck`, and `playwright test tests/script-audio.spec.ts`. The browser
test mocks native IPC and AudioContext to verify cache-only playback and the
paid UI boundary; it does not prove Mac speech or export works.

On a Mac, build the Swift helper and Tauri app, then test default Chatterbox
installation, edit/regenerate/restart, cache hits, missing/corrupt files,
cancellation during generation/preload/playback, disk-full errors, mixed
In Person/AI turns, optional presentation generation, deletion, and MP4 export
in an external player. Verify both Debug licence modes, persistence, and switching while listening
or generating. Measure cold generation and warm playback on
the user's M2 / 24 GB Mac. Those native checks remain outstanding on Linux.
