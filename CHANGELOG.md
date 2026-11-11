# Changelog

## 0.5.0 — Platform (2026-11-11)

- **API keys** (Settings → API keys, owners and admins): a name, a `read` or `write` scope and an optional expiry
  of 30, 90 or 365 days. The key is shown once, with a copy button and a `curl` example; only its hash is stored. A
  key acts as the member who created it, within that member's current role, and every change it makes shows the key
  in the audit log. Revoking takes effect on the next request. Keys can't create or revoke keys.
- **Rate limits:** 300 requests a minute per API key and 600 per user, with `RateLimit-Limit`,
  `RateLimit-Remaining` and `RateLimit-Reset` on every response and `429` with `Retry-After` past the limit.
- **Webhooks** (Settings → Webhooks): turn them on, add up to 10 https endpoints for all events or a chosen set,
  and receive signed deliveries ([Standard Webhooks](https://www.standardwebhooks.com/) headers) for jobs (created,
  updated, status changed, assigned, completed), SLA risks and breaches, quotes (sent, approved, declined),
  invoices (sent, paid) and expense decisions. Each endpoint has a test event, secret rotation with a 24-hour
  overlap, and a 7-day delivery log with every attempt's response; failed deliveries can be sent again. Events are
  written in the same transaction as the change and delivered by [Relay](https://github.com/guzmanloeracode/relay).
  In the public demo, endpoints point at webhook.site or the demo's own test receiver.
- **MCP server** at `/api/mcp`: the seven read-only _Ask FieldOps_ tools (jobs, SLA risks, workload, customer
  history, approvals and, for owners and admins, revenue) for Claude and other MCP clients, with an API key. Settings
  → API keys shows the setup.
- **API:** `/api-keys`, `/webhook-settings`, `/webhook-endpoints` and `/webhook-deliveries`; the OpenAPI document
  describes API key authentication, the rate-limit headers and every webhook event with a sample body.
- **Audit log:** entries without a person read "System" again.
- **Dispatch board:** picking up a job from the queue with the keyboard starts it at 08:00 on the first lane again;
  it could start over a lane hidden under the queue and land at the wrong time.

## 0.4.1 (2026-11-11)

- **Ask FieldOps:** past conversations open and stay readable while AI is off or out of quota; only asking a new
  question waits until it's back.
- **Maintenance plans:** the next visits show their year (a yearly plan's dates were ambiguous), and a plan that
  hasn't created a job yet no longer says "No jobs yet" next to its next visit.
- **Dashboard:** a change that rounds to 0% or 0 points reads "Same as the previous period" instead of "Down 0%".
- **Layout:** quote and invoice titles keep their width and the actions wrap below them when there are many; filters
  and search boxes fit their Indonesian labels.
- **Demo data:** each open quote's title, service and parts belong together, and quotes made from a job only carry
  parts and fees that fit its service.

## 0.4.0 — Get paid (2026-11-11)

- **Quotes** (`/quotes`): lines for services, labor, parts and fees with a tax rate each, a discount and a validity
  date. A quote is emailed to the customer's contact, revised back to draft while it is sent or expired, and
  duplicated once it is approved or declined. The customer decides in the portal, or staff record their decision;
  an approval creates a New job with the quote's lines in its description, and office roles are notified. Sent quotes expire after their date.
- **Invoices** (`/invoices`): drafted from a completed job with the service (or the approved quote's lines), one
  labor line per technician for recorded work rounded up to the quarter hour, and the approved parts and expenses
  not billed yet, at cost plus markup. Issuing gives the next number of the year with no gaps, the issue and due
  dates, and emails the bill-to contact. Payments recorded by hand (up to the balance) send a receipt and mark the
  invoice paid once they cover it; unpaid invoices turn overdue after their due date, and drafts and invoices
  without payments can be voided with a reason. A part is billed on one invoice only, even when two invoices race
  for it.
- **Online payments:** customers pay an invoice's balance through Stripe Checkout, and a signed webhook records the
  payment once, however often it arrives, then notifies the owners and sends a receipt. Staff can copy a payment
  link to send. Stripe turns on with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; until then the public demo
  uses a simulated checkout clearly labeled as a test, and without either the portal shows the bank transfer
  instructions (ADR 021).
- **Quotes and invoices in the customer portal:** a _Waiting for you_ block on the home page, lists and pages with
  the lines, totals and PDFs, _Approve_ or _Decline_ with a reason (an approval creates the job), and _Pay now_.
  Customers only see what was sent to them; staff see when they first opened it.
- **Overdue reminders** 3, 7 and 14 days after the due date, each sent once per invoice, with the payment
  instructions.
- **Catalog and billing settings:** parts and fees with SKUs, prices and costs (`/settings/catalog`); payment terms,
  quote validity, the labor rate, number prefixes, reminders and payment instructions (`/settings/billing`). Service
  types gained a tax rate.
- **Exact totals:** amounts are computed with BigInt in minor units, the discount is spread over the lines so it
  adds up exactly, and tax is rounded once per line (ADR 017).
- **Revenue on the dashboard** for owners and admins: invoiced, collected, receivables and overdue against the
  previous period, a trend chart, and CSV downloads. The job page and the customer page list their quotes and
  invoices.
- **Branded PDFs** for quotes, invoices and service reports: the organization's letterhead and brand color, labels
  in English or Bahasa Indonesia, repeated table headers, page numbers, and PAID or VOID stamps (ADR 018).
- **Service reports:** completing a job creates a draft report from the checklist, readings, notes for the customer
  and parts used. With AI on, Claude drafts it for the customer in their language (in the background, or with
  _Draft with AI_); someone reviews it and sends it. The customer gets a _Job completed_ email with a link to the
  PDF, valid for 30 days without signing in, and can download it from the portal. Internal notes never reach the
  model, and a draft never overwrites someone's edits.
- **Ask FieldOps** (⌘J / Ctrl+J): ask about jobs, SLA risks, technician capacity, customers, pending approvals and,
  for owners and admins, revenue. Answers stream in with the lookups shown and every job linked. Seven read-only
  tools run with the user's own organization and role (technicians only reach their jobs), at most 8 per question
  and 50 rows each, and record contents are passed as data so they can't steer the answer (ADR 019).
  Conversations are private and kept 30 days.
- **Maintenance plans:** a recurring visit on a customer's site, every N days, weeks, months or years, creates its
  jobs a set number of days ahead, unassigned, with the checklist and SLA deadlines from the visit date. Month ends
  don't drift, and pausing or changing a plan never creates a backlog.
- **SLA pause:** on hold waiting for the customer stops the resolution clock; the deadline moves by the time paused,
  in business hours where the policy counts them. Badges show _Paused_.
- **Daily digest:** at 07:00 local time, owners (and admins who opt in) get yesterday's jobs, SLA compliance,
  first-visit completion and revenue, the most overdue jobs and pending approvals by email.
- **Notifications:** a customer's decision on a quote (office roles) and a payment received (owners).
- **Bahasa Indonesia:** the app, the customer portal, emails and PDFs in English or Indonesian (ADR 020). Members
  pick their language in the user menu; demo visitors' choice stays in their browser. The portal follows the
  visitor's choice, else the customer's language, else the business's; signed-out pages follow the browser, and a
  new account starts in the language it signed up in. Organizations set a customer language, and each customer can
  have their own. Emails go out in the recipient's language, Indonesian dates are day-first with 24-hour times
  (14.30), and _Ask FieldOps_ answers in the language of the question. The REST API and CSV exports stay in
  English.
- **API:** quotes, invoices, payments and payment links, the catalog, service reports with their PDFs, maintenance plans and the
  assistant (server-sent events over POST) with its conversations, all in the OpenAPI document. Jobs gained
  `sla_paused_at`, `recurrence_id` and `occurrence_date`; service types gained `tax_rate_bps`; customers gained
  `locale`.
- **Demo seed:** a catalog per company, quotes in every state, invoices with full, partial and missing payments and
  their reminders, service reports (many AI-drafted, Indonesian at Acme Teknik), maintenance plans with their
  generated jobs, jobs paused for the customer, yesterday's digest and a few past assistant conversations. The
  demo portal customers each have a sent quote and an unpaid invoice. Acme Teknik's people and customers use
  Bahasa Indonesia, except one technician who uses English.
- Fixes: `POST /jobs` no longer accepts the sources `quote` and `recurring`; only an approved quote or a
  maintenance plan creates those jobs.

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
