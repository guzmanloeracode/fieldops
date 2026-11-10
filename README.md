# FieldOps

**Field service management for small service businesses.** Requests come in, a dispatcher schedules a technician,
the technician does the work on site, and the business sees every job from request to completion.

[**Live demo**](https://fieldops.tinggalpake.com) · [API reference](https://fieldops.tinggalpake.com/docs/api) ·
[Product requirements](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md)

![Dispatch board](docs/screenshots/schedule.png)

> FieldOps is open source. Every person, company and address in the demo is fictional, and the demo resets every
> day at 00:00 UTC.

## Try it

Open the [live demo](https://fieldops.tinggalpake.com) and sign in with one click as:

| Role                 | What to try                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Owner** (Olivia)   | The KPI dashboard and its CSV exports, SLA policies, the audit log, approving a large part request, switching company |
| **Dispatcher** (Dan) | The board (open it in two windows: changes appear live), a portal request waiting for review, the bell                |
| **Technician** (Tom) | _My day_ on a phone-sized screen: En route → Start, the checklist, a part request, the signature, the bell            |
| **Customer** (Jamie) | The [customer portal](https://fieldops.tinggalpake.com/portal/acme-air): request service with photos, track the job   |

A second fictional company, _Acme Teknik Nusantara_ (Jakarta, IDR), shows that tenants never see each other's data.

## What's in release 0.3

![A customer requests service in the portal; the dispatcher, on the board, gets a live notification, confirms the request and schedules it, and the customer sees the visit](docs/screenshots/release-0.3.gif)

- **SLA engine:** response and resolution targets per priority, in calendar time or business hours. Every job
  carries its deadlines; a monitor raises at-risk and breached alerts once, and badges show them everywhere.
- **Notifications and live updates:** a bell with in-app notifications, emails and per-user settings; the board,
  the _Today_ view and the bell update within seconds of someone else's change.
- **Customer portal:** customers sign in with an email link, request service with photos and preferred times,
  and follow their jobs.
- **AI smart intake:** paste a customer's message (English or Bahasa Indonesia), add photos, get a draft job with
  low-confidence fields highlighted. Portal requests are drafted in the background for a dispatcher to review.
  On the public demo, live AI drafting is switched on once an API key is configured; the seeded portal requests
  already carry drafts.
- **Audit log:** every change with who, when, before and after, written by the database itself.
- **Also:** CSV export of every dashboard report, sign in with Google, a "Try these 5 things" card for demo
  visitors.

| Customer portal                                 | Notifications                                        |
| ----------------------------------------------- | ---------------------------------------------------- |
| ![Customer portal](docs/screenshots/portal.png) | ![Notifications](docs/screenshots/notifications.png) |
| **Audit log**                                   | **SLA policies**                                     |
| ![Audit log](docs/screenshots/audit-log.png)    | ![SLA policies](docs/screenshots/sla-policies.png)   |

Release 0.2 added the dispatch board with conflict checks, the technician workspace, parts approvals and the KPI
dashboard; release 0.1 laid the base: accounts and roles, customers and sites, the job lifecycle, the REST API with
OpenAPI 3.1, and the deterministic demo. The full list is in the [changelog](CHANGELOG.md).

The [roadmap](#roadmap) adds quotes, invoices and payments, the AI assistant, a Go event-delivery service, a
marketing site and a mobile app.

## Engineering highlights

- **Tenant isolation in two layers.** Repositories scope every query by `organization_id`, and PostgreSQL
  row-level security enforces it again for the runtime role. A test fails the release gate if any table with an
  `organization_id` column lacks a policy. ([ADR 003](docs/adr/003-multi-tenancy.md))
- **One contract.** Zod schemas in `packages/shared` validate forms, server actions and API requests, type the
  code, and generate the OpenAPI document.
- **Framework-free domain.** Permissions, the job lifecycle, money and numbering live in `packages/core` as plain
  TypeScript behind repository interfaces: 490 unit tests, 100% line coverage.
- **Real database tests.** 159 integration tests run against PostgreSQL 18 in Testcontainers: RLS, keyset
  pagination over 12 sort orders, concurrent numbering, the audit and live-event triggers, the SLA monitor and
  the seed itself.
- **An audit log the app can't forge.** Database triggers write every change in the same transaction, with the
  actor, IP address and user agent; the app's database role can read the log but not write, edit or delete it.
  ([ADR 016](docs/adr/016-audit-log-triggers.md))
- **Live updates without another service.** PostgreSQL `LISTEN/NOTIFY` feeds server-sent events; a change is
  announced only when its transaction commits. ([ADR 011](docs/adr/011-sse.md))
- **AI drafts, people decide.** Claude's output is constrained to a JSON schema and validated again on the server;
  it can't invent ids, no database transaction waits on the model, every call is logged with its tokens, and
  per-user, per-visitor and global rate limits answer with standard `RateLimit-*` headers. Without an API key
  every flow still works by hand.
- **Accessible drag and drop.** Every board action has a keyboard path and a screen-reader announcement, and
  every chart has a data table. Playwright runs axe (WCAG 2.2 AA) on every page against the production images.
- **Measured dashboard.** `pnpm --filter @fieldops/db bench:dashboard` runs the KPI queries as the RLS role on the
  demo data; p95 stays under 80 ms against a budget of 800 ms.
- **Self-hosted.** Docker Compose behind nginx and Cloudflare on a shared Linux server, with memory limits,
  migrations as a one-shot container, health checks and automatic rollback.

## Architecture

```mermaid
flowchart LR
    B[Browser] --> CF[Cloudflare] --> NX[nginx] --> WEB
    subgraph Docker Compose
      WEB[web · Next.js<br/>pages, server actions, /api/v1]
      WK[worker · Node<br/>SLA monitor, AI drafts, email outbox,<br/>nightly reset, maintenance]
      MG[migrate · one-shot]
      PG[(PostgreSQL 18<br/>RLS)]
    end
    WEB -->|fieldops_app role| PG
    WK -->|owner role| PG
    MG --> PG
    PG -. LISTEN/NOTIFY .-> WEB
    WEB -. signed URLs .-> FS[(files volume<br/>or Cloudflare R2)]
    WEB --> AI[Claude API]
    WK --> AI
```

```
UI (React Server Components and client components)
  → server actions and /api/v1 route handlers: session, validation, mapping
    → services in packages/core: business rules, authorization, transactions
      → tenant-scoped repositories in packages/db (Drizzle)
        → PostgreSQL with row-level security
```

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the [ADRs](docs/adr).

## Stack

TypeScript (strict) · Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · shadcn/ui (Radix) · TanStack Table ·
Better Auth · PostgreSQL 18 · Drizzle ORM · Zod 4 · zod-openapi + Scalar · pg-boss · Claude API (Anthropic SDK) ·
server-sent events · MapLibre GL · React Email · Vitest · Testcontainers · Playwright + axe-core · pnpm + Turborepo
· Docker Compose

## Run it locally

Requirements: Node 22+, pnpm 10 (`corepack enable`), Docker.

```bash
pnpm install
docker compose -f infra/compose/compose.dev.yml up -d
cp .env.example apps/web/.env.local
MIGRATION_DATABASE_URL=postgres://fieldops:fieldops@127.0.0.1:5432/fieldops APP_DB_PASSWORD=app-dev pnpm db:migrate
MIGRATION_DATABASE_URL=postgres://fieldops:fieldops@127.0.0.1:5432/fieldops DEMO_PASSWORD=demo-dev-password pnpm db:seed
pnpm --filter @fieldops/web dev
```

Open http://localhost:3000 and use the demo buttons. Emails go to Mailpit at http://localhost:8025 when
`DEMO_MODE` is off. AI drafting needs `ANTHROPIC_API_KEY`, or `AI_PROVIDER=fixture` for the offline test double.

## Tests

```bash
pnpm verify          # format, lint, typecheck, unit tests (coverage) and PostgreSQL integration tests (Docker)
pnpm e2e:image       # Playwright journeys + axe on the production images, with a throwaway database
pnpm security        # gitleaks over the full git history and a production dependency audit
pnpm eval:intake     # AI intake evaluation set (40 messages; needs ANTHROPIC_API_KEY, costs money)
```

There is no hosted CI. The same checks are the release pipeline: `infra/deploy/release.sh` runs `pnpm verify`,
builds the images, runs the E2E suite against them, and only then deploys, with an automatic rollback if the health
check fails.

## Project layout

```
apps/web        Next.js app: UI, server actions, /api/v1, API docs
apps/worker     Email outbox, nightly demo reset, maintenance, migrations
packages/core   Domain rules and services (no framework dependencies)
packages/db     Drizzle schema, migrations, RLS policies, repositories, seed
packages/shared Zod schemas and types shared by web, worker, API and mobile
packages/email  React Email templates
packages/ai     AI intake model, prompt and evaluation set
infra/          Dockerfiles, Compose files, nginx site config, release script
docs/           PRD, architecture, runbook, ADRs
```

## Roadmap

| Release      | Theme                                                                      | Status  |
| ------------ | -------------------------------------------------------------------------- | ------- |
| 0.1 Core     | Accounts, customers, jobs, REST API, demo                                  | ✅ live |
| 0.2 Dispatch | Drag-and-drop board, technician day view, checklists, approvals, dashboard | ✅ live |
| 0.3 Automate | SLA engine, notifications, audit log, customer portal, AI job intake       | ✅ live |
| 0.4 Get paid | Quotes, invoices, Stripe, AI assistant and reports                         | next    |
| Relay 1.0    | Event delivery service in Go                                               |         |
| 0.5 Platform | API keys, signed webhooks, SaaS plans, MCP server                          |         |
| Site 1.0     | Marketing site with GSAP                                                   |         |
| 1.0 Mobile   | Expo app for technicians                                                   |         |

## License

[MIT](LICENSE). Built by Ahmad Izzat Maulana.
