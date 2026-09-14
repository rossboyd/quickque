---
name: Licence signing configuration
description: Requirements for shipping Mac builds that can activate server-signed licences.
---

Packaged Mac releases must fail closed unless they include the public Ed25519 key allowlist, the HTTPS licence API endpoint, and a positive immutable release timestamp. Only the private signing key remains secret and server-side.

**Why:** An earlier unsigned test DMG silently compiled without these values and could never activate a valid customer key. Replit Secrets also flattened the multiline PKCS#8 PEM into one line, so server signing must restore PEM line breaks before parsing.

**How to apply:** When changing the signing key, update the server key ID and the public key embedded by the Mac packaging workflow together. Republish the server, rebuild the DMG, then test activation with a real entitlement.