# ADR 015: Local file storage behind the same presigned-URL interface until R2 is enabled

**Status:** accepted · 2026-11-10

**Context.** Photos, receipts and signatures (JOB-06, JOB-10, EXP-01, TEC-03) are uploaded straight from the
browser to object storage with presigned URLs (PRD §14). Cloudflare R2 isn't enabled on the hosting account yet,
so in 0.1 uploads were hidden. Release 0.2 makes photos, receipts and signatures part of the technician's main
flow, so they have to work without R2.

**Decision.** `FileStorage` (packages/core) keeps its four operations: `presignPut`, `presignGet`, `exists`,
`remove`. The web app picks the backend at start-up:

- **R2** when the `S3_*` variables are set: unchanged from 0.1.
- **Local disk** otherwise: files live in `FILES_DIR` (`/data/files`, a Docker volume shared with the worker).
  `presignPut` and `presignGet` return URLs to `/api/files/<key>` carrying an expiry and an HMAC-SHA256 signature
  over the method, the key, the content type and the declared size. The route accepts a PUT only with a valid,
  unexpired signature, an allowed content type and a body no larger than declared (streamed to a temporary file
  and moved into place), and serves GETs with `nosniff` and a sandboxing CSP. Keys are validated against the
  pattern the services generate, so a key can't escape the directory.

The signature is the permission, exactly as with R2: only the server issues one, after the service has checked
the actor's access to the job. The nightly demo reset empties the directory, as it empties the bucket.

**Consequences.** The demo works end to end on one server, and switching to R2 is configuration only. Files pass
through the web container (10 MB cap; nginx allows 12 MB), which is acceptable at demo scale but is the reason R2
stays the production target. Local files aren't backed up; the demo is disposable by design (RUNBOOK).
