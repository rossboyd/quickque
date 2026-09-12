---
name: Native test exit status
description: XCTest success does not establish that the whole Swift test process succeeded.
---

Treat the exit status of the entire Swift test invocation as authoritative, not only the XCTest suite summary.

**Why:** A Mac build reported all XCTest cases passing, then printed a linked audio-export command's usage and exited with failure. Linking executable entry points into tests can expose runner behavior beyond the XCTest phase.

**How to apply:** Keep testable helper logic separate from command entry points. When investigating Mac test failures, inspect output after the suite summary as well as assertions. Linux text checks cannot confirm Swift runner or AVFoundation behavior.