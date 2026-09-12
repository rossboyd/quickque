---
name: Native audio integration
description: Swift 6 callbacks, AVFoundation buffers, live resampling, and acknowledged microphone/speaker handoffs.
---

Create SDK audio callbacks in a nonisolated factory with an explicit
`@Sendable` function type, and hop asynchronously to actor-owned processing.
Do not rely on `@preconcurrency import` to make a callback safe on arbitrary
SDK threads.

**Why:** Swift 6 can infer actor isolation for a non-Sendable callback formed
inside an actor. Legacy callback APIs can accept that closure yet trigger a
fatal executor check when invoking it on a CoreAudio thread.

**How to apply:** Verify callback signatures against the SDK, and exercise
synthetic audio callbacks from a background queue in native tests, without
requiring microphone permission or model downloads.

Do not create malformed-input fixtures by corrupting an AVAudioPCMBuffer's
managed buffer-list view and expecting a later getter to preserve the mutation.

**Why:** Apple's `mutableAudioBufferList` exposes capacity-sized descriptors,
while `audioBufferList` exposes frame-length-sized descriptors. The managed view
can be rebuilt on access. A locally corrupted view is not a stable malformed
input.

**How to apply:** Test the production bounds validator using standalone
descriptor values, alongside real-buffer copy tests. Continue copying only
valid-frame bytes, not every byte in the mutable capacity view.

Validate live resamplers over complete streams, not exact first-call output
counts. Preserve `.noDataNow` between microphone chunks.

**Why:** AVAudioConverter's normal priming and fractional resampling can retain
input until more samples or an explicit end-of-stream arrive. Short first-call
output is not proof of loss; conversely, `.haveData` output may need draining.

**How to apply:** Compare irregularly chunked conversion with a contiguous
reference and EOS flushing in synthetic tests, while requiring bounded live
progress. Do not flush EOS on each live callback or weaken quality to satisfy a
first-chunk count assertion.

Do not use `SpeechDetector.results` as the silence-timer activity signal under
the documented macOS 26 contract.

**Why:** Apple exposes a results property but documents that its sequence remains
empty; `reportResults` can surface errors without producing speech activity.
An apparently valid listener would therefore treat continuous speech as silence.

**How to apply:** Use a verified text-independent activity source, and recheck
Apple's SDK documentation before migrating that signal to SpeechDetector in a
later OS release.

Check Apple's introduced-version metadata before adopting a speech convenience
API from the current documentation.

**Why:** The current reference already includes macOS 27 APIs:
`AnalyzerInputConverter` is not available in Xcode 26 or on macOS Tahoe 26.
Its declaration alone looks compatible and can lead to an unusable build.

**How to apply:** Keep streaming conversion compatible with the actual minimum
SDK/OS, checking individual members as well as their enclosing type. A type
being available does not guarantee its latest documented properties exist in
the shipping SDK. Only adopt newer convenience APIs when the supported deployment
target is deliberately changed, not because they appear in the latest reference.

Keep microphone level displays observational, separate from speech classification
and script matching.

**Why:** Loudness demonstrates incoming sound but cannot distinguish speech from
background noise. Letting a visual meter influence the silence deadline would
change the working speech detector's behaviour. A second capture path adds
permission and lifecycle risks without improving the activity signal.

**How to apply:** Reuse the existing capture pipeline, send only short-lived
numeric measurements, and make optional display telemetry droppable without
interrupting recognition. Never open a second microphone stream for the display.

Keep cancelled-operation settlement separate from acknowledged audio teardown.

**Why:** Rejecting a speech promise immediately is useful for stale-event
invalidation, but a promise-finalizer can then clear the active operation while
the native stop command is still pending. A following actor turn may otherwise
start microphone capture before the speaker process has actually exited.

**How to apply:** Preserve an awaitable teardown barrier after cancellation and
fail closed on stop errors. Cross-engine handoffs must await native teardown,
not a frontend “paused” state. Test with deferred stop acknowledgements, across
adapter remounts as well as ordinary next/previous navigation; browser completion
callbacks cannot prove hardware shutdown.

Error reporting must not turn a failed teardown into a resolved promise.
**Why:** A wrapper that catches native errors to update the UI can silently
defeat a caller's otherwise correct fail-closed barrier, even when lifecycle
unit tests pass with directly injected rejecting callbacks.
**How to apply:** Exercise the real command executor together with turn-taking
in tests. Preserve rejection even when stale/unmounted UI ignores the error;
only explicitly fire-and-forget callers may suppress it.