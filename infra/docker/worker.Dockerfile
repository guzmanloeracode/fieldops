# syntax=docker/dockerfile:1.7
# FieldOps worker: one bundled file plus the SQL migrations. Also runs migrations (`migrate`) and resets (`reset`).
FROM node:24-alpine AS base
RUN corepack enable
ENV PNPM_HOME=/pnpm

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @fieldops/worker --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# turbo prune leaves out root-level config that packages extend.
COPY --from=pruner /repo/tsconfig.base.json ./tsconfig.base.json
RUN pnpm --filter @fieldops/worker build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_FOLDER=/app/drizzle
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=builder --chown=app:app /repo/apps/worker/dist ./dist
COPY --from=builder --chown=app:app /repo/packages/db/drizzle ./drizzle
USER app
CMD ["node", "--enable-source-maps", "dist/index.js", "run"]
