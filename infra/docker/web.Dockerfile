# syntax=docker/dockerfile:1.7
# FieldOps Web: Next.js standalone output on a small non-root image.
FROM node:24-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
ENV PNPM_HOME=/pnpm NEXT_TELEMETRY_DISABLED=1

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @fieldops/web --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# turbo prune leaves out root-level config that packages extend.
COPY --from=pruner /repo/tsconfig.base.json ./tsconfig.base.json
# Version and commit are runtime env (runner stage), so a new commit doesn't invalidate the build cache.
ARG NEXT_PUBLIC_MAP_STYLE_URL
ENV NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL
# Cap the build's heap: the server also runs other production services.
RUN NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @fieldops/web build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
ARG APP_VERSION=dev
ARG APP_COMMIT=local
ENV APP_VERSION=$APP_VERSION APP_COMMIT=$APP_COMMIT
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app \
  && mkdir -p /data/files && chown app:app /data/files
COPY --from=builder --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
