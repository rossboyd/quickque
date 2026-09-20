# Quickque local document extraction

Quickque sends the selected bytes to a disposable module worker. Extraction
does not make network requests, parse document markup as HTML, execute
document scripts, render a document, or resolve URLs embedded in a document.
The parent terminates this worker after `IMPORT_LIMITS.timeoutMs`.

## Parsers and licenses

- TXT uses the browser `TextDecoder` API (no third-party parser).
- RTF uses the small text-only reader in `rtf.ts`. It supports Unicode
  escapes, Windows single-byte code pages (including explicit Windows-1252
  smart-quote/euro mappings), paragraphs, tabs, line breaks, and ordinary
  text. Unsupported code pages fail explicitly. Picture, object, font,
  metadata, field-instruction, and HTML destinations are skipped.
- DOCX uses `fflate` 0.8.2 (`MIT`) for streaming ZIP expansion. The
  WordprocessingML subset is read with `saxes` 6.0.0 (`ISC`) in namespace-aware
  strict mode; it is never passed to a DOM or HTML parser. DTDs, malformed
  XML, encrypted ZIPs, and excessive nesting fail explicitly.
  `word/document.xml` paragraphs and runs are supported.
- PDF uses `pdfjs-dist` 4.10.38 (`Apache-2.0`) from its locally packaged
  `legacy/build` modules. The PDF.js `WorkerMessageHandler` is installed in
  the extraction worker so PDF.js uses its in-process fake worker. Standard
  fonts and CMaps are embedded in the worker from the installed package, and
  read by fixed-name factories without network access. No nested worker,
  blob URL, CDN asset, or remote font is needed.

Both builds emit `document-import-licenses.txt`, containing parser notices and
the CMap, Foxit and Liberation font licenses. Source notices are in
`THIRD_PARTY_NOTICES.txt`. These remain packaged with the app.

## Resource and format boundaries

- Input is at most 10 MiB.
- Streaming DOCX ZIP output (including members that are not parsed) is limited
  to 32 MiB. Compressed input is fed in 1 KiB chunks, bounding the transient
  decoder overshoot before each output check; output beyond the limit is never
  retained or passed to XML parsing. ZIP metadata alone is not trusted.
- PDF decoder buffer growth is guarded **before allocation** by a narrow,
  checked transformation in `scripts/pdf-budget.mjs`. Positive buffer growth
  across all decoded streams has a conservative aggregate 32 MiB budget;
  repeated/rounded allocations can reject a document smaller than that limit.
  Stream length and predictor arithmetic are also checked. Raster decoders
  are replaced with non-decoding streams: images are never rendered.
  PDF.js may catch decoder errors internally, so a sticky failure flag is
  checked before any result can be accepted. There is no regex preflight or
  rewritten PDF/xref data. PDF files are limited to 500 pages.
- The exact PDF.js version and expected source hooks are pinned. Vite (web,
  desktop and worker builds) and Node tests apply the same guards. A changed
  upstream hook fails the build, and extraction fails if guards are absent.
  Review this adaptation and upstream security advisories before upgrading;
  do not replace it with an unguarded worker or CDN URL.
- PDF.js's legacy build is selected for the Mac system-webview path. Native
  macOS 26 compatibility still needs the hardware checks in `DESKTOP.md`.
- Returned text is at most 500,000 UTF-16 code units. Over-limit text is an
  actionable error, not a truncated result.
- PDF text order and line breaks depend on the source's text operators.
  Columns, positioned words, images, scanned pages, rich formatting, and
  layout fidelity are deliberately not retained. Image-only PDFs ask the user
  to copy text or use OCR elsewhere.

The real browser-smoke fixtures are kept beside the parser:

- `fixtures/tiny-unicode.docx`
- `fixtures/tiny-text.pdf`
- `fixtures/tiny-compressed.pdf`
- `fixtures/scanned-image-only.pdf` (negative extraction case)

Unicode, paragraph, and literal-markup fixtures for parser tests are
`fixtures/unicode.txt` and `fixtures/unicode.rtf`.