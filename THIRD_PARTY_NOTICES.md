# Third-party notices

The root [MIT License](LICENSE) applies only to Quickque-owned code and
documentation. It does not relicense dependencies, parser implementations,
Tauri/Rust dependencies, FluidAudio, or model weights. Preserve the
terms and notices that accompany each component when redistributing a build.

## Attribution basis

This attribution record is based on the repository history, current package and
native manifests, and an unauthenticated check of the public
[`rossboyd/quickque`](https://github.com/rossboyd/quickque) repository. The
history currently attributes commits to `rossboyd` and `Replit Agent`; the
public repository owner is `rossboyd`. No separate legal entity is asserted by
this file. At the time of the check, the public GitHub repository had no
declared repository license and no published releases. Those observations do
not change the root license for Quickque-owned material and should be
rechecked before distribution.

## Native Flow components

These notices are also shipped in
[`artifacts/quickque/native/THIRD_PARTY_NOTICES.txt`](artifacts/quickque/native/THIRD_PARTY_NOTICES.txt).
The source pins and model revisions are recorded there; keep that file with
native distributions.

### FluidAudio

The Quickque Flow helper integrates FluidAudio 0.15.7 from the pinned upstream
revision recorded in the native notice. FluidAudio is licensed under the
Apache License, Version 2.0:

<https://www.apache.org/licenses/LICENSE-2.0>

Source:
<https://github.com/FluidInference/FluidAudio/tree/v0.15.7>

### Parakeet Realtime EOU model

The Parakeet Realtime EOU 120M model weights are separately licensed under the
**NVIDIA Open Model License**. They are not covered by FluidAudio's Apache-2.0
license or by Quickque's MIT license:

<https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/>

Model and immutable revision:
<https://huggingface.co/FluidInference/parakeet-realtime-eou-120m-coreml>

### Silero VAD

The Silero VAD model and the FluidAudio CoreML conversion are identified in the
native notice and are distributed under the MIT License. Model and immutable
revision:

<https://huggingface.co/FluidInference/silero-vad-coreml>

## Document-import components

The parser notices, including their license text, are shipped at
[`artifacts/quickque/src/lib/document-import/THIRD_PARTY_NOTICES.txt`](artifacts/quickque/src/lib/document-import/THIRD_PARTY_NOTICES.txt).
That file covers the locally bundled parser dependencies, including
`xmlchars`, `fflate`, `saxes`, and `pdfjs-dist`. Keep the complete notice with
redistributions; this summary is not a replacement for it.

## Other dependencies

### Website font

The website's current typography uses DM Serif Display and Inter, distributed
under the SIL Open Font License 1.1. Full copyright and permission notices are
retained alongside the self-hosted fonts:
- [DM Serif Display notice](artifacts/quickque-website/public/fonts/OFL-DMSerifDisplay.txt)
- [Inter notice](artifacts/quickque-website/public/fonts/OFL-Inter.txt)

Source projects: <https://github.com/google/fonts/tree/main/ofl/dmserifdisplay>
and <https://github.com/google/fonts/tree/main/ofl/inter>.

Manrope © 2018 The Manrope Project Authors
(<https://github.com/sharanda/manrope>), licensed under the SIL Open Font
License 1.1. The website serves the variable font locally. Its complete notice
is retained at
[`artifacts/quickque-website/public/fonts/OFL-Manrope.txt`](artifacts/quickque-website/public/fonts/OFL-Manrope.txt).
The source font and notice come from
<https://github.com/google/fonts/tree/main/ofl/manrope>.
Quickque's MIT license does not replace the font's terms.

The workspace manifests and `pnpm-lock.yaml` identify the JavaScript
dependencies, while the Cargo manifests and lockfiles identify Rust
dependencies. Each dependency keeps its own copyright, license, and notice
requirements. Review those terms before shipping a packaged application.

If a new dependency, model, font, fixture, or generated asset has an
attribution requirement, add the authoritative notice beside the relevant
source and update this index. Do not copy a third-party license into the root
MIT text or imply that model weights are Quickque-owned.