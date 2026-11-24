# Shinobi remote mode: dashboard + MCP streamable HTTP endpoint in one container.
#
#   docker build -t shinobi .
#   docker run -d -p 8765:8765 -v shinobi-data:/data \
#     -e SHINOBI_DASHBOARD_TOKEN=<long-random-token> shinobi
#
# The SQLite database AND installed plugins live in /data — always mount a
# volume there or every restart wipes your project memory and any plugins.
# See docs/remote-mcp.md for the full deployment guide.

# Base image pinned by digest (multi-arch index), same in every stage.
# Upstream rebuilds node:22-slim often; an unpinned tag changes every layer of
# our image and turns each upgrade into a full ~120 MB pull. Dependabot
# proposes digest bumps (security fixes) as their own PRs.
FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY dashboard-spa/package.json dashboard-spa/package-lock.json dashboard-spa/
# prepare (dist bootstrap) is skipped here; we build explicitly below.
RUN npm ci --ignore-scripts \
  && npm rebuild better-sqlite3 \
  && npm ci --prefix dashboard-spa --no-audit --no-fund

COPY tsconfig.json ./
COPY src src
COPY dashboard-spa dashboard-spa
RUN npx tsc && npm run build:spa

# Production dependencies in their own stage, keyed only by the lockfile. With
# the CI build cache this layer keeps the same digest between releases, so an
# upgrade downloads just the new app code instead of all of node_modules.
FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm rebuild better-sqlite3

FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370
ENV NODE_ENV=production \
    SHINOBI_CONFIG_DIR=/data \
    SHINOBI_DB_PATH=/data/shinobi.db \
    SHINOBI_PLUGINS_DIR=/data/plugins \
    SHINOBI_PLUGINS_NPM_DIR=/data/plugins-npm \
    SHINOBI_DASHBOARD_PORT=8765
# git powers `shinobi sync` (DB snapshot push/pull to a private repo) —
# without it the sync feature is dead inside the container.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY package.json ./
COPY migrations migrations

VOLUME /data
EXPOSE 8765

# Non-loopback bind → token auth turns on automatically (set
# SHINOBI_DASHBOARD_TOKEN to control the token, otherwise one is generated
# and persisted under /data).
CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0"]
