# Contributing

1. Fork and create a branch from `main`.
2. Follow the local setup in the README. `pnpm verify` must pass; for UI changes, run `pnpm e2e:image` too.
   There is no hosted CI.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` …). Keep pull
   requests small; they are squash-merged.
4. Business rules belong in `packages/core` with unit tests. A new tenant table needs `organization_id`, an
   entry in `TENANT_TABLES` and a row-level security policy, or the guard test fails.
5. User-facing strings go in `apps/web/messages/en/*.json`.
