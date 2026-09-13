---
name: Vite public assets under a base path
description: How to avoid doubled path prefixes for public assets in Vite apps mounted below root.
---

Reference public assets from source HTML and CSS with root paths that omit the
configured Vite base path. Let Vite transform those URLs for development and
production output.

**Why:** Including the configured base directly in source asset URLs caused Vite
development transforms to add the same prefix again, producing requests such as
`/website/website/fonts/...` even though the production-looking source path
appeared correct.

**How to apply:** For an app whose Vite base is `/website/`, write source public
asset paths as `/fonts/...` or `/images/...`. Verify both transformed development
HTML and built output, because either one alone can hide the duplication.