# ADR 004: Drizzle ORM with SQL migrations in git

**Status:** accepted · 2026-11-10

**Decision.** Drizzle for typed queries; `drizzle-kit generate` for schema migrations and hand-written SQL
migrations for roles, grants and policies. Migrations are forward-only and run by a one-shot `migrate`
container before the app starts.

**Consequences.** Reviewable SQL in pull requests. Raw SQL fragments that reference outer tables use fully
qualified names (`"job"."id"`) to avoid ambiguous correlation in subqueries.
