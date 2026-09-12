# Chatterbox Turbo: Mac evaluation runner

Target requested by the user: **M2, 24 GB unified memory**. This is developer
infrastructure, not a shipped runtime, installer UI, or enabled cast voice.
No Mac synthesis or performance result has been obtained on this Linux host.

`evaluate.py` adds a concrete path to test the official Resemble implementation:

- Downloads only eight pinned model/tokenizer files (see `model-lock.json`).
  Verifies exact byte counts and SHA-256 before atomically installing the folder.
  Interruptions and failed downloads remove staging files; existing installations
  are checked, never merged or overwritten. `prepare` is the only network action.
- Excludes the upstream demo voice (`conds.pt`) and unused decoder.
- Requires separate, hash-checked, cleared voice conditioning. Records consent
  and provenance in a developer manifest; never accepts actor recordings from
  a script or provides a user voice-cloning feature.
- Uses `from_local` on MPS, disables CPU fallback, sets offline environment flags,
  and blocks Python socket connections before importing the runtime. Still test
  with networking blocked at the OS boundary before release.
- Calls the official `generate()` path, which applies Perth watermarking.
- Runs a fixed synthetic corpus sequentially. Reports load time, generation time,
  audio duration, real-time factor, system RAM, and process peak RSS. Optional
  live playback uses RAM only; no generated audio or dialogue is written out.
- Ctrl-C terminates the evaluation; playback stops in `finally`. This does not
  validate Quickque's app cancellation/handoff or production buffer limits:
  the output buffer bound is checked after upstream generation allocates audio.

## Use on a developer Mac

Python 3.11 arm64 and an isolated environment containing the inspected Chatterbox
source revision and compatible dependencies are prerequisites. The runner checks
`tts_turbo.py` against its inspected source hash. This is **not** a complete
runtime dependency lock. See ../../TURBO_EVALUATION.md for inspected dependency
versions and remaining packaging requirements. Optional `--listen` also requires
`sounddevice` and working local PortAudio. No pip installation occurs in this tool
or in the app.

From this directory:

```sh
# Explicit download: about 2.99 GB, excluding runtime and voice pack.
python3 evaluate.py prepare --model-dir "$HOME/Library/Application Support/Quickque-dev/turbo-model"

# Offline integrity check; stdlib only.
python3 evaluate.py check --model-dir "$HOME/Library/Application Support/Quickque-dev/turbo-model"

# Only after a cleared evaluation voice and developer runtime are provisioned.
python3 evaluate.py benchmark --model-dir "$HOME/Library/Application Support/Quickque-dev/turbo-model" --voice-manifest /path/to/cleared-voice/manifest.json --runs 30 --listen

python3 -m unittest discover -s . -p 'test_*.py'
```

The voice manifest lives beside a precomputed official Chatterbox `Conditionals`
file, loaded with the upstream `weights_only=True` loader. It has this shape:

```json
{
  "file": "voice.pt",
  "sha256": "<actual SHA-256 of the conditioning file>",
  "consent": "approved-for-quickque-evaluation",
  "provenance": "<creator, licence/consent record, permitted evaluation use>"
}
```

The manifest records existing permission; filling it out does not grant rights.
No such voice asset is currently supplied. Distribution needs the full ledger
and synthetic-use/redistribution rights described in TURBO_EVALUATION.md.

## Validation still needed

Run five independent cold loads, then warm runs and listening checks on the M2.
The first generation in each process is cold; later generations are warm.
Process RSS does not measure all Metal/unified-memory pressure; capture Activity
Monitor separately. This corpus is an initial smoke benchmark, not the complete
release matrix (long turns, three voices, Flow handoff, cancellation, sustained
memory, script fidelity). See the evaluation document for the remaining checks.

The native MLX Swift port was also inspected. At revision `bf14ae0c26e4e85553dd989571cae29d70fa6735` its local
Chatterbox loader downloads S3TokenizerV2 and its generation implementation has no
Perth call. It was not selected for the initial runner. Do not drop watermarking
or introduce hidden downloads to simplify packaging.
