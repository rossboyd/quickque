# Task 34: iPhone native audio feasibility gate

Assessment date: 2026-09-13. Status: **gate not passed; task incomplete**.

The task requires measured native audio feasibility before building the full
iPhone product. This is a source assessment and a device validation protocol,
not a successful inference experiment. No iPhone app or supported-device claim
is established by this document.

## Findings

| Area | Evidence | Result |
| --- | --- | --- |
| Existing runtime | `turbo/worker.py` explicitly requires PyTorch MPS and loads `ChatterboxTurboTTS`; playback uses sounddevice. `turbo/README.md` describes a macOS PyInstaller worker. | The existing desktop integration is not an iOS runtime. Native inference and playback need a port. |
| Model storage | Summing `turbo/model-lock.json` gives 2,987,680,596 bytes across nine files. | This is the desktop download size only. It does not measure iOS compiled model size, working memory, caches or installation headroom. |
| Native speech | `native/Package.swift` targets macOS 26 executable helpers. `AudioPipeline.swift` uses Apple's Speech framework. | Algorithms can inform a port, but the helper is not an iOS library. Audio-session and interruption handling need iOS implementation. |
| Build host | `uname -s` returned Linux; `command -v xcodebuild` found no executable. No physical iPhone is connected through available tools. | iOS compilation, microphone behavior, memory and thermal measurements cannot be performed here. |

The pinned [upstream Turbo implementation](https://raw.githubusercontent.com/resemble-ai/chatterbox/5de7a54aa4e5e2baadb0182dde554908b48b85c2/src/chatterbox/tts_turbo.py)
includes text tokenization, T3 generation, S3Gen decoding, voice conditioning
and Perth watermarking. Converting only its speech decoder would leave the
required pipeline incomplete.

A [published Core ML conversion](https://huggingface.co/FluidInference/chatterbox-multilingual-coreml)
is a useful candidate for investigation, but it converts **Multilingual**, not
the pinned Turbo model. Its author explicitly says reference-voice encoders
are not converted and watermarking is absent. It also needs host-side
tokenization, sampling and cache management. Its published results do not
establish Quickque's physical-iPhone performance. Do not silently replace
Turbo/default voice identities with this model or treat it as a complete port.

[Apple's SpeechAnalyzer presentation](https://developer.apple.com/videos/play/wwdc2025/277/)
documents an on-device speech path introduced with iOS 26. Use iOS 26 as a
candidate deployment baseline, checking device and locale availability plus
explicit asset installation at runtime. This is not a supported-iPhone floor.
Unavailable recognition must produce an actionable unavailable state.

[Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
allow custom native libraries. The intended integration is an in-process Swift
module in an Expo Router development build, with native audio-session ownership.
Expo Go alone cannot validate that custom module.

## Licensing status

The bundled Chatterbox and Perth source notices are MIT; the pinned upstream
[Chatterbox license](https://github.com/resemble-ai/chatterbox/blob/5de7a54aa4e5e2baadb0182dde554908b48b85c2/LICENSE)
is available for comparison. The desktop README records MIT model metadata.
This assessment does not certify a future converted distribution: archive
the exact model revision's license and all converter/runtime dependency notices
when choosing that distribution. Retain the existing watermarking behavior.
Local voice references still require explicit recording and permission to use
the voice; no reference audio belongs in library JSON or diagnostic reports.

## Experiment required to pass

First implement a small native inference experiment on a Mac with Xcode 26+
and a physical iPhone running iOS 26+. Record its exact device model, OS,
build mode, source revision, runtime revision, model hashes and precision.
No device is supported until measured. Start with available hardware and test
the intended oldest supported device before declaring a floor.

1. Port the complete pinned Turbo pipeline, including default conditioning,
   local reference encoding and Perth. Alternatively evaluate a separately
   identified Chatterbox variant with explicit compatibility decisions. Pin
   every asset and verify its digest before loading; no hidden downloads.
2. Produce audible default-voice and user-consented reference-voice output
   fully offline after installation. Use fixed, non-sensitive test passages
   of 20, 100 and 500 words, including punctuation and section boundaries.
   Run three cold loads and ten warm generations per voice/workload.
3. Measure download bytes, installed/compiled bytes, peak resident memory,
   model load time, time to first audio, total generation time and output
   duration. Real-time factor is generation seconds divided by audio seconds.
   Count omitted/repeated words and review intelligibility and voice similarity.
4. Repeat generation for 20 minutes on battery. Record thermal-state changes,
   battery change, crashes, memory warnings and end-of-run latency. Simulator
   or Mac inference results cannot substitute for these measurements.
5. Exercise cancellation while loading, conditioning, generating and playing;
   low storage; interrupted download; corrupted model; force quit/relaunch;
   and deleting a voice referenced by a saved script. Staging data must never
   become an installed model or playable complete audio revision.
6. Integrate SpeechAnalyzer capture separately, then test transitions between
   recognition and partner playback. Cover permission denial, missing language
   assets, pause/resume, calls, audio-route changes, screen lock and background
   suspension. Resume paused; reject late events from an old capture session.
7. With models installed, repeat offline and inspect network activity. Capture
   and recognition text remain transient. Persist voice-reference recordings
   only after explicit confirmation, and generated audio only through the
   requested save workflow. Reports contain metrics and fixture IDs only.

Before judging pass/fail, agree numerical budgets for generation latency,
memory, installation headroom, thermal behavior, battery use and quality with
the owner based on those measurements. The task provides no numerical budgets;
none have been invented or treated as accepted here. Immediate failures are
cloud dependence, fake output, missing reference conditioning, corrupt audio,
unrecoverable library loss or failure to stop capture/playback.

## Evidence still missing

| Required result | Current value |
| --- | --- |
| Runnable native iOS Chatterbox pipeline | Not implemented |
| Physical device / iOS / build revision | Not measured |
| Default and reference voice audio quality | Not measured |
| Peak memory / thermal / battery / latency | Not measured |
| Compiled storage and installation headroom | Not measured |
| Offline speech and audio-session recovery | Not measured |
| Agreed numeric acceptance budgets | Not set |
| Verified supported-device floor | None |

Once the gate passes, continue the task's Expo foundation, shared portable
domain package, library/editor, reader, voice workflows and LAN remote steps.
The existing library, presentation and remote tests should become compatibility
fixtures when extracting shared logic; they are not iOS verification today.
The full task remains open pending implementation and physical-device results.
