---
name: Reader theme isolation
description: Why the workbench theme preference must not alter reader mode.
---

Reader mode always uses Quickque's main dark theme. The light/dark preference
applies only to the workbench, and the selected workbench theme must be restored
when the reader closes.

**Why:** The reader's controls, default foreground, overlays, and transparent
presentation behavior depend on the dark theme; inheriting the light workbench
theme breaks readability and presentation styling.

**How to apply:** Treat the reader as a dark theme boundary, including portalled
dialogs and popovers. Do not derive reader defaults, foreground colors, or
presentation migration colors from the workbench theme setting.