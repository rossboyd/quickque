# Quickque content truth audit

This audit records the source evidence used for the guide articles in
`content/guide/`. It is deliberately separate from the application
documentation. The guide describes the current source tree, not a planned
feature set or a release promise.

## Release and installation truth

- A `GET https://api.github.com/repos/rossboyd/quickque/releases` observed on
  2026-09-12 returned `[]`. No public installer script or Homebrew
  distribution is available. The articles therefore do **not** present a
  `curl` installer, a guessed `brew install` command, or a prebuilt download
  as available.
- The source-build command is intentionally the literal
  `{{SOURCE_COMMAND}}` token in a fenced shell block. The canonical command
  and release configuration remain centralized; this content does not invent
  them.
- The browser development command is not inferred from a mockup. The
  application Vite configuration requires `PORT` and `BASE_PATH` at
  `artifacts/quickque/vite.config.ts:9-29`, and the package script is
  `artifacts/quickque/package.json:6-17`. The guide uses the requested route:
  `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/quickque dev`.
- Native prerequisites and local build commands are evidenced by
  `artifacts/quickque/DESKTOP.md:9-45` and
  `artifacts/quickque/package.json:10-17`: Apple Silicon, macOS 26+, Xcode
  26/Swift 6.2, stable Rust, Node, pnpm, and the `native:*`/`desktop:*` scripts.
  The root `package.json:4,7` pins pnpm 10.26.1, and the content pins Node 24
  and pnpm 10.26.1 accordingly.
- The articles never call a source build a verified release. The repository
  explicitly says native compilation and execution have not been performed in
  the Linux environment, and lists microphone, packaging, model, CoreML,
  window, accuracy, latency, resource, and meeting-app checks as Mac-only
  validation in `artifacts/quickque/DESKTOP.md:293-311`.

## Current app evidence

### Library, scripts, and persistence

- `artifacts/quickque/src/pages/library.tsx:237-279` supplies the exact
  library controls **New script**, **Import document**, **Library**, and
  **Trash**. `library.tsx:282-340` supplies **Search all script content…**,
  **Search Trash…**, the result count, and the sort labels **Newest First**,
  **Oldest First**, **Title A-Z**, **Title Z-A**, and **Custom Order**.
- `artifacts/quickque/src/pages/library.tsx:342-401` supplies the retained
  Trash notice, **Select all shown**, selection counts, **Actions**, bulk
  **Export as TXT**, **Export as JSON**, **Move to Trash**, **Restore to
  library**, and **Delete permanently** controls.
- `artifacts/quickque/src/pages/library.tsx:412-530` supplies row
  checkboxes, inline **Rename**, **Duplicate**, per-script export actions,
  **Move to Trash**, and custom-order **Move Up**/**Move Down** behavior.
  `library.tsx:646-741` supplies the exact item-menu labels, including
  **Rename**, **Duplicate**, **Export as TXT**, **Export as JSON**, **Move
  Up**, **Move Down**, **Move to Trash**, **Restore**, and **Delete
  Permanently**. `library.tsx:590-640` supplies the move/restore/permanent-
  delete confirmation titles and the recoverable versus irreversible copy.
- `artifacts/quickque/src/lib/library-management.ts:3-49` supplies
  case-insensitive search across script titles, section titles, and section
  content, plus stable newest/oldest/title/custom sorting.
- `artifacts/quickque/src/lib/store.tsx:406-544` supplies create/update,
  duplicate, Trash, restore, permanent-delete, sort-mode, and custom-order
  commits. `store-model.ts:117-207` supplies additive Trash transitions and
  filtered/custom reorder semantics.
- `artifacts/quickque/src/lib/store.tsx:546-574` and
  `store-model.ts:46-102` supply additive backup import, collision-only ID
  remapping across live scripts, sections, and Trash, imported custom-order
  mapping, and preservation of the destination active selection and sort mode.
- `replit.md:28-37` and `replit.md:50-51` establish the local-first
  architecture, transient speech boundary, separate browser/desktop storage,
  and backup requirement. The articles preserve those boundaries and do not
  suggest synchronization or forensic erasure.

### Settings and backup semantics

- `artifacts/quickque/src/components/settings-dialog.tsx:50-53` supplies the
  browser-generated `quickque-backup-YYYY-MM-DD.json` filename.
  `settings-dialog.tsx:55-148` supplies the library link **Settings & backups**,
  dialog title **Settings & Help**, **Appearance**/**Data** sections, and exact
  **Export Full Backup**/**Import Backup JSON** labels.
- `artifacts/quickque/src/lib/store.tsx:601-641` and
  `store-persistence.ts:458-504` confirm that a full export is a version 2
  envelope containing scripts, `activeScriptId`, Trash, `customOrder`, and
  `sortMode`; settings and Flow models are not serialized. Selected-item
  **Export as JSON** remains a script-array export.
- `artifacts/quickque/src/lib/store-persistence.ts:4-19,26-65,291-345`
  confirms v2 validation and compatibility with v1 envelopes and historical
  bare arrays. `store-persistence.ts:353-373` confirms backup-size and JSON
  validation before any storage write.
- `artifacts/quickque/src/lib/store.tsx:546-574` confirms import is additive:
  live scripts and Trash entries are merged, only colliding identities are
  remapped, imported order is merged, and destination active selection and
  sort mode remain unchanged. `store.tsx:322-367` confirms failed writes leave
  the prior durable library, Trash, selection, and sort state untouched.
- Settings are loaded from and persisted to the separate `quickque_settings`
  entry at `store.tsx:286-301` and `store.tsx:385-397`, so the articles
  correctly say that appearance/reader settings are not in the full library
  backup.

### Reader and presentation

- `artifacts/quickque/src/pages/reader.tsx:448-480` supplies the keyboard
  behavior: Space play/pause, Esc exit, Right Arrow next section, and Left
  Arrow previous section, with focused form controls excluded.
- `reader.tsx:492-515` supplies the active-playback control auto-hide behavior.
  `reader.tsx:600-663` supplies the exact mode labels **Manual Scroll** and
  **Voice Follow**, font controls, **Scroll Speed**, and **Background
  Opacity**.
- `reader.tsx:667-755` supplies the marker, pause/Flow status copy, section
  rendering, and the text-following behavior. `reader.tsx:767-815` supplies
  **Previous Section**, **Next Section**, section selection, and the play
  control.
- The article screenshots use the committed
  `artifacts/quickque-website/public/images/library.webp` and
  `artifacts/quickque-website/public/images/reader.webp`. The regenerated
  `artifacts/quickque-website/public/images/library.jpg` and
  `library.webp` captures are 1360 × 900 and include the current **New script**,
  Trash, search, selection, and sorting controls. Each occurrence is explicitly
  labeled as a browser preview and not native evidence. No
  unsupported screenshot, testimonial, performance number, download count, or
  social proof was added.

### Document import

- `artifacts/quickque/src/components/document-import-dialog.tsx:79-208`
  supplies the one-file extension check, extraction/cancel flow, review
  fields, validation, and **Save as Script** action.
- `document-import-dialog.tsx:218-263` supplies the exact **Import Document**
  description, 10 MB input notice, local-processing notice, plain-text
  warning, and single-file drop behavior.
- `document-import-dialog.tsx:266-352` supplies **Extracting text...**,
  **Cancel**, **Script Title**, **Extracted Text**, review warnings, and
  **Save as Script**.
- `artifacts/quickque/src/lib/document-import/PARSERS.md:1-30` confirms
  disposable-worker extraction, no network/HTML execution/resource fetching,
  and parser boundaries. `PARSERS.md:32-60` confirms 10 MiB input, 32 MiB
  expanded content, 500 PDF pages, 500,000 UTF-16 output, no OCR/scanned
  image extraction, and layout/column limitations.
- The articles keep the implementation's plain-text behavior and do not
  promise OCR, rich formatting, images, or document-triggered downloads.

### Mac overlay

- `artifacts/quickque/src/lib/desktop.ts:128-185` supplies the native
  transition: save state, 620 × 380 compact size, 360 × 260 minimum,
  undecorated window, always-on-top, all-workspaces behavior, and restoration.
- `desktop.ts:9-15` supplies the overlay shortcut accelerators and
  `desktop.ts:42-77`/`:80-95` supplies registration and cleanup behavior.
- `artifacts/quickque/src/pages/reader.tsx:543-595` supplies the exact
  **Toggle Compact Overlay** title and **Phone Remote** trigger.
- `artifacts/quickque/DESKTOP.md:236-257` confirms browser no-op behavior,
  shortcut names, registration errors, all-Space limitations, and screen
  sharing/recording precautions.

### Local Flow

- `artifacts/quickque/src/hooks/use-local-flow.ts:8-24` supplies the Flow
  state vocabulary and actions. `use-local-flow.ts:203-267` supplies start,
  pause, stop, explicit download, and cancellation behavior.
- `artifacts/quickque/src/components/flow-status-panel.tsx:25-100`
  supplies the exact user labels **Voice Following (Flow)**, **Download &
  Install**, **Downloading Model...**, **Cancel**, **Local model ready. Start
  when you are ready to speak.**, **Start microphone**, **Restart listening**,
  and the 30-second silence message.
- `flow-status-panel.tsx:35-45` supplies the temporary-memory, no-upload
  notice and model-license notice. `artifacts/quickque/DESKTOP.md:60-121`
  supplies explicit download-before-offline, immutable model verification,
  cache, microphone, transient event, no logging, buffer, and 30-second
  silence details.
- The articles describe Flow as optional, native Apple Silicon, English-only,
  no speaker identification, explicit model download, offline inference, and
  no saved audio/transcripts. They do not claim accuracy, latency, native
  execution, or a browser/cloud fallback.

### Phone Remote

- `artifacts/quickque/src/components/remote-control-dialog.tsx:108-147`
  supplies **Local Phone Remote**, **Desktop App Required to Host**, and the
  browser-preview limitation.
- `remote-control-dialog.tsx:149-207` supplies automatic start, **Stop**,
  status text, and **New QR** behavior. `remote-control-dialog.tsx:241-337`
  supplies connected/pending/rejected/expired states, approval, and
  replacement controls. `remote-control-dialog.tsx:340-405` supplies the QR,
  manual URL/code fallback, five-minute countdown, trusted-LAN warning, and
  unencrypted HTTP warning.
- `artifacts/quickque/DESKTOP.md:124-205` supplies idempotent session
  lifecycle, one-controller approval, minimal snapshot, five-minute pairing,
  token scope, LAN address rules, and no automatic IP-change recovery.
- `DESKTOP.md:207-221` and
  `artifacts/quickque/REMOTE_OFFLINE_CHECKLIST.md:1-81` explicitly state that
  physical Mac/phone, camera, firewall, offline first-visit, and local-network
  verification has not been run. The article says so rather than calling
  protocol checks a pass.

## Article inventory

All twelve requested slugs are present as JSON objects with exactly
`slug`, `title`, `description`, `category`, and Markdown `body`.

| Slug | Category | Main source-backed coverage |
| --- | --- | --- |
| `requirements-installation` | Getting started | Supported prerequisites, source route, browser route, release truth, Gatekeeper caution |
| `first-presentation` | Getting started | Create, title, section, Present, manual first run, interruption |
| `scripts` | Your scripts | New script, edit, full-content search, selection/bulk actions, Trash, sorting, custom order, duplicate, persistence |
| `document-import` | Your scripts | TXT/DOCX/RTF/PDF, review, local extraction, limits, no OCR |
| `backup-restore` | Reference | Export Full Backup, Import Backup JSON, v2 envelope, Trash, active selection, sort/order metadata, additive collision remap, migration |
| `playback` | Presenting | Manual Scroll, pause, speed, appearance, section controls, shortcuts |
| `mac-overlay` | Presenting | Native overlay geometry, shortcuts, restore, Spaces, screen sharing |
| `local-flow` | Presenting | Explicit model download, mic permission, offline use, transient data, silence stop |
| `phone-remote` | Presenting | QR, approval, controls, trusted LAN, HTTP warning, expiry/reconnect |
| `privacy` | Reference | Persistent v2 library envelope, Trash/order/sort metadata, transient data, storage origins, import and remote boundaries |
| `updating-uninstalling` | Reference | Source update, full-backup-first cleanup, Trash-aware cleanup, separate browser/Mac/model storage |
| `contributing` | Reference | Node/pnpm/browser route, native requirements, package tests, verification limits |

Every article includes a practical introduction, prerequisites, numbered steps,
an expected-result section, troubleshooting, relevant internal links, and an
edit link to its actual JSON source under
`artifacts/quickque-website/content/guide/` on the
`rossboyd/quickque` `main` branch.

## Known gaps and explicit non-claims

1. There is no verified public release, prebuilt download, installer script,
   or Homebrew package to document yet. The website's installation metadata
   must remain release-aware and fail closed until a release has verified
   assets, checksums, and supported-Mac results. The current configuration
   records the v0.1.0 test release as unavailable while its unsigned Apple
   Silicon DMG and native Mac verification remain outstanding.
2. Native execution has not been verified in the current environment:
   `DESKTOP.md:293-311` lists the outstanding Mac-only checks. This includes
   native compilation/run, microphone authorization, helper packaging, model
   cancellation/offline reload, CoreML/ANE behavior, silence boundary,
   cleanup, accuracy, latency, memory/CPU use, and coexistence with meeting
   software.
3. Native document acceptance remains unverified:
   `DESKTOP.md:313-340` calls out packaged file picker, Finder drop, WKWebView
   worker/CSP, malformed/oversized/password/scanned PDFs, simulated storage
   failure, and native JSON download/restore checks.
4. Physical Phone Remote verification remains **NOT RUN**:
   `REMOTE_OFFLINE_CHECKLIST.md:1-7` requires a Mac and physical phone, and
   `REMOTE_OFFLINE_CHECKLIST.md:14-21` requires the router internet uplink to
   be disconnected before the first scan/page visit. No article claims that
   this has passed.
5. Darwin-specific esbuild and rollup overrides were removed from the current
   workspace configuration. `pnpm-workspace.yaml:77-146` retains Darwin
   optional packages for documented Mac source builds while excluding
   unsupported non-Darwin binaries. The root `package.json:4,7` pins pnpm
   10.26.1; the content does not describe a missing-package problem or add a
   workaround.
6. The current checked-out library includes the merged script-management
   workflow: **New script**, title/section editing, full-content search,
   selection and bulk export/Trash actions, Trash restore/permanent delete,
   duplicate, five sort modes, and custom ordering. The articles do not
   advertise folders, tags, favorites, locking, sharing, or access protection
   beyond those implemented controls.
7. The content audit does not certify release signing, notarization, installer
   distribution, camera behavior, firewall behavior, or native UI behavior.
   Those remain platform and release-owner responsibilities.

## Maintenance rule

When a user-facing label, storage semantic, platform restriction, or native
verification result changes, update the relevant source-backed article and this
audit in the same change. Re-check `DESKTOP.md`, the offline remote checklist,
and the named source files before introducing a new claim. Keep the source
build token and release state centralized rather than duplicating an invented
installer command across articles.