# Changelog

## 0.1.0 — Core (unreleased)

- Accounts: email and password sign-up with verification, password reset, organizations, invitations,
  roles (Owner, Admin, Dispatcher, Technician) and one-click demo sign-in.
- Customers with contacts, sites and duplicate warnings; equipment records.
- Jobs: numbering, status lifecycle with reasons and preconditions, assignment and scheduling with overlap
  checks, notes, photo and document attachments, timeline; server-side filtered, sorted and paginated list.
- Settings: organization profile, members and invitations, service types.
- REST API `/api/v1` with OpenAPI 3.1, Scalar reference, cursor pagination, Idempotency-Key and If-Match.
- PostgreSQL row-level security, deterministic demo seed, nightly reset, email outbox and Docker deployment.
