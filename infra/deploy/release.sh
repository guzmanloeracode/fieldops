#!/usr/bin/env bash
# Builds and deploys FieldOps on this server (PRD §15.4). Runs the checks itself: there is no hosted CI.
#   infra/deploy/release.sh            # verify, build HEAD, E2E on the new images, migrate, restart, health check, auto-rollback
#   SKIP_VERIFY=1 SKIP_E2E=1 SKIP_BUILD=1 infra/deploy/release.sh   # skip individual gates
#   RESEED=1 infra/deploy/release.sh   # also reset the demo data now (after a release that changes the seed)
# There is no hosted CI: these gates are the pipeline (PRD §18.2).
# Full log: /var/log/fieldops-release.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="/etc/fieldops/fieldops.env"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/infra/compose/compose.yml")
LOG=/var/log/fieldops-release.log
PUBLIC_URL="${PUBLIC_URL:-https://fieldops.tinggalpake.com}"
LOCAL_URL="http://127.0.0.1:${WEB_PORT:-8097}"

cd "$ROOT"
COMMIT="$(git rev-parse --short=12 HEAD)"
VERSION="$(node -p "require('./apps/web/package.json').version")"
export TAG="$COMMIT"
exec 3>&1 >>"$LOG" 2>&1
say() { echo "$*" >&3; echo "[$(date -Is)] $*"; }

say "fieldops $VERSION ($COMMIT)"
[ -z "$(git status --porcelain -- apps packages infra pnpm-lock.yaml)" ] || say "warning: uncommitted changes are not deployed (building HEAD)"

# The containerd image store drops an image as soon as its tag moves, so remember the running images first.
for svc in web worker; do
  current="$(docker inspect --format '{{.Config.Image}}' "fieldops-$svc-1" 2>/dev/null || true)"
  if [ -n "$current" ] && [[ "$current" == fieldops-* ]]; then docker tag "$current" "fieldops-$svc:rollback"; fi
done

if [ "${SKIP_VERIFY:-0}" != "1" ]; then
  pnpm verify || { say "verify failed: nothing deployed (see $LOG)"; exit 1; }
  say "verify passed"
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  ctx="$(mktemp -d)"
  trap 'rm -rf "$ctx"' EXIT
  git archive HEAD | tar -x -C "$ctx"
  docker build -q -f "$ctx/infra/docker/web.Dockerfile" -t "fieldops-web:$TAG" \
    --build-arg APP_VERSION="$VERSION" --build-arg APP_COMMIT="$COMMIT" "$ctx" >/dev/null
  docker build -q -f "$ctx/infra/docker/worker.Dockerfile" -t "fieldops-worker:$TAG" \
    --build-arg APP_VERSION="$VERSION" "$ctx" >/dev/null
  say "built images $TAG"
fi

if [ "${SKIP_E2E:-0}" != "1" ]; then
  TAG="$TAG" "$ROOT/infra/deploy/e2e.sh" || { say "e2e failed: nothing deployed (see $LOG)"; exit 1; }
  say "e2e passed"
fi

rollback() {
  say "health check failed: rolling back"
  if docker image inspect fieldops-web:rollback >/dev/null 2>&1; then
    docker tag fieldops-web:rollback fieldops-web:prev && docker tag fieldops-worker:rollback fieldops-worker:prev
    TAG=prev "${COMPOSE[@]}" up -d --no-build web worker
    say "rolled back to the previous images"
  fi
  exit 1
}

"${COMPOSE[@]}" up -d --no-build --remove-orphans
for i in $(seq 1 60); do
  body="$(curl -fsS "$LOCAL_URL/api/health" 2>/dev/null || true)"
  if [[ "$body" == *"\"status\":\"ok\""* && "$body" == *"$COMMIT"* ]]; then break; fi
  [ "$i" = 60 ] && rollback
  sleep 2
done

code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/")"
api="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/v1/openapi.json")"
[ "$code" = 200 ] && [ "$api" = 200 ] || rollback
say "live: $PUBLIC_URL (/: $code, openapi: $api)"
if [ "${RESEED:-0}" = "1" ]; then
  "${COMPOSE[@]}" run --rm worker node dist/index.js reset && say "demo data reset" || say "warning: demo reset failed (see $LOG)"
fi
docker image prune -f --filter "label!=keep" >/dev/null 2>&1 || true
