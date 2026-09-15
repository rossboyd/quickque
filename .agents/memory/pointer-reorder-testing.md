---
name: Pointer reorder testing
description: Reliable browser regression checks for pointer-driven reordering controls.
---

When testing pointer-driven reordering, ensure both the drag handle and destination are inside the browser viewport before calculating coordinates and moving the pointer.

**Why:** Playwright can return a bounding box for content below the visible viewport, but moving the mouse to that offscreen coordinate does not exercise the application’s pointer-move and pointer-up path. This can look like a broken reorder implementation.

**How to apply:** Use an appropriately tall viewport or scroll both controls into view, calculate bounds afterward, then move from the handle to the intended half of the destination with several intermediate steps.