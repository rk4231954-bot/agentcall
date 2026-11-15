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
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN bun install --frozen-lockfile --filter @agentcall/server

COPY packages/shared packages/shared
COPY packages/typescript-config packages/typescript-config
COPY apps/server apps/server
# Bundles the server, Hono and @agentcall/shared into one file.
RUN bun build apps/server/src/index.ts --outdir apps/server/dist --target bun --minify

FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=bun:bun /app/apps/server/dist ./
USER bun
EXPOSE 3000
CMD ["bun", "index.js"]
