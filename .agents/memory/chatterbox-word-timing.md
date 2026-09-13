---
name: Chatterbox word timing
description: Limits of the bundled Chatterbox output and the boundary between playback-clock progress and exact word alignment.
---

The bundled Chatterbox generation path produces a waveform and sample rate, but does not expose token durations, attention alignment, phoneme timing, or word timestamps. Playback-clock progress can remain bounded to real audio time, but it is not exact forced alignment.

**Why:** Treating equal portions of passage duration as exact word timestamps would misrepresent pauses and variable word lengths. Exact timing requires an additional local forced-alignment step or model.

**How to apply:** Keep timeline-driven highlighting explicitly separate from exact alignment. If exact word matching is required, persist revision-bound UTF-16 ranges with start/end seconds derived from the generated WAV and a documented local aligner.