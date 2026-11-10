# ADR 016: Audit log written by database triggers, read-only for the app

**Status:** accepted · 2026-11-10

**Context.** AUD-01 asks for an append-only log of business record changes, role changes, approvals, settings
and sign-ins, with the actor, before and after values, IP address and user agent. AUD-02 asks for each entry to
be written in the same transaction as the change. Writing entries from every service call site is easy to forget
when a new write path appears, and an entry written by application code can also be forged or edited by it.

**Decision.**

- An `AFTER INSERT OR UPDATE OR DELETE` row trigger, `audit_row()`, runs on the business tables: organization,
  member, invitation, service type, SLA policy, customer, contact, site, equipment, job, job assignment,
  checklist item, note, attachment, time off, time entry and expense request. It writes the whole row for
  inserts and deletes, and only the changed columns (before and after) for updates. Bookkeeping columns
  (`updated_at`, `version`) and columns the SLA monitor and AI worker keep current are left out, so an update
  that only touches those writes nothing. A soft delete (`deleted_at` set) is logged as a delete.
- The actor, IP address and user agent come from transaction-local settings (`app.user_id`, `app.ip`,
  `app.ua`) that `withTenant()` sets next to `app.org_id` for every request. Changes made with no actor (the
  worker, Better Auth's own writes) are logged as system changes.
- Events that aren't a row change, such as sign-ins, go through `audit_event()`, which takes the same settings.
- Both functions are `SECURITY DEFINER`. The runtime role `fieldops_app` has `SELECT` on `audit_log`, scoped by
  the usual row-level security policy, and no `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE`.
- Bulk writes that aren't user actions (the demo seed, the nightly reset, data migrations) call `quiet()`, which
  sets `app.quiet` for their transaction and turns the trigger off.

**Consequences.** Every write path is covered, including future ones and direct SQL, and the entry commits or
rolls back with the change. The application can't forge, edit or delete entries. Actions are named after tables
(`job.update`, `member.update`), so the viewer turns them into plain words and shows the changed fields. Each
audited write costs one extra insert; at the demo's volume that is negligible. A new business table needs its
own `CREATE TRIGGER audit` line in its migration.
