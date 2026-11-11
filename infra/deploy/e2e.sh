#!/usr/bin/env bash
# Runs the Playwright journeys and axe checks against the production images of a commit, with a throwaway
# PostgreSQL that is migrated and seeded first. Nothing touches the live stack or the dev database.
#   infra/deploy/e2e.sh                 # images tagged with HEAD (built by release.sh)
#   TAG=<commit> infra/deploy/e2e.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${TAG:-$(git -C "$ROOT" rev-parse --short=12 HEAD)}"
PORT="${E2E_PORT:-3200}"
NAME="fieldops-e2e-$$"
PASSWORD="demo-e2e-$(openssl rand -hex 6)"
DB_URL="postgres://fieldops:fieldops@$NAME-db:5432/fieldops"

RELAY_KEY="rk_e2e_$(openssl rand -hex 8)"

cleanup() { docker rm -f "$NAME-web" "$NAME-db" "$NAME-relay" >/dev/null 2>&1 || true; docker network rm "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$NAME" >/dev/null
docker run -d --name "$NAME-db" --network "$NAME" --memory 384m \
  -e POSTGRES_USER=fieldops -e POSTGRES_PASSWORD=fieldops -e POSTGRES_DB=fieldops postgres:18-alpine >/dev/null
until docker exec "$NAME-db" pg_isready -U fieldops -d fieldops >/dev/null 2>&1; do sleep 1; done

docker run --rm --network "$NAME" -e MIGRATION_DATABASE_URL="$DB_URL" -e APP_DB_PASSWORD=app-e2e \
  "fieldops-worker:$TAG" node dist/index.js migrate >/dev/null
docker run --rm --network "$NAME" -e MIGRATION_DATABASE_URL="$DB_URL" -e DEMO_PASSWORD="$PASSWORD" \
  "fieldops-worker:$TAG" node dist/index.js reset >/dev/null

# A fake Relay (packages/relay) for outgoing webhooks (PLT-03): it records deliveries without calling anyone. The
# worker image reads MIGRATION_DATABASE_URL on start; the fake never connects to it.
docker run -d --name "$NAME-relay" --network "$NAME" --memory 128m -e RELAY_PORT=8099 -e RELAY_API_KEY="$RELAY_KEY" \
  -e MIGRATION_DATABASE_URL="$DB_URL" "fieldops-worker:$TAG" node dist/index.js fake-relay >/dev/null

docker run -d --name "$NAME-web" --network "$NAME" --memory 512m -p "127.0.0.1:$PORT:3000" \
  -e APP_URL="http://localhost:$PORT" -e DEMO_MODE=true -e DEMO_PASSWORD="$PASSWORD" -e AI_PROVIDER=fixture \
  -e RELAY_URL="http://$NAME-relay:8099" -e RELAY_API_KEY="$RELAY_KEY" \
  -e DATABASE_URL="postgres://fieldops_app:app-e2e@$NAME-db:5432/fieldops" \
  -e BETTER_AUTH_SECRET="$(openssl rand -hex 32)" "fieldops-web:$TAG" >/dev/null
for i in $(seq 1 60); do curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; [ "$i" = 60 ] && { echo "web did not start"; exit 1; }; sleep 1; done

cd "$ROOT/apps/web"
PLAYWRIGHT_BASE_URL="http://localhost:$PORT" DEMO_PASSWORD="$PASSWORD" pnpm exec playwright test --workers=1 --reporter=line
