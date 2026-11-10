#!/usr/bin/env bash
# Builds and deploys FieldOps on this server (PRD §15.4, local variant until the GitHub Actions deploy is enabled).
#   infra/deploy/release.sh            # build HEAD, migrate, restart, health check, auto-rollback
#   SKIP_BUILD=1 infra/deploy/release.sh
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
docker image prune -f --filter "label!=keep" >/dev/null 2>&1 || true
