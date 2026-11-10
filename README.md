# FieldOps

**Field service management for small service businesses.** Requests come in, a dispatcher schedules a technician,
the technician does the work on site, and the business sees every job from request to completion.

[**Live demo**](https://fieldops.tinggalpake.com) · [API reference](https://fieldops.tinggalpake.com/docs/api) ·
[Product requirements](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md)

![Jobs list](docs/screenshots/jobs.png)

> FieldOps is an open-source portfolio project. Every person, company and address in the demo is fictional, and the
> demo resets every day at 00:00 UTC.

## Try it

Open the [live demo](https://fieldops.tinggalpake.com) and sign in with one click as:

| Role                 | What to try                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Owner** (Olivia)   | The dashboard, members and invitations, organization settings, the Demo outbox     |
| **Dispatcher** (Dan) | Create a job from a customer, assign a technician, watch the overlap warning       |
| **Technician** (Tom) | _My day_, then En route → Start → Hold → Resume → Complete on a phone-sized screen |

A second fictional company, _Acme Teknik Nusantara_ (Jakarta, IDR), shows that tenants never see each other's data.

## What's in release 0.1

- **Accounts and organizations:** email sign-up with verification, password reset, organizations, invitations
  that expire after 7 days, and four roles enforced on the server.
- **Customers:** contacts, sites with coordinates and access notes, equipment, duplicate warnings on matching email
  or phone, server-side search, filters and pagination.
- **Jobs:** per-organization numbers (`JOB-000123`), a status machine with reasons and preconditions, assignment
  and scheduling with overlap checks, internal and customer-visible notes, photos uploaded straight to object
  storage, a full timeline, and a jobs table whose filters live in the URL.
- **REST API:** `/api/v1` with an OpenAPI 3.1 spec generated from the same Zod schemas the forms use, cursor
  pagination, RFC 9457 errors, `Idempotency-Key` and `If-Match`.
- **Demo environment:** a deterministic seed with about 3,300 jobs over six months, dates relative to the reset
  time, one-click sign-in, and an in-app outbox instead of real emails.

The [roadmap](#roadmap) adds dispatch, SLAs and AI, payments, a Go event-delivery service, a marketing site and a
mobile app.

## Engineering highlights

- **Tenant isolation in two layers.** Repositories scope every query by `organization_id`, and PostgreSQL
  row-level security enforces it again for the runtime role. A test fails CI if any table with an
  `organization_id` column lacks a policy. ([ADR 003](docs/adr/003-multi-tenancy.md))
- **One contract.** Zod schemas in `packages/shared` validate forms, server actions and API requests, type the
  code, and generate the OpenAPI document.
- **Framework-free domain.** Permissions, the job lifecycle, money and numbering live in `packages/core` as plain
  TypeScript behind repository interfaces: 258 unit tests, 100% line coverage.
- **Real database tests.** 74 integration tests run against PostgreSQL 18 in Testcontainers: RLS, keyset
  pagination over 12 sort orders, concurrent numbering and the seed itself.
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
    WEB -. presigned URLs .-> R2[(Cloudflare R2)]
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
Vitest · Testcontainers · Playwright + axe-core · pnpm + Turborepo · Docker Compose · GitHub Actions

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
pnpm lint && pnpm typecheck
pnpm --filter @fieldops/core test        # unit tests with coverage
pnpm --filter @fieldops/db test:int      # PostgreSQL integration tests (Docker)
pnpm --filter @fieldops/web test:e2e     # Playwright journeys and axe checks
```

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
| 0.2 Dispatch | Drag-and-drop board, technician day view, checklists, approvals, dashboard | next    |
| 0.3 Automate | SLA engine, notifications, audit log, customer portal, AI job intake       |         |
| 0.4 Get paid | Quotes, invoices, Stripe, AI assistant and reports                         |         |
| Relay 1.0    | Event delivery service in Go                                               |         |
| 0.5 Platform | API keys, signed webhooks, SaaS plans, MCP server                          |         |
| Site 1.0     | Marketing site with GSAP                                                   |         |
| 1.0 Mobile   | Expo app for technicians                                                   |         |

## License

[MIT](LICENSE). Built by Ahmad Izzat Maulana.
