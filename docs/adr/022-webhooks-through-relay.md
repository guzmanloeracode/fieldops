# ADR 022: Outgoing webhooks through Relay, from a trigger-written outbox

**Status:** accepted · 2026-11-11 · implemented in 0.5

**Context.** PLT-03 asks for outgoing webhooks: endpoints subscribe to events, deliveries are signed, retried,
logged and can be redelivered by hand. Relay 1.0 (PRD §11) already does all of that for any client, with Standard
Webhooks signatures, retries for about a day, a dead-letter queue, automatic disabling and a delivery log. ADR 008
planned an `outbox_event` table delivered by Relay. Two questions remained: how events get into the outbox without
every service remembering to write them, and where endpoints and their history live.

**Decision.**

- **Events are written by database triggers** (migration 0005), in the transaction of the change, like the audit
  log (ADR 016). An event exists exactly when its change committed, whichever path made it (web, API, worker,
  portal, a future importer). Triggers write only for organizations with webhooks on
  (`organization.webhooks_enabled_at`) and never for quiet transactions (the seed and the nightly reset). The web
  role can read its organization's outbox but never write it; the trigger functions are `SECURITY DEFINER`.
- **Events are thin.** `data` names the record and its key fields (`job.id`, `number`, `status`, `priority`,
  customer, site, schedule…); a receiver that needs more fetches it from `/api/v1` with an API key. Payloads stay
  small and stable, and nothing private (notes, contacts, money details beyond totals) leaves without an API call
  that the key's role allows.
- **The event set** (§17.3): `job.created`, `job.updated` (with the `changed` fields; status and SLA bookkeeping
  don't count), `job.status_changed` (with `previous_status`), `job.assigned` (one event per job and statement
  with the whole team, because assignments are replaced as a set), `job.completed`, `sla.at_risk` and
  `sla.breached` (from `sla_alert`, raised once per job, clock and kind), `quote.sent`, `quote.approved`,
  `quote.declined`, `invoice.sent` (issued; an overdue invoice going back to sent isn't a new send),
  `invoice.paid`, `expense.decided`. The PRD's `quote.accepted` is `quote.approved`, the status FieldOps uses, and
  `quote.declined` was added.
- **Relay is the source of truth for endpoints, secrets and the log.** FieldOps stores none of them; the settings
  page and `/api/v1/webhook-*` call Relay's management API with one service key that isn't bound to a tenant
  (scopes `ingest`, `read`, `manage`, `admin`). The tenant slug is the organization ID. A FieldOps endpoint is one
  Relay webhook endpoint plus one subscription; the subscription also names `webhook.test`, so "Send test event"
  (an event addressed with `targets.endpoints`) reaches that endpoint whatever it subscribes to, and no other.
  Changes are audited with `audit_event()` as `webhook_endpoint.insert|update|delete`, never with the secret.
- **Signatures are Relay's Standard Webhooks headers** (`webhook-id`, `webhook-timestamp`, `webhook-signature`),
  replacing the planned `FieldOps-Signature: t=…,v1=…`. Receivers can use any Standard Webhooks library, and secret
  rotation signs with both secrets for 24 hours. The body is Relay's envelope (`id`, `type`, `tenant`,
  `created_at`, `data`), so `tenant` carries the organization ID.
- **Redelivery is Relay's dead-letter replay:** only a delivery that ran out of attempts (or whose endpoint was
  turned off or gone), once, to an endpoint that is on, with the same event ID. Pending ones are still being
  retried and delivered ones arrived.
- **Publishing.** The worker claims due rows with `FOR UPDATE SKIP LOCKED` and a 5-minute lease (`sending`),
  posts each one outside any transaction with the row ID as the `Idempotency-Key`, and marks it sent with Relay's
  event ID. A failure backs off 30 s × 2ⁿ, capped at an hour, and the row is `failed` after 12 attempts (about
  six hours). A missing tenant is created and the post retried once. Sent rows are kept 7 days (as long as Relay
  keeps events, so the delivery log can name each event's type from the outbox) and failed ones 30 days.
- **No transaction waits on Relay.** The webhooks service and its API routes (`relayRoute`) open their own short
  transactions around Relay calls, as the AI features do; an `Idempotency-Key` is claimed in one and its response
  stored in another, and released if the request fails.
- **Tests and development** use a fake Relay (`packages/relay`, `startFakeRelay`), which implements the part of
  Relay's API the client uses, in memory. It doesn't call endpoints: deliveries succeed at once, except to URLs
  whose path contains `/fail` (dead after one 500) or `/retry` (waiting after a 503). The image E2E runs it as a
  sidecar (`node dist/index.js fake-relay`).

**Consequences.** Webhooks work for every change without touching the services, and turning them off costs one
indexed lookup per change. FieldOps depends on Relay being up for its webhook settings and log: when Relay can't
be reached, the pages say so and events wait in the outbox. The demo reset gives organizations new IDs, so it
first retires the old tenants (endpoints deleted, tenant disabled). Thin events need an API key for details,
which PLT-02 provides. Events from before webhooks were turned on are never sent.
