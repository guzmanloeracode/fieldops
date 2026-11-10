# Changelog

## 0.2.0 — Dispatch (2026-11-10)

- **Dispatch board** (`/schedule`): day and week views with one lane per technician, an unscheduled queue, and
  drag and drop to schedule, move, reassign or resize. Every drag has a keyboard equivalent, and moves are
  announced to screen readers. A map tab shows the day's visits by status.
- **Conflict checks:** overlapping visits, outside working hours, time off and missing skills. A dispatcher can
  override any of them with a reason, which is kept in the timeline. In the API's 409 problem, `conflicts[]` changed
  from `{member_id, jobs}` to `{kind, member_id, member_name, message, job_numbers?, missing_skills?}`.
- **Team availability** (`/schedule/team`): working hours per weekday, skills and time off per member.
- **Several technicians per job**, with a lead.
- **Technician workspace:** _My day_ highlights the next visit with one-tap actions, a sticky action bar on
  phones, camera capture, checklists from service-type templates (checkbox, number with unit, text, photo),
  travel and work time recorded from status changes and editable with a reason, and a drawn or typed customer
  signature. Organizations can require a signature before completion.
- **Parts and expenses:** requests with a receipt photo, auto-approval below a threshold, dispatcher approval
  below a second threshold, owner/admin approval above it, rejections with a comment, an approvals inbox with
  bulk decisions, and parts recorded as used.
- **Dashboard:** six KPIs against the previous period (created, completed, SLA compliance, response and
  resolution time, first-visit completion), four charts with data tables and drill-down into the jobs list, and a
  _Today_ tab for dispatchers. SLA figures use provisional per-priority targets until SLA policies ship in 0.3.
- **Jobs list:** saved views (personal or shared), bulk assign and status changes, CSV export, and filters for
  unassigned work, revisits and the date field.
- **Command palette** (⌘K / Ctrl+K) for jobs, customers, sites and pages.
- **Equipment:** add, edit and remove units per site, with warranty status and service history.
- **Several organizations per user**, with a switcher in the user menu.
- **Operations settings:** approval thresholds and the signature requirement.
- **API:** schedule, agenda, checklist, time entries, signature, expenses and equipment endpoints, all in the
  OpenAPI document.
- **Demo seed:** working hours, skills and time off, checklists and time entries, expense requests, shared saved
  views, and about 5% of past jobs that needed a second visit.
- **Uploads without R2:** files are stored on a Docker volume behind signed URLs until object storage is enabled
  (ADR 015).
- Fixes: the note form no longer wipes text typed while a note is saving; editing a service type no longer clears
  its checklist template; `/api/v1/openapi.json` renders again after the new response schemas; the site and board
  maps draw their tiles again in the Docker image (an empty build argument hid the default map style); the SLA
  trend chart's 100% label is no longer cut off.

## 0.1.0 — Core (2026-11-10)

- Accounts: email and password sign-up with verification, password reset, organizations, invitations,
  roles (Owner, Admin, Dispatcher, Technician) and one-click demo sign-in.
- Customers with contacts, sites and duplicate warnings; equipment records.
- Jobs: numbering, status lifecycle with reasons and preconditions, assignment and scheduling with overlap
  checks, notes, photo and document attachments, timeline; server-side filtered, sorted and paginated list.
- Settings: organization profile, members and invitations, service types.
- REST API `/api/v1` with OpenAPI 3.1, Scalar reference, cursor pagination, Idempotency-Key and If-Match.
- PostgreSQL row-level security, deterministic demo seed, nightly reset, email outbox and Docker deployment.
