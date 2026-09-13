---
name: Bare artifact path prefixes
description: Routing nested artifacts when the shared path router treats the bare prefix differently from trailing-slash and deep routes.
---

When a nested Vite artifact is mounted at a path such as `/demo/`, explicitly
verify the bare `/demo` URL. Vite can reject that request with a plain-text 404
before the app loads. Add a pre-middleware redirect from the bare prefix to its
trailing-slash form, and keep an exact production rewrite alongside the deep
route rewrite.

**Why:** Claiming the nested trailing-slash prefix in the artifact manifest was
enough for deep routes, but the exact bare prefix still reached Vite and was
rejected as incompatible with its configured public base URL.

**How to apply:** Test the bare prefix, trailing-slash prefix, a deep client
route, and an asset through the shared proxy. The development middleware and
production rewrite must both cover the exact bare prefix.