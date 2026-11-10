# ADR 014: No hosted CI; checks run on the server as release gates

**Status:** accepted · 2026-11-10 (owner's decision)

**Context.** The PRD planned GitHub Actions for CI and deploys. The owner doesn't want GitHub CI.

**Decision.** GitHub Actions is disabled on the repository and there are no workflow files. `infra/deploy/release.sh`
is the pipeline: `pnpm verify` (format, lint, typecheck, unit tests with coverage thresholds, PostgreSQL integration
tests) before the build, `infra/deploy/e2e.sh` (Playwright + axe against the freshly built images and a throwaway
database) before deploying, then migrate, restart, health check and automatic rollback. `pnpm security` runs gitleaks
and a dependency audit before a release goes public.

**Consequences.** No external secrets or deploy user are needed, and what is tested is exactly what is deployed
(the same image tags). Pull requests from others aren't checked automatically; contributors run `pnpm verify`
themselves. CodeQL and Lighthouse CI from the PRD are not run.
