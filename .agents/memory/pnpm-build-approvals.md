---
name: pnpm build approvals
description: Build-script approval compatibility across pnpm 10 and 11.
---

Use an explicit `allowBuilds` map with pnpm 10.26 or newer, preserving the
existing narrow set of approved packages.

**Why:** pnpm 11 removed `onlyBuiltDependencies`. An older allowlist can leave
esbuild's installation script unapproved even though its name appears in the
workspace configuration. The Mac install failure did not include a pnpm version,
so that log alone does not establish which version was installed.

**How to apply:** Check the documented settings for the installed pnpm version.
Do not solve build-script approval failures by allowing every dependency script,
turning off strict build checks, or weakening the minimum-release-age policy.