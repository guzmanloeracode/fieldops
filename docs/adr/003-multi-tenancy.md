# ADR 003: Shared-database multi-tenancy with row-level security

**Status:** accepted · 2026-11-10

**Context.** Organizations must never see each other's data, and a single missing `where` clause shouldn't be
enough to leak it.

**Decision.**

1. Every tenant table has `organization_id`, and every index on it starts with that column.
2. Repositories in `packages/db` are created per organization and add the filter to every query.
3. PostgreSQL row-level security on every tenant table: `organization_id = app_current_org()`, where the setting
   `app.org_id` is set with `set_config(..., true)` at the start of each request transaction (`withTenant`).
4. The web app connects as `fieldops_app` (no `BYPASSRLS`, not the table owner). Migrations, the seed and the
   worker use the owner role.
5. A test fails CI if any table with `organization_id` is missing from `TENANT_TABLES` or lacks the policy.

**Consequences.** Every request runs in a transaction. Cross-tenant jobs (nightly reset, SLA monitor) must use the
worker's owner connection deliberately. Better Auth tables (`user`, `session`, `member`, `invitation`) are not
under RLS because authentication needs cross-tenant lookups; access to them is explicit in code.
