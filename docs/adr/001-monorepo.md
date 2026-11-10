# ADR 001: Monorepo with pnpm workspaces and Turborepo

**Status:** accepted · 2026-11-10

**Context.** Web, worker, mobile and the API share validation, types and business rules.

**Decision.** One repository with pnpm workspaces (`apps/*`, `packages/*`) and Turborepo for cached tasks. Internal
packages are consumed as TypeScript source (`transpilePackages` in Next.js, esbuild bundling for the worker), so
there is no separate build step per package.

**Consequences.** One lockfile and one set of release gates. `turbo prune` builds minimal Docker contexts. Root-level config
that packages extend must be copied into pruned builds explicitly.
