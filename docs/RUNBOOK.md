# Runbook

Production runs on the owner's Linux server as Compose project `fieldops`. Secrets are in
`/etc/fieldops/fieldops.env` (root only, never committed). Release log: `/var/log/fieldops-release.log`.

## Deploy

```bash
cd /root/fieldops && git pull && infra/deploy/release.sh
```

The script runs `pnpm verify` (format, lint, typecheck, unit and integration tests), then tags the running images as `:rollback` first (the containerd image store drops an image as soon as its
tag moves), builds `fieldops-web` and `fieldops-worker` from `git archive HEAD`, runs the Playwright + axe suite
against the new images with a throwaway database (`infra/deploy/e2e.sh`), runs `migrate`, restarts `web` and
`worker`, waits for `/api/health` to report the new commit, checks the public URL, and rolls back automatically if
any check fails.

## Roll back by hand

```bash
docker tag fieldops-web:rollback fieldops-web:prev && docker tag fieldops-worker:rollback fieldops-worker:prev
TAG=prev docker compose --env-file /etc/fieldops/fieldops.env -f infra/compose/compose.yml up -d --no-build web worker
```

A release that changes the demo seed should reset the demo right away instead of waiting for 00:00 UTC:
`RESEED=1 infra/deploy/release.sh`.

Migrations are forward-only: a rollback runs old code against the new schema, so every migration must stay
compatible with the previous release.

## Useful commands

```bash
C="docker compose --env-file /etc/fieldops/fieldops.env -f /root/fieldops/infra/compose/compose.yml"
$C ps
$C logs -f --tail=100 web worker
$C exec postgres psql -U fieldops fieldops
$C run --rm worker node dist/index.js reset     # reset the demo now
curl -s http://127.0.0.1:8097/api/health
```

## API keys and rate limits

A leaked key: an owner or admin revokes it in Settings → API keys (or `DELETE /api/v1/api-keys/{id}` with a
session); it stops working on the next request. To revoke one by hand, or every key of a member:

```bash
$C exec postgres psql -U fieldops fieldops -c "update api_key set revoked_at = now() where prefix = 'fo_xxxx' and revoked_at is null"
```

Find which key made a change in Settings → Audit log (the user agent starts with `API key fo_xxxx…`) or in the web
logs (`apiKeyId`). Limits are per minute: `API_KEY_RATE_LIMIT` (default 300) and `API_USER_RATE_LIMIT` (600) in
`/etc/fieldops/fieldops.env`, 0 turns one off; restart `web` after a change. Old windows are deleted by the
worker's daily clean-up with the other rate-limit rows.

## Backups and restore

Planned: nightly `pg_dump` to Cloudflare R2, kept 14 days, restore tested every quarter. Blocked until R2 is
enabled on the Cloudflare account. Until then the demo database is disposable by design: the nightly reset
rebuilds it from the seed.

Manual dump and restore:

```bash
$C exec -T postgres pg_dump -U fieldops -Fc fieldops > fieldops-$(date +%F).dump
$C exec -T postgres pg_restore -U fieldops -d fieldops --clean --if-exists < fieldops-YYYY-MM-DD.dump
```

## Uploads without R2

Until R2 is enabled, uploads are stored on the `fieldops_files` volume (`/data/files` in the web and worker
containers) through signed `/api/files/…` URLs (ADR 015). The nightly reset empties it. Size check:

```bash
docker run --rm -v fieldops_files:/f alpine du -sh /f
```

## Webhooks and Relay

Outgoing webhooks (ADR 022) need two settings in `/etc/fieldops/fieldops.env`, read by `web` and `worker`:

```bash
RELAY_URL=https://relay.tinggalpake.com
RELAY_API_KEY=rk_…   # one key for every organization
```

Create the key on the Relay host with the Relay CLI (it is shown once): a key not bound to a tenant, with the
scopes FieldOps uses (`ingest` to post events, `read` for the delivery log, `manage` for endpoints and
subscriptions, `admin` to create tenants):

```bash
cd /root/relay && docker compose -p relay --env-file /etc/relay/relay.env run --rm --no-deps migrate \
  keys create --name fieldops --scopes ingest,read,manage,admin
```

Without the two settings the worker doesn't post events, no organization can turn webhooks on, and the settings
page says webhooks aren't set up. Restart `web` and `worker` after changing them.

Events waiting for Relay, and ones it refused:

```bash
$C exec postgres psql -U fieldops fieldops -c \
  "select status, count(*), min(created_at) from outbox_event group by status"
$C exec postgres psql -U fieldops fieldops -c \
  "select id, organization_id, type, attempts, error from outbox_event where status = 'failed' order by created_at desc limit 20"
```

`pending` rows with a growing `attempts` mean Relay is down or refusing the key: check `curl -s
https://relay.tinggalpake.com/healthz` and the worker log (`webhook event not sent`). Once Relay is back they go
out on their own. `failed` rows gave up after 12 attempts (about six hours); after fixing the cause, send them
again with `update outbox_event set status = 'pending', attempts = 0, next_attempt_at = now() where status =
'failed';`. Each keeps its ID as the Idempotency-Key, so one Relay already accepted isn't duplicated (within
Relay's 24-hour idempotency window).

In development, run the fake Relay and point the web app and the worker at it:

```bash
pnpm --filter @fieldops/relay fake        # http://127.0.0.1:8099, key rk_dev
RELAY_URL=http://127.0.0.1:8099 RELAY_API_KEY=rk_dev pnpm dev
```

The fake doesn't call endpoints: deliveries succeed at once, except to URLs whose path contains `/fail` (dead
after one 500) or `/retry` (waiting after a 503). Its state is lost when it stops.

## Placeholder page

`infra/placeholder/` holds the static project page that ran before release 0.1. It is no longer deployed.
