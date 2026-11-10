# ADR 008: Transactional outbox for integration events and email

**Status:** accepted · 2026-11-10

**Decision.** Side effects leave the system through outbox tables written in the same transaction as the change.
Release 0.1 uses this for email (`email_outbox`); the worker claims rows with `FOR UPDATE SKIP LOCKED` and retries
with backoff. Integration events (`outbox_event`) follow the same pattern from release 0.5, delivered by Relay.

**Consequences.** No lost or phantom emails when a request fails halfway. In the public demo the worker never sends:
rows are stored as `captured` and shown in the Demo inbox and Demo outbox.
