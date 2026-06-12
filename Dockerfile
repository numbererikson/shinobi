# Shinobi remote mode: dashboard + MCP streamable HTTP endpoint in one container.
#
#   docker build -t shinobi .
#   docker run -d -p 8765:8765 -v shinobi-data:/data \
#     -e SHINOBI_DASHBOARD_TOKEN=<long-random-token> shinobi
#
# The SQLite database lives in /data (SHINOBI_CONFIG_DIR) — always mount a
# volume there or every restart wipes your project memory.
# See docs/remote-mcp.md for the full deployment guide.

FROM node:22-slim AS build
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
RUN npx tsc && npm run build:spa \
  && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    SHINOBI_CONFIG_DIR=/data \
    SHINOBI_DB_PATH=/data/shinobi.db \
    SHINOBI_DASHBOARD_PORT=8765
# git powers `shinobi sync` (DB snapshot push/pull to a private repo) —
# without it the sync feature is dead inside the container.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY package.json ./
COPY migrations migrations

VOLUME /data
EXPOSE 8765

# Non-loopback bind → token auth turns on automatically (set
# SHINOBI_DASHBOARD_TOKEN to control the token, otherwise one is generated
# and persisted under /data).
CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0"]
