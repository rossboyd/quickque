---
name: Native audio integration
description: Non-obvious FluidAudio API and model download pitfalls found during local Flow integration.
---

Treat batch VAD and streaming VAD as different APIs. In the inspected FluidAudio release, the convenient buffer-processing method creates fresh recurrent state on each call; calling it for successive microphone chunks does not make it stateful streaming VAD.

**Why:** This can silently undermine speech-inactivity detection even when each individual call succeeds.

**How to apply:** Check the pinned upstream implementation when changing VAD APIs or upgrading the library, and test continuous speech across chunk boundaries.

A model-repository revision check before an upstream download is not immutable pinning. The inspected downloader subsequently fetched the mutable main branch.

**Why:** Files may change between the preflight and transfer; hashing downloaded files afterward only detects later corruption, not whether they were the intended model.

**How to apply:** Fetch immutable revision URLs or verify against a pre-existing trusted file manifest before loading model bytes. Consult pinned source, since current documentation can describe newer APIs.