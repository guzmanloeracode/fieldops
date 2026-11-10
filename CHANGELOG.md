# Changelog

## 0.3.1 — Sidebar and demo requests (2026-11-10)

- **Collapsible sidebar:** on desktop, the sidebar collapses to an icon rail and expands again with its button or
  Ctrl/⌘ B. Collapsed links keep their names for screen readers and show tooltips; the pending-approvals count
  becomes a dot that is still announced. The choice is kept in a cookie, so the page renders that way from the
  server.
- **Demo data:** every job's description now matches its title and service type (they used to come from one shared
  list). Portal requests waiting for review have no service type, estimate or checklist yet, like real ones; their
  AI drafts suggest the service type and estimate, with checks and questions for that kind of job, and raise the
  priority only for faults. The demo customer's request has an AI title and summary.
- **AI review:** the current checklist shows its size, or a dash when there is none, instead of a fixed label.
- E2E: the sidebar is tested collapsed and expanded, with axe, a reload and the keyboard shortcut.

## 0.3.0 — Automate (2026-11-10)

- **SLA policies** (`/settings/sla`): response and resolution targets per priority, in calendar time or business
  hours. Every job stores its deadlines and the moment each one turns "at risk" (75% of the window used); states
  are on track, at risk, breached and met. A monitor runs every 5 minutes and raises each alert once per job and
  target. Badges on the job page, the jobs list and the board, and a jobs filter by SLA state.
- **Dashboard:** SLA compliance and the at-risk lists now use the stored deadlines (the provisional targets are
  gone), with response compliance added; every report and list downloads as CSV.
- **Notifications:** a bell with an unread badge, a notification page, deep links and mark as read; emails from
  one template through the outbox; per-user settings per event and channel. Events: job assigned or
  rescheduled, new portal request, SLA at risk or breached, part or expense requested and decided.
- **Live updates:** the dispatch board, the _Today_ view and the bell update within seconds of another user's
  change, through server-sent events fed by PostgreSQL `LISTEN/NOTIFY` (ADR 011).
- **Customer portal** (`/portal/{org}`): customers sign in with a one-time email link, request service with
  photos and preferred times, and follow their jobs: status, visit window and the technician's first name.
  The demo has a one-click demo customer per organization.
- **AI smart intake:** "Draft with AI" on the new job form turns a message and up to 3 photos into a draft job
  (service type, priority with a reason, checklist suggestions, duration, contact details and questions to ask),
  with low-confidence fields highlighted. Portal requests get a draft in the background and wait for a
  dispatcher to review them. Claude (`claude-opus-5-5`) with schema-constrained output; AI settings with an
  on/off switch and a monthly quota; rate limits with `RateLimit-*` headers; usage logged per call. Without an
  API key, AI shows as not configured and every manual flow still works.
- **Audit log** (`/settings/audit`): every change to business records, roles, approvals and settings, plus staff
  sign-ins, with the actor, before and after values, IP address and user agent, written by database triggers in
  the same transaction and read-only for the app (ADR 016). Filters and CSV export. The public demo doesn't record
  IP addresses, because its visitors share the demo accounts.
- **Sign in with Google**, shown when an OAuth client is configured.
- **Demo tour:** a "Try these 5 things" card per demo role.
- **API:** SLA policies, notifications and their settings, the event stream, AI intake and the portal-request
  review, all in the OpenAPI document. Job representations gained `ai_status`, the SLA deadlines and states.
- Fixes: the canceled status badge meets the contrast ratio; the landing page wording.

## 0.2.1 — Loading states (2026-11-10)

- **Skeletons while pages load:** every page that loads data shows a skeleton shaped like the page (lists,
  details, forms, the dashboard, the dispatch board, team availability, settings, the demo inbox and invitations),
  so content replaces it without the layout jumping. Screen readers hear one "Loading…" status; the shapes are
  hidden from them and don't animate when reduced motion is on.
- Filter, search and date changes within a page keep the current page on screen instead of flashing the skeleton,
  so the search box keeps its focus and text.
- Pages that must answer 404 (another organization's records, pages a role can't use) still return a real 404
  status: their checks run in the segment layout, before the skeleton streams.
- E2E: a test holds a navigation, checks the skeleton with axe and then the page that replaces it; the isolation
  test now covers equipment, and a new test checks the 404 status of the pages a technician can't use.

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
  maps draw tiles again (MapLibre's worker is served from the app, and an empty build argument no longer hides
  the default map style); the SLA trend chart's 100% label is no longer cut off.

## 0.1.0 — Core (2026-11-10)

- Accounts: email and password sign-up with verification, password reset, organizations, invitations,
  roles (Owner, Admin, Dispatcher, Technician) and one-click demo sign-in.
- Customers with contacts, sites and duplicate warnings; equipment records.
- Jobs: numbering, status lifecycle with reasons and preconditions, assignment and scheduling with overlap
  checks, notes, photo and document attachments, timeline; server-side filtered, sorted and paginated list.
- Settings: organization profile, members and invitations, service types.
- REST API `/api/v1` with OpenAPI 3.1, Scalar reference, cursor pagination, Idempotency-Key and If-Match.
- PostgreSQL row-level security, deterministic demo seed, nightly reset, email outbox and Docker deployment.
