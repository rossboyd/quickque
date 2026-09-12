---
name: PDF extraction failures
description: Non-obvious PDF.js failure and resource-budget behavior to preserve when changing document import.
---

Treat a resolved PDF.js text-extraction promise as insufficient proof that the
document was read successfully. Resource-limit failures need a separate,
sticky failure state checked before accepting text.

**Why:** PDF.js catches some decoder exceptions internally and can continue with
partial text. A timeout alone also cannot prevent a large synchronous
decompression allocation. Metadata/regex preflight is not a substitute: PDF
filter names can be escaped and filter parameters can be nested.

**How to apply:** When changing PDF parsing or its worker packaging, preserve
pre-allocation decoder limits and verify that limit violations reject the
entire import, including documents with valid text before a bad stream.
Exercise the same guarded parser in tests and shipped builds. Preserve parser
ownership of stream teardown; independently cancelling an already-failed
PDF.js stream can race its asynchronous error reply.

The distributed PDF.js worker also auto-starts its own message protocol when
imported inside a real browser Worker, even if only its exported handler is
wanted. Node tests do not exercise that branch. When embedding the handler in
another worker, disable auto-bootstrap and check the actual browser messaging
path separately.