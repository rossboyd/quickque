---
name: Cloned voice profile metadata
description: Compatibility rules for descriptive tags on locally cloned voices.
---

Emotion, gender, and age-range fields are optional organizational and performance notes stored with each device-local cloned voice. Editing these descriptive fields must preserve the voice ID, reference ID, recording, and revision.

**Why:** Script assignments and generated-audio caches use stable voice references and recording revisions. Changing a descriptive label should not invalidate audio or make an existing assignment appear stale.

**How to apply:** Keep profile fields optional and backward-compatible with metadata created before tags existed. Increment the revision only when the recording or another audio-affecting property changes.