# ADR 002: One Next.js full-stack app, no separate API server

**Status:** accepted · 2026-11-10

**Decision.** Server actions handle web mutations; route handlers serve `/api/v1`. Both call the same services in
`packages/core`, so the UI, the mobile app and integrations follow the same rules.

**Consequences.** One deployable for UI and API. The API stays independent of React: handlers only parse input,
call a service and serialize the result.
