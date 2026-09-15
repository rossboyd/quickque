---
name: Root-mounted browser module tests
description: Why browser tests with absolute dynamic imports need an isolated root-mounted Vite server.
---

Browser tests that dynamically import modules with absolute URLs such as `/src/...` or `/node_modules/...` must run against a Vite server mounted at `/`.

**Why:** An artifact workflow mounted under a base path can load the application correctly while those absolute test-only imports bypass the base and fail from the server root, producing misleading module-fetch errors.

**How to apply:** For this class of test, use an isolated Vite process with its required `PORT` environment variable and a root base path. Keep normal artifact workflow checks on the configured preview path.