# ADR 012: TypeScript 6.0, not 7.0, for now

**Status:** accepted · 2026-11-10

**Context.** TypeScript 7.0 (the native compiler) is the latest release, but editor plugins and Next.js's type
checking still rely on the JavaScript compiler API.

**Decision.** Pin `typescript@~6.0`. Revisit when Next.js and typescript-eslint support 7.x.
