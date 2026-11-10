# ADR 007: pg-boss for background jobs

**Status:** accepted · 2026-11-10

**Decision.** Scheduled and queued work (nightly demo reset, maintenance, later the SLA monitor and outbox
delivery) runs on pg-boss in the worker container, stored in PostgreSQL's `pgboss` schema.

**Consequences.** No extra queue service to run. Jobs can be enqueued in the same transaction as the change that
causes them.
