# ADR 013: Services in `packages/core` depend on repository interfaces

**Status:** accepted · 2026-11-10

**Decision.** Use cases (create job, transition, assign, customers, members) live in `packages/core/services` and
receive a `Store` interface: repositories bound to one organization and one transaction. `packages/db`
implements it with Drizzle; tests use an in-memory store.

**Consequences.** Business rules are unit-tested without a database (100% line coverage) and integration-tested
against PostgreSQL through the real store. Adding a repository method means updating the interface, the Drizzle
implementation and the in-memory store.
