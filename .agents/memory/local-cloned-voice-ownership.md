---
name: Local cloned voice ownership
description: Product decision for how Quickque creates, stores, and introduces Chatterbox voices.
---

Quickque’s Chatterbox workflow centers on a voice library created by the user, including their own voice, rather than system voices or a pre-packaged catalogue. First-run onboarding should introduce voice creation through a short rehearsal-style spoken prompt.

**Why:** A consistent user-owned library keeps voice behavior local and predictable while making personal narration and character casting part of the core setup experience.

**How to apply:** New voice features should preserve stable local references, explicit consent, and device-only audio storage. Scripts and backups may contain voice identity metadata but never reference audio or conditioning data.