# Quickque Website

A separate public-facing site and user guide. The Quickque app stays at its
existing route and keeps its existing browser storage. This site never reads
the app's scripts, settings, microphone, or phone-pairing service.

## Work locally

From a checkout of the repository, with Node.js 24 and pnpm 10.26.1:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/quickque-website dev
```

Outside Replit, the default address is `http://localhost:3000/website/`.
Set `PORT` if another local service uses port 3000.
In Replit, use the existing `artifacts/quickque-website: web` workflow instead
of starting a second server. It supplies the port and preview path.

```sh
pnpm --filter @workspace/quickque-website typecheck
pnpm --filter @workspace/quickque-website build
pnpm --filter @workspace/quickque-website serve
```

The website uses React rendering on the server, with browser hydration for
search, menus, and copy buttons. Production runs the Node server—not a Vite
development server or a catch-all static SPA rewrite. Content is present in the
first HTML response; unknown pages return HTTP 404.

## Write and maintain the guide

`content/guide/*.json` is the version-controlled source. Each file has a unique
`slug`, `title`, `description`, `category`, and a Markdown `body`. Keep
introductions short. Use actual UI labels, prerequisites, numbered instructions,
expected results, and troubleshooting. Link to another article as
`/guide/article-slug/`; image references use `/images/name.webp`. The renderer
adds the website prefix.

Read [docs/STYLE.md](docs/STYLE.md) for visual and voice examples and
[docs/CONTENT-AUDIT.md](docs/CONTENT-AUDIT.md) for the evidence behind current
claims. The guide follows the checked-out source, not an unverified release.
Re-audit app labels and behavior whenever functionality merges. Do not describe
queued work as available.

The install page reuses the requirements article; privacy reuses the privacy
article. Add `{{SOURCE_COMMAND}}` inside a fenced code block to display the
canonical Mac source-build commands from `config/site.json`. To update the
generated root README command block after editing that configuration:

```sh
node artifacts/quickque-website/scripts/sync-readme.mjs
node artifacts/quickque-website/scripts/check-site.mjs --content-only
```

With the managed website running, check initial HTML, metadata, links, anchors,
images, and 404s:

```sh
node artifacts/quickque-website/scripts/check-site.mjs
```

Outside Replit, pass your actual local website URL as `SITE_CHECK_URL`.
This is a test target, not the production canonical origin.

For automated checks without an existing server:

```sh
pnpm --filter @workspace/quickque-website build
node artifacts/quickque-website/scripts/check-production.mjs
node --test artifacts/quickque-website/tests/*.test.mjs
```

The test server uses a temporary port and shuts down afterwards. GitHub Actions
runs these checks alongside the app's platform-neutral tests; its workflow is
not a claim that any run has already passed on GitHub.

The library and reader pictures are authentic browser-preview captures using
built-in sample scripts. They do not establish native window behavior. Keep
their captions explicit, use synthetic/sample text only, and replace the
WebP files when the pictured UI changes. Never publish a private script.

## Release readiness

`config/site.json` holds the repository, branch, guide version, source command,
website base path, production origin, and release-readiness statement.
The release endpoint was empty when checked on 2026-09-12. No binary installer
is provided by this site. Missing or invalid configuration must fail closed.
Changing a release flag is not enough to make prebuilt installation available.

A future release integration must consume independently verified Mac outputs,
identify a concrete Apple Silicon asset and published checksum, link its
inspectable installer source, and test missing assets, failed downloads,
unsupported platforms, checksum failures, and existing installations. It must
never silently overwrite, elevate privileges, or disable Gatekeeper. Native
build/signing/device verification belongs to the desktop release work, not the
website checks.

## Optional packaged Mac distribution

Set the shared `QUICKQUE_PRICE_GBP` environment variable to the GBP price, for
example `77`. The server validates up to two decimal places and converts it to
Stripe's integer pence amount. The proposed packaged Mac app uses that
environment price as a one-time purchase, separate from
the free MIT-licensed source and its available source builds. A purchased
version is intended to remain usable forever; future major upgrades may cost
extra. No verified release or native Mac validation is available yet, so live
purchases remain gated. Development and the published demo may use the
connected Stripe test-mode catalogue; a sandbox checkout creates no licence or
download and never requires live Stripe credentials.

When checkout is enabled, billing and payment data goes to
[Stripe's privacy policy](https://stripe.com/privacy). The website backend
processes payment references and guest-checkout verification; it does not
receive Quickque scripts or audio. See the
[Stripe commerce runbook](docs/COMMERCE.md) for the current checkout boundary.

## Public origin and indexing

No production site has been published or domain selected by this work.
`productionOrigin` therefore remains `null`. Do not fill it with a preview URL
or a guessed production address.

After the owner chooses publishing, obtain the actual published HTTPS origin
from the publishing configuration and set it in `config/site.json`. Keep the
origin separate from `basePath`, which remains `/website/` in this workspace.
Build and serve in production mode, then verify canonical/social URLs, sitemap,
root `/robots.txt`, article refreshes, assets, and a genuinely missing route at
that origin. Development responses remain noindex, even if an origin is set.
Do not promise search rankings.

The website service also owns `/robots.txt` and `/sitemap.xml` because crawlers
look for robots policy at the domain root. This does not move the app or change
its storage origin. Preview policy excludes indexing; public policy allows the
website prefix and does not advertise private reader routes.

## Licensing

The website reads the root [MIT LICENSE](../../LICENSE) verbatim. Change that
file rather than maintaining a second permission notice. Quickque licensing
does not replace dependency or downloaded-model terms. See the root
[third-party notice index](../../THIRD_PARTY_NOTICES.md).