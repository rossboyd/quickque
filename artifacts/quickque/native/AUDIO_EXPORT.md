# Cached script audio export

`quickque-audio-export --input <assembled.wav> --output <new.mp4>` converts a
non-empty mono or stereo WAV to an audio-only MP4 containing AAC audio, using
macOS AVFoundation. It runs offline and does not need FFmpeg. The output path
must not exist. Exit code zero indicates a completed export; errors go to stderr.

The app owns paid entitlement checks, assembling script turns, choosing the
destination and moving the successful temporary export there. It must remove
temporary output when killing the helper. Caught conversion failures remove it
inside the helper. MP4 exports contain audio only, with no video or captions.

`scripts/build-flow-helper.sh` builds this helper with the speech helpers and
copies it into the Tauri external binaries. Packaged path:
`Contents/MacOS/quickque-audio-export`.

Run `swift test --filter AudioExportTests` in `native` on a supported Mac to
verify a real one-second WAV becomes playable AAC in an MP4 container, with its
duration preserved, and that an existing export cannot be overwritten.
