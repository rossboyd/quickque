# Release work

Stripe is selected, but checkout must remain dummy until the owner changes that
instruction. Do not activate provider calls, issue licences or advertise payment
as available. Settings → Debug → Licensed mode now simulates paid access in
all test builds, including the packaged Mac app; it defaults to Unlicensed.

## Free Voice Follow allowance

The native process tracks 30 seconds of active listening per reader session.
Loading, paused time, manual mode and AI Partner playback do not consume the
allowance. Pausing, restarting capture, navigating turns, changing read mode and
Start over within the same reader visit do not reset it. Leaving the reader and
starting a fresh presentation/rehearsal creates a new session. The microphone
helper is killed and reaped at exhaustion before emitting `limit-reached`.
Presentation offers manual mode; a performance can continue using Next.
The native clock continues to work if browser timers are throttled.

`voice_allowance.rs` has dependency-free Rust tests for cumulative time, pause,
restart, new sessions and the paid-unlimited path. Actual microphone shutdown and
reader integration need Mac validation. The Debug licence toggle selects unlimited access immediately without resetting
used session time. Switching back to Unlicensed restores the existing allowance.

## Mac build checks

`.github/workflows/mac-release-check.yml` is a manual build workflow using the
[official macOS 26 ARM runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
It builds Swift helpers, runs native tests, freezes the Python runtime, builds
an unsigned app/DMG, and uploads a short-lived internal test artifact. It does not
publish a release, sign/notarize a distributable, or enable payments. It has not
been dispatched or verified by this Linux workspace.

Hosted Mac VMs do not expose Metal. `QUICKQUE_BUILD_PACKAGE_ONLY=1` therefore
checks frozen imports and watermark assets using `--check-package`, and records
MPS availability without claiming inference works. The normal physical Mac build
still requires `--check-runtime` with MPS. A physical Mac must verify generation,
audible playback, permissions, latency/memory, MP4 playback and offline operation.

`check-mac-icon.sh` now mounts the generated DMG read-only and checks its embedded
app, matching ICNS contents against the source asset and confirming all three
native helpers and the Chatterbox runtime exist and are executable. Finder/Dock
visual appearance still requires human inspection. Source icon hashes pass on
Linux; the DMG checks themselves require the Mac build.
