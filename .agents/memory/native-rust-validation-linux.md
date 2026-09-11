---
name: Native Rust validation on Linux
description: How to validate platform-neutral desktop Rust code when the full Tauri crate cannot compile in Replit's Linux environment.
---

Validate platform-neutral Rust modules in a temporary minimal Cargo crate when a full Tauri build is blocked by missing Linux GTK/WebKit development libraries.

**Why:** Tauri's Linux dependency graph can fail before reaching application code, while the target product and final verification environment are macOS. Isolating a standard-library module with only its direct serialization dependencies still catches real Rust type, borrow, and unit-test failures.

**How to apply:** Use this only for modules that do not depend on Tauri APIs. Keep the full macOS build and hardware behavior in the existing Mac verification work; do not treat the isolated check as a substitute for it.