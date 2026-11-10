# Runbook

Production runs on the owner's Linux server as Compose project `fieldops`. Secrets are in
`/etc/fieldops/fieldops.env` (root only, never committed). Release log: `/var/log/fieldops-release.log`.

## Deploy

```bash
cd /root/fieldops && git pull && infra/deploy/release.sh
```

The script tags the running images as `:rollback` first (the containerd image store drops an image as soon as its
tag moves), builds `fieldops-web` and `fieldops-worker` from `git archive HEAD`, runs `migrate`, restarts `web` and
`worker`, waits for `/api/health` to report the new commit, checks the public URL, and rolls back automatically if
any check fails.

## Roll back by hand

```bash
docker tag fieldops-web:rollback fieldops-web:prev && docker tag fieldops-worker:rollback fieldops-worker:prev
TAG=prev docker compose --env-file /etc/fieldops/fieldops.env -f infra/compose/compose.yml up -d --no-build web worker
```

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

## Backups and restore

Planned: nightly `pg_dump` to Cloudflare R2, kept 14 days, restore tested every quarter. Blocked until R2 is
enabled on the Cloudflare account. Until then the demo database is disposable by design: the nightly reset
rebuilds it from the seed.

Manual dump and restore:

```bash
$C exec -T postgres pg_dump -U fieldops -Fc fieldops > fieldops-$(date +%F).dump
$C exec -T postgres pg_restore -U fieldops -d fieldops --clean --if-exists < fieldops-YYYY-MM-DD.dump
```

## Placeholder page

`infra/placeholder/` holds the static project page that ran before release 0.1. It is no longer deployed.
