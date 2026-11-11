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

| Role                 | What to try                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Owner** (Olivia)   | Revenue on the dashboard and its CSV exports, billing settings and the catalog, SLA policies, the audit log              |
| **Dispatcher** (Dan) | The board (open it in two windows: changes appear live), quotes and invoices, maintenance plans on a customer            |
| **Technician** (Tom) | _My day_ on a phone-sized screen: En route → Start, the checklist, a part request, the signature, the report             |
| **Customer** (Jamie) | The [customer portal](https://fieldops.tinggalpake.com/portal/acme-air): approve a quote, pay an invoice (test checkout) |

A second fictional company, _Acme Teknik Nusantara_ (Jakarta, IDR), shows that tenants never see each other's data;
its people use the app in Bahasa Indonesia.

## What's in release 0.4

![In the customer portal, a customer approves a quote and gets the number of the new job, then pays an invoice through the test checkout and sees it marked paid](docs/screenshots/release-0.4.gif)

- **Quotes and invoices:** quotes with a discount and a validity date that become jobs when approved; invoices
  drafted from a completed job with its service, labor rounded to the quarter hour and approved parts at cost plus
  markup; numbers per year with no gaps, payments recorded by hand, overdue reminders after 3, 7 and 14 days, and a
  catalog of parts and fees.
- **Online payments:** customers approve quotes and pay invoices in the customer portal, through Stripe Checkout
  with a signed webhook; the public demo uses a simulated checkout labeled as a test until Stripe keys are set.
- **Branded PDFs** for quotes, invoices and service reports, in English or Bahasa Indonesia.
- **AI service reports:** completing a job drafts the customer's report from the checklist, readings, notes and
  photos; someone reviews and sends it, and the customer opens the PDF from an email link or the portal.
- **Ask FieldOps** (⌘J / Ctrl+J): questions about jobs, SLA risks, capacity, customers, approvals and revenue,
  answered through read-only tools that only see what the asking user can see.
- **Operations:** maintenance plans that create recurring jobs ahead of time, an SLA clock that pauses while a job
  waits for the customer, a daily digest for owners, and revenue on the dashboard.
- **Bahasa Indonesia:** the app, the customer portal, emails and PDFs in English or Indonesian, per member, per
  customer and per browser for signed-out visitors, with Indonesian dates and 24-hour times. Sign in as Acme
  Teknik's owner to see it.

| A quote                                                                                                                | An invoice with a payment recorded                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ![An approved quote with its lines, tax, total and the job it created](docs/screenshots/quote.png)                     | ![An overdue invoice with a partial payment recorded and the balance due](docs/screenshots/invoice.png) |
| **Paying an invoice in the customer portal**                                                                           | **A service report drafted by AI**                                                                      |
| ![An invoice in the customer portal with the balance due and Pay now](docs/screenshots/portal-billing.png)             | ![A sent service report on a completed job, drafted by AI](docs/screenshots/service-report.png)         |
| **Maintenance plans**                                                                                                  | **Ask FieldOps (Ctrl/⌘ J)**                                                                             |
| ![A commercial customer's maintenance plans with their status and next visits](docs/screenshots/maintenance-plans.png) | ![The Ask FieldOps panel with its recent conversations](docs/screenshots/assistant.png)                 |
| **Revenue on the dashboard**                                                                                           | **Bahasa Indonesia and rupiah (Acme Teknik)**                                                           |
| ![Revenue invoiced, revenue collected and receivables on the owner's dashboard](docs/screenshots/dashboard.png)        | ![The invoice list in Bahasa Indonesia with amounts in rupiah](docs/screenshots/bahasa-indonesia.png)   |
| **Customer portal**                                                                                                    | **A portal request with its AI draft**                                                                  |
| ![Customer portal](docs/screenshots/portal.png)                                                                        | ![AI review of a portal request](docs/screenshots/ai-review.png)                                        |
| **Notifications**                                                                                                      | **Audit log**                                                                                           |
| ![Notifications](docs/screenshots/notifications.png)                                                                   | ![Audit log](docs/screenshots/audit-log.png)                                                            |
| **SLA policies**                                                                                                       | **The board with the sidebar collapsed**                                                                |
| ![SLA policies](docs/screenshots/sla-policies.png)                                                                     | ![Dispatch board with the sidebar collapsed to icons](docs/screenshots/board-collapsed.png)             |

Release 0.3 added the SLA engine, notifications with live updates, the customer portal, AI smart intake and an
audit log written by the database; release 0.2 added the dispatch board with conflict checks, the technician
workspace, parts approvals and the KPI dashboard; release 0.1 laid the base: accounts and roles, customers and
sites, the job lifecycle, the REST API with OpenAPI 3.1, and the deterministic demo. The full list is in the [changelog](CHANGELOG.md).

After 0.4 the [roadmap](#roadmap) adds a Go event-delivery service, API keys and webhooks, a marketing site and a
mobile app.

## Engineering highlights

- **Tenant isolation in two layers.** Repositories scope every query by `organization_id`, and PostgreSQL
  row-level security enforces it again for the runtime role. A test fails the release gate if any table with an
  `organization_id` column lacks a policy. ([ADR 003](docs/adr/003-multi-tenancy.md))
- **One contract.** Zod schemas in `packages/shared` validate forms, server actions and API requests, type the
  code, and generate the OpenAPI document.
- **Framework-free domain.** Permissions, the job lifecycle, money and numbering live in `packages/core` as plain
  TypeScript behind repository interfaces: 744 unit tests, 99.9% line coverage.
- **Real database tests.** 226 integration tests run against PostgreSQL 18 in Testcontainers: RLS, keyset
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
- **An assistant that can only read.** _Ask FieldOps_ answers through read-only tools bound to the user's
  organization and role, each in its own short transaction, capped in rows and calls; record contents reach the
  model as escaped data, so a job description can't steer it. ([ADR 019](docs/adr/019-ask-fieldops-tools.md))
- **Exact money, gap-free numbers.** Totals are computed in BigInt minor units with the discount split exactly
  across lines and tax rounded per line; invoice numbers come from a per-year counter in the issuing transaction,
  so they never skip. ([ADR 017](docs/adr/017-billing-totals-and-numbering.md))
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
      WK[worker · Node<br/>SLA monitor, AI drafts, billing, maintenance plans,<br/>digest, email outbox, nightly reset, cleanup]
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
server-sent events · MapLibre GL · React Email · React PDF · Stripe · Vitest · Testcontainers ·
Playwright + axe-core · pnpm + Turborepo · Docker Compose

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
pnpm eval:assistant  # Ask FieldOps evaluation set (25 questions; needs a seeded database and ANTHROPIC_API_KEY)
```

There is no hosted CI. The same checks are the release pipeline: `infra/deploy/release.sh` runs `pnpm verify`,
builds the images, runs the E2E suite against them, and only then deploys, with an automatic rollback if the health
check fails.

## Project layout

```
apps/web           Next.js app: UI, server actions, /api/v1, API docs
apps/worker        SLA monitor, AI drafts, billing, maintenance plans, digest, email outbox, nightly reset,
                   cleanup, migrations
packages/core      Domain rules and services (no framework dependencies)
packages/db        Drizzle schema, migrations, RLS policies, repositories, seed
packages/shared    Zod schemas and types shared by web, worker, API and mobile
packages/email     React Email templates
packages/documents PDF quotes, invoices and service reports (React PDF)
packages/payments  Online payments: Stripe Checkout and the simulated test checkout
packages/ai        AI models for intake, the assistant and service reports, prompts and evaluation sets
infra/             Dockerfiles, Compose files, nginx site config, release script
docs/              PRD, architecture, runbook, ADRs
```

## Roadmap

| Release      | Theme                                                                      | Status  |
| ------------ | -------------------------------------------------------------------------- | ------- |
| 0.1 Core     | Accounts, customers, jobs, REST API, demo                                  | ✅ live |
| 0.2 Dispatch | Drag-and-drop board, technician day view, checklists, approvals, dashboard | ✅ live |
| 0.3 Automate | SLA engine, notifications, audit log, customer portal, AI job intake       | ✅ live |
| 0.4 Get paid | Quotes, invoices, payments, AI reports and assistant, maintenance plans    | ✅ live |
| Relay 1.0    | Event delivery service in Go                                               |         |
| 0.5 Platform | API keys, signed webhooks, SaaS plans, MCP server                          |         |
| Site 1.0     | Marketing site with GSAP                                                   |         |
| 1.0 Mobile   | Expo app for technicians                                                   |         |

## License

[MIT](LICENSE). Built by Ahmad Izzat Maulana.
