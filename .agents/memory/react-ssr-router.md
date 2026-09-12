---
name: React SSR router compatibility
description: A Wouter/React server-rendering incompatibility that does not appear in TypeScript checks.
---

Do not assume Wouter's memory-location hook supports React server rendering.
The observed Wouter 3.11 hook lacks the server snapshot required by React 19's
external-store hook; use the router's supported server-path mechanism instead.

**Why:** A successful TypeScript check and Vite SSR bundle still produced HTTP
500 on the first real render. The failure only appeared when rendering a
component that consumed the location.

**How to apply:** When changing router versions or SSR integration, run the
production renderer against an article deep link as well as the homepage.
Check initial HTML and status codes rather than relying only on a hydrated
browser screenshot.