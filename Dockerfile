# syntax=docker/dockerfile:1.7
# =========================================================================
# Miharbor — multi-stage, multi-arch Docker image
#
# Stage 1 (web-builder): installs the full workspace (incl. dev deps for
# vite + vue-tsc), runs the Vue build, produces `apps/web/dist`.
#
# Stage 2 (runtime): re-installs only server/shared prod deps, copies the
# pre-built web bundle from stage 1, and runs Bun directly against the
# TypeScript entrypoint (Bun executes .ts natively, so no tsc step).
#
# Build:
#   docker buildx build --platform linux/amd64,linux/arm64 -t miharbor:test .
# Run:
#   docker run --rm -p 3000:3000 \
#     -v /etc/mihomo:/config:rw \
#     -e MIHARBOR_AUTH_DISABLED=true \
#     miharbor:test
# =========================================================================

# --- stage 1: build the web bundle ---------------------------------------
FROM oven/bun:1.3.11-slim AS web-builder

WORKDIR /app

# Copy workspace manifests first for better layer caching — dependency
# installation only re-runs when a package.json or the lockfile changes.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

# Full install (includes dev deps required by vite + vue-tsc).
# --ignore-scripts skips root `prepare: husky` — husky is a devDep that would
# otherwise fail under `bun install --production` in stage 2 anyway.
RUN bun install --frozen-lockfile --ignore-scripts

# Copy sources. We only need shared + web for the web build; server src is
# resolved in stage 2 (thinner context keeps the builder layer smaller).
COPY tsconfig.base.json tsconfig.base.json
COPY packages/shared packages/shared
COPY apps/web apps/web

# Vue build. Produces apps/web/dist.
RUN bun run --filter miharbor-web build

# --- stage 2: runtime image ---------------------------------------------
# Alpine is ~50 MB smaller than slim. Bun's alpine build occasionally segfaults
# under vite (see stage 1) but runs plain .ts entrypoints fine, which is all
# we do here.
FROM oven/bun:1.3.11-alpine

WORKDIR /app

# Runtime stage installs ONLY server + shared workspace deps. We bypass the
# web workspace's runtime install because its artefacts are pre-built into
# apps/web/dist (static files — no JS runtime needed). `bun install --filter`
# narrows install to the listed workspaces; other workspaces still participate
# in resolution so the lockfile stays in sync. This keeps `--frozen-lockfile`
# meaningful and avoids pulling vue, monaco-editor, radix-vue, etc. into the
# runtime image.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN bun install --frozen-lockfile --production --ignore-scripts \
    --filter miharbor-server --filter miharbor-shared

# Source — server + shared (Bun runs .ts directly).
COPY tsconfig.base.json tsconfig.base.json
COPY packages/shared packages/shared
COPY apps/server apps/server

# Pre-built web bundle from stage 1.
COPY --from=web-builder /app/apps/web/dist apps/web/dist

# Expected runtime defaults. Operators override via compose env / docker run
# -e. `/config` and `/app/data` are the canonical mount points documented in
# docker-compose.example.yml; leaving them empty falls back to API-only mode.
ENV MIHARBOR_PORT=3000 \
    MIHARBOR_TRANSPORT=local \
    MIHARBOR_CONFIG_PATH=/config/config.yaml \
    MIHARBOR_DATA_DIR=/app/data \
    MIHARBOR_WEB_DIST=/app/apps/web/dist \
    MIHARBOR_LOG_LEVEL=info \
    MIHARBOR_PRODUCTION=true

# Volumes: host-mounted mihomo config directory + persistent miharbor state
# (snapshots, vault, auth.json, audit.log). Declared for documentation and
# anonymous-volume auto-provisioning — operators should bind-mount both.
VOLUME ["/config", "/app/data"]

EXPOSE 3000

# oven/bun images ship a non-root `bun` user (uid 1000). Switch to it so we
# never run as root. Operators mounting /config or /app/data must ensure the
# directory is writable by uid 1000 (see README "Production checklist").
USER bun

# Lightweight healthcheck — hits the unauthenticated /health endpoint. We use
# Bun instead of curl/wget to avoid adding a package layer to alpine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.MIHARBOR_PORT||3000) + '/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))" || exit 1

ENTRYPOINT ["bun", "run", "apps/server/src/index.ts"]
