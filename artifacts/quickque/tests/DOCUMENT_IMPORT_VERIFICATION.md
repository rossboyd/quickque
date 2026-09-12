# Document import verification

## Automated checks

- `pnpm --filter @workspace/quickque test:document-import` — 31 tests pass:
  all formats, Unicode/paragraphs, malformed and encrypted inputs, empty/output
  limits, actual ZIP/PDF expansion limits, PDF escaped/nested filters, inert
  markup/actions, cancellation/deadline cleanup, storage migration and atomic
  failure behavior.
- `pnpm --filter @workspace/quickque test:flow` — 19 existing tests pass.
- `pnpm run typecheck` — complete workspace passes.
- Browser Vite build and `vite build --config vite.desktop.config.ts` pass.
  Both package the guarded worker, fonts/CMaps, and parser license notices.
  Existing tooltip sourcemap warnings are non-blocking.

`document-import-smoke.mjs` exports a reusable `documentImportSmoke(page,
baseURL)` routine for a Playwright harness. Run it against an isolated browser
context; it imports only into that context's local storage. It requires no
server data or sign-in. Browser checks below were performed with Replit's
browser tester; this saved routine itself was not separately executed.

## Browser checks performed (2026-09-12)

After fixing first-use Vite dependency reload and PDF.js's browser-worker
auto-bootstrap protocol collision:

- DOCX review shows title, Unicode paragraphs, and formatting warning.
- Review cancellation leaves stored library bytes unchanged.
- Import selects a new script; title/text edits, whitespace, blank lines,
  and literal markup persist through Present, Escape, and reload.
- Repeated filename produces a new ID without overwriting the earlier import.
- RTF and compressed PDF reach editable review; image-only PDF reports OCR
  guidance.
- Actual dialog-portal file drop, extraction cancellation, and reopening leave
  no queued file or restarted import.
- Simulated `Storage.prototype.setItem` failure preserves stored library and
  selection plus edited review. Restoring storage and retrying succeeds.
- JSON backup downloads and parses as an array; Restore JSON remains a distinct
  Settings control. Actual JSON restoration was not re-exercised.
- Literal script markup remains inert in both editor and presentation.

A stale storage-error banner after a successful retry was subsequently fixed
by clearing only that storage-write error on successful commit. This small
state update was typechecked rather than repeating the browser journey.

Raw browser network interception, touch-viewport testing, and actual JSON
restore were not performed in this pass. The parser tests deny `fetch` while
extracting a PDF with JavaScript/external actions; code review confirmed fixed
local resource maps and no document upload or URL-resolution path.

## Mac checks are separate and unavailable here

Linux browser and frontend-build results do **not** verify WKWebView. The
packaged Apple Silicon app's file picker, Finder drag/drop, module-worker/CSP
execution, offline imports, app relaunch, and JSON downloads remain unverified.
Follow the dedicated checklist in `../DESKTOP.md` on supported Mac hardware.