# Security policy

FieldOps is a portfolio project with a public demo that holds only fictional data. Security still matters: the
code is meant to be reused.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's **Report a vulnerability** (private security advisory) on this
repository. Expect a first reply within 5 working days.

## What is in place

- Server-side authorization for every page, server action and API call through one function in `packages/core`.
- Tenant isolation in two layers: tenant-scoped repositories and PostgreSQL row-level security, with tests that
  fail CI when a tenant table lacks a policy.
- Zod validation on every input, parameterized queries only, secure HTTP-only cookies, security headers.
- Secrets only in environment files on the server; gitleaks and dependency audits in CI.
