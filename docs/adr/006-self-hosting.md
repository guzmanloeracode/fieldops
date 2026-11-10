# ADR 006: Self-hosting with Docker Compose instead of serverless

**Status:** accepted · 2026-11-10

**Decision.** Docker Compose on the owner's Linux server, behind nginx and Cloudflare. Only nginx listens publicly;
the web container is bound to `127.0.0.1:8097`. Each container has a memory limit because the server also runs
other production services.

**Consequences.** Long-running workers, cron schedules and server-sent events are easy. We own patching, backups and
uptime (see RUNBOOK). Builds must cap their memory: the server has no swap, and an uncapped Next.js build next to a
dev server triggered the OOM killer once during development.
