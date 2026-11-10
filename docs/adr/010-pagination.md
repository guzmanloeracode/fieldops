# ADR 010: Offset pagination in the UI, cursor pagination in the API

**Status:** accepted · 2026-11-10

**Decision.** Tables in the app use page numbers with a total count, because people expect them. The API uses
opaque keyset cursors that encode the sort expression and the last row's values, with the id as tie-breaker,
supporting multiple sort fields in mixed directions and nullable columns.

**Consequences.** Stable API pages under concurrent inserts. The cursor is only valid for the sort it was made for.
