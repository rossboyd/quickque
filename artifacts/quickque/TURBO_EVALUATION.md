# Chatterbox-Turbo: release gate, not a shipped engine

## Decision

**Unavailable in Quickque.** No Turbo runtime, weights, upstream demo voices,
reference conditioning, or downloader ships with this change. This is an
intentional safety gate, not a verified integration or a simulated installer.
The system-voice scene partner does not depend on Turbo or Flow installation.

The evaluation host is **Linux x86_64**, not Apple Silicon. Real synthesis,
listening quality, unified-memory use, cancellation and Flow coexistence could
not be measured here. All Mac measurements below are **not run / unverified**.
No CUDA benchmark or browser result substitutes for those measurements.

## Implementation progress (2026-09-12)

The user has specified an **M2 Mac with 24 GB RAM** and requested progress on
Resemble. A developer-only [evaluation runner](scripts/turbo/README.md) now
prepares hash-verified pinned model assets and measures the official MPS
implementation with a separately cleared voice. Model preparation is explicit;
normal evaluation is offline and does not save generated audio. Download,
integrity, cancellation cleanup and voice-manifest validation have unit tests.
No model weights were downloaded on this host, no cleared voice is available,
and no Mac benchmark has run. This is not yet an app runtime or a release.

## Pinned source inspection (2026-09-12)

These are evaluation pins, not an approved runtime lock:

| Item | Immutable revision |
|---|---|
| [Chatterbox source](https://github.com/resemble-ai/chatterbox/tree/5de7a54aa4e5e2baadb0182dde554908b48b85c2) | `5de7a54aa4e5e2baadb0182dde554908b48b85c2` |
| [Turbo model](https://huggingface.co/ResembleAI/chatterbox-turbo/tree/749d1c1a46eb10492095d68fbcf55691ccf137cd) | `749d1c1a46eb10492095d68fbcf55691ccf137cd` |
| [Perth watermarking source candidate](https://github.com/resemble-ai/Perth/tree/ff1c8ac55a976971245cdd53c18d6131ca00d993) | `ff1c8ac55a976971245cdd53c18d6131ca00d993` |

Inspected source files: `pyproject.toml`, `LICENSE`, `README.md`,
`src/chatterbox/tts_turbo.py`; pinned model README, tree metadata and
`added_tokens.json`. Public metadata was fetched; multi-gigabyte weights were
not downloaded or hashed locally.

- The package declares `chatterbox-tts` **0.1.7**, Python >=3.10. For Python
  3.11 the declared core versions include torch/torchaudio 2.6.0,
  transformers 5.2.0, diffusers 0.29.0, librosa 0.11.0, safetensors 0.5.3,
  conformer 0.3.2, pykakasi 2.3.0 and gradio 6.8.0. NumPy is a range;
  s3tokenizer, spacy-pkuseg, pyloudnorm and omegaconf are unpinned.
  `resemble-perth` comes directly from Git **master**. Python >=3.14 changes
  torch/torchaudio to open-ended >=2.9.0. This is not a reproducible,
  self-contained arm64 runtime.
- The model card labels Turbo **English-only, 350M**, with MIT model metadata.
  This description does not mean the whole runtime or weights occupy 350 MB.
- `from_local` CPU-loads non-CUDA checkpoints before moving modules to MPS.
  `from_pretrained` checks MPS, **silently falls back to CPU** if unavailable,
  and calls `snapshot_download` without a revision or offline constraint.
  Its broad patterns also download an unused non-meanflow decoder. Quickque
  must not use this convenience loader in normal offline generation.
- `generate` explicitly ignores **CFG, exaggeration and min_p**. It also
  normalizes punctuation and tokenizes with truncation enabled. These are
  dialogue-fidelity risks to test, not supported acting controls.
- `[laugh]`, `[chuckle]`, `[cough]`, `[clear throat]`, `[gasp]`, `[groan]`,
  `[shush]`, `[sigh]`, `[sniff]` appear in the pinned token file. Token presence
  and upstream documentation establish syntax, **not Mac quality approval**.
  No Turbo delivery controls are enabled in Quickque yet. System voices have
  no promised support for these tags. Character age, gender and performance
  descriptions and director notes are not synthesis instructions.
- `generate` applies `PerthImplicitWatermarker` to generated audio. Any future
  integration must preserve this watermark and account for its latency,
  licence and arm64 dependencies. Do not disable it to pass a benchmark.
- Reference input must be longer than five seconds. The encoder conditioning
  window is 15 seconds; decoder conditioning is 10 seconds. Upstream
  `conds.pt` is loaded automatically if present. **Do not ship/use it** until
  the underlying voice's consent and redistribution provenance are verified.

## Weight metadata and expected size

The pinned repository reports these LFS SHA-256 identifiers. They are expected
digests from upstream metadata, **not a claim of local integrity verification**.

| Required checkpoint | Bytes | Expected SHA-256 |
|---|---:|---|
| `t3_turbo_v1.safetensors` | 1,915,480,052 | `fcf1f8c1d651bb7e3acd69ee5be269b4ac10c02980b7708213d598bc9f7cdf87` |
| `s3gen_meanflow.safetensors` | 1,064,875,036 | `d65cb687a2ed581ee6cc297e919ffefa63386944f42364ae13b78a594945514f` |
| `ve.safetensors` | 5,695,784 | `f0921cab452fa278bc25cd23ffd59d36f816d7dc5181dd1bef9751a7fb61f63c` |

These three files total **2,986,050,872 bytes (about 2.99 GB / 2.78 GiB)**,
before tokenizer files, a cleared reference pack, Python, native libraries and
runtime dependencies. Final installed size and temporary installation space
are unknown until packaging is established. Do not advertise this subtotal as
the final download size. The extra `s3gen.safetensors` is 1,056,484,620 bytes
and is not used by the inspected Turbo `from_local` path.

## Rights and packaging blockers

The source is MIT with Resemble AI's notice; the pinned model card declares MIT.
Neither establishes consent to redistribute an identifiable reference voice.
No rights-cleared reference pack is available in this workspace. Do not copy
demo voices, treat “freely available on the internet” as permission, or add
user-uploaded cloning as a workaround.

Before release, retain a provenance ledger for each stable voice ID: original
asset checksum, creator/licensor, exact licence text, consent for synthetic
voice use and redistribution, allowed uses, acquisition date and attribution.
Use commissioned/explicitly licensed voice-pack inputs, not actor recordings.

A future self-contained arm64 runtime must have a complete immutable
dependency lock, hashes, licence notices, signed/notarized executable and
library compatibility evidence. It must run without a user-managed Python
environment. No first-run pip installation, dependency update, dynamic
repository code, or hidden network access is acceptable. Keep the Swift
Apple-Speech Flow helper independent.

Only after these gates pass, implement explicit install/size/compatibility
confirmation; progress, cancellation, retry, integrity verification before
atomic activation, and removal of owned assets. Verify corrupt/truncated files,
disk exhaustion, process exit, cancelled installs and interrupted upgrades.
Removal must not delete scripts or unrelated assets. Until then a fake
download button would be misleading.

## Predeclared Apple Silicon release thresholds

Freeze this protocol **before** measuring. Proposed minimum evaluation machine:
Apple Silicon Mac with 16 GB unified memory and macOS 26+ (for Flow coexistence).
Record actual model/chip, RAM, macOS build, power mode, Xcode, Python/runtime
lock, source/model/voice hashes and whether MPS fallback is disabled. Approval
applies only to the measured configurations.

Run 5 cold process loads and 30 warm utterances, both with Flow unloaded and
loaded but not capturing during synthesis. Use at least 3 cleared voices and
short (5–15 words), medium (40–80 words) and long (150–250 words) dialogue,
consecutive partner turns, repeated phrases, names/numbers, difficult
pronunciation, punctuation and each approved non-speech cue. Use only synthetic
test scripts and cleared references; listen live without recording the user.

| Measurement | Threshold to pass | Observed |
|---|---|---|
| Cold load, ready to generate | p95 <=30 s | Not run |
| Cold first short line, ready audio | p95 <=10 s after model ready | Not run |
| Warm first short line | p95 <=3 s | Not run |
| Sustained generation, all turn lengths | p95 real-time factor <=0.8 | Not run |
| Prepared-line cue to audible start | p95 <=150 ms | Not run |
| Stop audible playback after cancellation | p95 <=200 ms | Not run |
| Cancel inference and discard late result | <=2 s; zero stale playback | Not run |
| Peak combined process resident memory | <=6 GiB | Not run |
| Unified-memory pressure on 16 GB Mac | no sustained yellow/red pressure or increasing swap | Not run |
| Flow/speaker handoff, 100 alternating turns | zero partner-triggered advances, zero mic/speaker overlap | Not run |
| Script fidelity | zero added/omitted dialogue words in approved corpus | Not run |
| Voice and tag fidelity | no unintended voice switches; every released cue accepted by two listeners | Not run |
| 30-minute repeated session | no progressive memory growth >10% after warm-up | Not run |
| Offline launch and generation | zero network requests, works with networking blocked | Not run |

Record per-line durations and content-free metrics, peak process RSS and
system memory pressure (not just Python allocation estimates), cancellation
timestamps and listener pass/fail notes. Do not store generated dialogue,
voice samples or recognized text in telemetry. Explicitly record all failures
and compare with thresholds; do not relax thresholds after seeing results.

## Bounded preparation contract for a future enabled engine

Use memory-only PCM preparation, maximum **2 prepared turns**, **30 seconds
combined audio**, **8 MiB**, **1 active generation** and **1 pending job**.
Whichever bound is hit first wins. A line exceeding the bound must produce an
actionable message, not allocate an entire script. Cache keys include exact
dialogue, assigned character, stable voice ID, explicit supported cues and
engine/runtime/model revision. Never include director notes as prompts.

Edits, voice/settings changes and reassignment invalidate keys; navigation and
session generations reject stale work. Pause stops audible output; exit stops
inference and clears buffers. No temporary WAVs, persistent generated audio,
automatic voice substitution, or script/transcript logging. Errors and memory
pressure offer explicit retry or user-selected system voice, never a mid-line
performance change. The enabled system-speech boundary streams through the OS
and does not need a generated-audio cache.