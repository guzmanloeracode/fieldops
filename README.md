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

| Role                 | What to try                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Owner** (Olivia)   | The KPI dashboard and its drill-downs, approving a large part request, operations settings, switching to Acme Teknik |
| **Dispatcher** (Dan) | The dispatch board: drag a job from the queue (or use the keyboard), watch the conflict warnings; the _Today_ tab    |
| **Technician** (Tom) | _My day_ on a phone-sized screen: En route → Start, the checklist, a part request, the signature, Complete           |

A second fictional company, _Acme Teknik Nusantara_ (Jakarta, IDR), shows that tenants never see each other's data.

## What's in release 0.2

![A dispatcher drags a queued job onto a technician's lane, overrides the outside-hours conflict with a reason, then searches with the command palette](docs/screenshots/release-0.2.gif)

- **Dispatch board:** day and week views with a lane per technician and an unscheduled queue. Drag to schedule,
  move, reassign or resize, or do the same with the keyboard. A map tab shows the day's visits.
- **Conflict checks:** overlapping visits, outside working hours, time off and missing skills, each overridable
  with a reason that stays in the timeline. Working hours, skills and time off are set per technician.
- **Technician workspace:** _My day_ with one-tap status actions, checklists generated from service-type
  templates, travel and work time recorded from status changes, camera capture and a customer signature.
- **Parts and expenses:** requests with a receipt photo, two approval thresholds (automatic, dispatcher), an
  approvals inbox with bulk decisions.
- **Dashboard:** KPIs against the previous period, charts with accessible data tables and drill-down into the jobs
  list, and a _Today_ view for dispatchers.
- **Jobs list:** saved views, bulk assign and status changes, CSV export, and a ⌘K command palette.
- **Also:** several technicians per job, equipment with service history, several organizations per user.

Release 0.1 laid the base: accounts and roles, customers and sites, the job lifecycle, the REST API with
OpenAPI 3.1, and the deterministic demo. The full list is in the [changelog](CHANGELOG.md).

The [roadmap](#roadmap) adds SLAs and AI, payments, a Go event-delivery service, a marketing site and a mobile app.

## Engineering highlights

- **Tenant isolation in two layers.** Repositories scope every query by `organization_id`, and PostgreSQL
  row-level security enforces it again for the runtime role. A test fails the release gate if any table with an
  `organization_id` column lacks a policy. ([ADR 003](docs/adr/003-multi-tenancy.md))
- **One contract.** Zod schemas in `packages/shared` validate forms, server actions and API requests, type the
  code, and generate the OpenAPI document.
- **Framework-free domain.** Permissions, the job lifecycle, money and numbering live in `packages/core` as plain
  TypeScript behind repository interfaces: 388 unit tests, 100% line coverage.
- **Real database tests.** 111 integration tests run against PostgreSQL 18 in Testcontainers: RLS, keyset
  pagination over 12 sort orders, concurrent numbering and the seed itself.
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
      WK[worker · Node<br/>email outbox, nightly reset, maintenance]
      MG[migrate · one-shot]
      PG[(PostgreSQL 18<br/>RLS)]
    end
    WEB -->|fieldops_app role| PG
    WK -->|owner role| PG
    MG --> PG
    WEB -. signed URLs .-> FS[(files volume<br/>or Cloudflare R2)]
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
Better Auth · PostgreSQL 18 · Drizzle ORM · Zod 4 · zod-openapi + Scalar · pg-boss · MapLibre GL · React Email ·
Vitest · Testcontainers · Playwright + axe-core · pnpm + Turborepo · Docker Compose

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
`DEMO_MODE` is off.

## Tests

```bash
pnpm verify          # format, lint, typecheck, unit tests (coverage) and PostgreSQL integration tests (Docker)
pnpm e2e:image       # Playwright journeys + axe on the production images, with a throwaway database
pnpm security        # gitleaks over the full git history and a production dependency audit
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
infra/          Dockerfiles, Compose files, nginx site config, release script
docs/           PRD, architecture, runbook, ADRs
```

## Roadmap

| Release      | Theme                                                                      | Status  |
| ------------ | -------------------------------------------------------------------------- | ------- |
| 0.1 Core     | Accounts, customers, jobs, REST API, demo                                  | ✅ live |
| 0.2 Dispatch | Drag-and-drop board, technician day view, checklists, approvals, dashboard | ✅ live |
| 0.3 Automate | SLA engine, notifications, audit log, customer portal, AI job intake       | next    |
| 0.4 Get paid | Quotes, invoices, Stripe, AI assistant and reports                         |         |
| Relay 1.0    | Event delivery service in Go                                               |         |
| 0.5 Platform | API keys, signed webhooks, SaaS plans, MCP server                          |         |
| Site 1.0     | Marketing site with GSAP                                                   |         |
| 1.0 Mobile   | Expo app for technicians                                                   |         |

## License

[MIT](LICENSE). Built by Ahmad Izzat Maulana.
