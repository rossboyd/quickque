---
name: Expo 57 splash configuration
description: Records the static app configuration compatibility rule discovered while validating Expo SDK 57.
---

Do not add the legacy top-level `splash` object to a static Expo SDK 57 `app.json`; Expo Doctor rejects it as an additional property.

**Why:** The familiar static splash shape can still appear in older guidance, but the SDK 57 config schema no longer accepts it.

**How to apply:** Keep valid icon and platform branding in `app.json`. Before adding custom splash behavior, confirm the current SDK's supported plugin or configuration path with Expo Doctor.