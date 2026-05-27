# Hosted SaaS architecture

> **Status:** Aspirational design doc. The hosted SaaS layer is not built
> yet — current launch ships self-hosted only. URLs/domains below
> (`shinobi.dev`, etc.) are placeholders for whatever the future hosted
> service domain ends up being.

Self-hosted Shinobi (single SQLite + git sync) is the primary distribution
and stays unchanged. This document describes the additional layer for
operating Shinobi as a multi-tenant hosted service without diverging
the data model.

## Design goals

1. **One Shinobi codebase.** Self-hosted and hosted must run the same MCP
   tools, same dashboard, same SQLite schema, same migrations.
2. **Per-tenant data isolation.** Tenant A cannot see tenant B's projects,
   decisions, or sessions — enforced at the storage layer, not just at
   the API.
3. **Control-plane separation.** Auth, billing, plugin registry, telemetry
   aggregation live in a shared Postgres so they can be queried across
   tenants (e.g. "send digest to all paying customers").
4. **No laptop dependency.** Users without a dev machine can sign up,
   use the dashboard, and connect AI agents (Claude Desktop, Cursor,
   VS Code extension) over network.
5. **Graceful self-hosted downgrade.** Anyone can export their tenant
   snapshot and run it locally — same `~/.shinobi/shinobi.db` file.

## Storage layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Shared Postgres (control plane)                                  │
│                                                                   │
│  tenants               (id, slug, plan, created_at)               │
│  tenant_users          (tenant_id, user_id, role, joined_at)      │
│  users                 (id, email, name, billing_email)           │
│  subscriptions         (tenant_id, stripe_sub_id, status, period) │
│  plugin_registry       (name, version, downloads, last_published) │
│  telemetry_events      (cross-tenant aggregate, anonymized)        │
│  audit_log             (tenant_id, user_id, action, ts)           │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  S3-compatible object store (R2 recommended)                      │
│                                                                   │
│  s3://shinobi-tenants/<tenant_id>/shinobi.db          (live snapshot)
│  s3://shinobi-tenants/<tenant_id>/shinobi.db.bak-*    (rotation)
│  s3://shinobi-tenants/<tenant_id>/digests/YYYY-WW.md  (artefacts)
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Tenant runtime (one Node process per active tenant)              │
│                                                                   │
│  Pulls /<tenant_id>/shinobi.db into ephemeral /tmp at boot,       │
│  serves dashboard + MCP over WebSocket, snapshots back to S3      │
│  every 30s of dirty time and on graceful shutdown.                │
└──────────────────────────────────────────────────────────────────┘
```

## Why SQLite-per-tenant instead of one Postgres for everything

| Constraint | Why SQLite wins |
|---|---|
| Self-hosted parity | The local `.db` file IS the snapshot — no schema translation. |
| FTS5 + better-sqlite3 | Native, zero ops. Postgres FTS would be a port. |
| Cost on small tenants | A free-tier user with 50 KB of data costs ~$0 in R2; Postgres connection alone is ~$5/mo. |
| Snapshot export | `tenants/:id/export` is literally `cp` the file out of S3. |
| Migrations | Same `migrations/NNNN_*.sql` runs on the tenant SQLite at pull-time. |

Postgres handles things that need cross-tenant queries (billing, sponsorship
totals, plugin marketplace stats, public telemetry dashboard).

## Tenant lifecycle

1. **Signup** → user creates account, Postgres `users` row, new `tenants`
   row with slug. Empty `shinobi.db` template is copied to S3 path
   `s3://shinobi-tenants/<tenant_id>/shinobi.db`.
2. **Dashboard load** → tenant runtime pod (Fly.io machine or equivalent)
   wakes up, downloads the tenant's `.db` into `/tmp/shinobi-<tenant>.db`,
   opens it with better-sqlite3 in WAL mode, serves the existing Hono
   dashboard bound to the tenant's subdomain.
3. **Writes** → standard SQLite writes through better-sqlite3. A
   background task watches the WAL size; every 30s of dirty time it runs
   `db.backup()` to a temp file, uploads with `If-Match` on the previous
   ETag (last-writer-wins per tenant — only one runtime pod per tenant
   anyway).
4. **Idle eviction** → after 10 minutes idle, runtime pod terminates;
   the final snapshot was already in S3. Next request boots a fresh pod.
5. **Export** → "Download my data" hands back the latest snapshot from
   S3 directly via signed URL.

## Routing one runtime per tenant

Fly.io has a "Fly Replay" header pattern that makes this easy: the
front-door HTTP service inspects the subdomain (or `?tenant=` for the
MCP stdio bridge), looks up which machine ID owns that tenant (or spawns
one), and returns `fly-replay: instance=...`. Cloudflare Workers + Durable
Objects (one DO per tenant) is the equivalent pattern.

Either way: stateful routing, not stateless load balancing. Multi-tenant
SQLite-per-tenant inherently disallows the second.

## Migration path for existing self-hosted users

Self-hosted users can opt into hosted at any time:

```sh
shinobi sync push                          # snapshot to git
# go to shinobi.dev/import, paste git URL, log in
# tenant created, snapshot pulled, sessions resume
shinobi config set SHINOBI_DASHBOARD_HOST=hosted   # optional: point local agents to hosted dashboard
```

Going back from hosted to self-hosted is "Download my data" + `cp` to
`~/.shinobi/shinobi.db` + `shinobi dashboard`. No lock-in.

## What lives in this repo (vs separate hosted-only repo)

The hosted runtime ships from a separate, private `shinobi-hosted` repo
because:
- It hard-codes our Stripe + R2 + Fly.io credentials.
- It contains the Postgres control plane schema + queries that only make
  sense at scale.

But everything below the runtime is shared with this repo:
- All MCP tools + handlers.
- All dashboard routes (the runtime just embeds the same Hono app).
- All migrations.

The boundary is intentional: anything that improves the OSS product also
improves the SaaS, and anything in the SaaS that does not need control-plane
context can be backported as a self-hosted plugin.

## Scope of this commit

This commit lays the **scoping documentation only**. The code paths for:

- Postgres control-plane schema
- R2 client + tenant snapshot upload/download
- Fly.io replay routing
- Stripe webhook handler

…land in the `shinobi-hosted` private repo since they require live
credentials to even type-check meaningfully. Tracking issues + a public
status update will land before the actual launch.

## Production environment checklist (when wiring up)

- [ ] Domain: shinobi.dev registered, DNS pointed
- [ ] TLS: Cloudflare proxy + origin cert (or Let's Encrypt via Caddy)
- [ ] App host: Fly.io org created, primary region picked, scaling policy set
- [ ] DB: Neon or Supabase Postgres provisioned for control plane
- [ ] Object store: Cloudflare R2 bucket `shinobi-tenants` with lifecycle
      rule for `.bak-*` files (delete after 30 days)
- [ ] Secrets: STRIPE_SECRET, STRIPE_WEBHOOK_SECRET, R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY, POSTGRES_URL — stored in Fly secrets
- [ ] Monitoring: BetterStack or Grafana Cloud for uptime + log tailing
- [ ] Backups: nightly pg_dump → R2 separate bucket, retain 30 days
- [ ] Status page: status.shinobi.dev (StatusPage.io free tier or
      Cachet self-hosted)
