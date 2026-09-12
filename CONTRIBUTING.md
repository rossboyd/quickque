# Contributing to Quickque

Thanks for helping improve Quickque. Keep changes focused, local-first, and
honest about which platform has actually been tested.

## Before you start

1. Read the [README](README.md), especially the browser/Mac capability split
   and the desktop validation limits.
2. Search existing issues and pull requests before starting duplicate work.
3. For a behavior change, explain the user problem and the smallest useful
   solution.
4. Do not include credentials, tokens, private scripts, private meeting
   content, audio, transcripts, or personal data in an issue, commit, test
   fixture, screenshot, or pull request.

## Local setup

Use Node.js 24, pnpm 10.26.1, and the committed lockfile. From a fresh
checkout:

```sh
git clone https://github.com/rossboyd/quickque.git
cd quickque
pnpm install --frozen-lockfile
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/quickque dev
```

If you already have a checkout, use `pnpm install --frozen-lockfile` from its
root. Build the browser artifact with the same required environment:

```sh
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/quickque build
```

Run the checks relevant to your change:

```sh
pnpm run typecheck
pnpm --filter @workspace/quickque typecheck
pnpm --filter @workspace/quickque test:flow
pnpm --filter @workspace/quickque test:remote
pnpm --filter @workspace/quickque test:document-import
pnpm --filter @workspace/quickque test:library
sh tests/remote-protocol/run.sh
```

There is no universal external `pnpm run build` recipe: workspace artifacts
have different environment and packaging requirements. For the canonical Mac
source build, use the generated command block in the
[README](README.md), sourced from
[`config/site.json`](artifacts/quickque-website/config/site.json).

The native Swift test and desktop build require an Apple Silicon Mac running
macOS 14 or newer, Xcode 16, and stable Rust. Follow
[`artifacts/quickque/DESKTOP.md`](artifacts/quickque/DESKTOP.md) for native
work. Report the actual platform and hardware checks you ran; never describe a
browser preview or Linux build as Mac verification.

## Making a change

* Keep scripts and settings local unless a new requirement explicitly changes
  that privacy boundary.
* Preserve the browser/native capability boundary. Browser code cannot pin a
  window above another application or host the Mac phone service.
* Keep document import plain-text and bounded. Do not add document-triggered
  network fetches or runtime CDN dependencies.
* For changes to audio or Flow, preserve the no-recording behavior and make
  model downloads explicit.
* Preserve the current library behavior: **New script**, full-content search,
  visible selection and bulk actions, Trash with explicit permanent deletion,
  and persisted newest/oldest/title/custom ordering.
* Treat **Export Full Backup** and **Import Backup JSON** as the v2 full-backup
  contract. A full backup includes live scripts, Trash, active selection,
  custom order, and sort mode. Imports are additive with remapped IDs and
  preserve the destination's active selection and sort mode.
* Add or update tests with behavior changes. Use synthetic script and document
  text in fixtures.
* Update the canonical guide JSON under
  `artifacts/quickque-website/content/guide/` when user-facing instructions
  change. Keep links to those source files rather than inventing a production
  URL.
* Check new dependencies and model assets for their license and attribution
  requirements. Do not replace third-party notices with the root MIT license.

## Pull requests

Keep each pull request reviewable. Its description should include:

* the problem and the approach;
* the packages or platform surfaces changed;
* commands run and their results;
* Mac-only checks performed, or an explicit statement that they were not run;
* privacy, storage, network, and dependency/licensing implications; and
* screenshots or a short recording for visible reader changes, using synthetic
  content only.

Use the pull request template as a checklist. A maintainer may ask for a
smaller change, additional tests, or a follow-up guide update.

## Licensing

Quickque-owned code and documentation in this repository are released under
the [MIT License](LICENSE). Contributions intended for those parts should be
compatible with that license. Third-party code, models, and notices remain
under their respective terms; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).