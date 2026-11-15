# syntax=docker/dockerfile:1
#
# Build context is the repo root (the server imports workspace packages):
#   docker build -f apps/server/Dockerfile .

ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# Workspace manifests first so the install layer is cached until deps change.
# Every workspace's package.json is needed for --frozen-lockfile to match.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN bun install --frozen-lockfile --filter @agentcall/server

COPY packages/db packages/db
COPY packages/shared packages/shared
COPY packages/typescript-config packages/typescript-config
COPY apps/server apps/server
# Bundles the server and workspace packages, including the VM runner script.
# PGlite (local dev only) stays out: it sits in a lazy chunk that production,
# with a postgres:// DATABASE_URL, never loads.
RUN bun build apps/server/src/index.ts --outdir apps/server/dist --target bun --minify --splitting \
      --external @electric-sql/pglite

FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_DIR=/app/drizzle
COPY --from=build --chown=bun:bun /app/apps/server/dist ./
# SQL migrations, applied on startup.
COPY --from=build --chown=bun:bun /app/packages/db/drizzle ./drizzle
USER bun
EXPOSE 3000
CMD ["bun", "index.js"]
