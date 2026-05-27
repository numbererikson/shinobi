# Shinobi relay — multi-agent real-time sync

The relay broadcasts `sync-available` events between multiple agents working on
the same workspace, so that running `shinobi sync push` on machine A causes
machine B to auto-pull the new snapshot within ~1.5 seconds (vs. polling git
manually).

It is fully optional. Without it, cross-machine sync still works via
`shinobi sync push` + `shinobi sync pull` on demand.

## Architecture

```
┌─────────────────┐         WebSocket             ┌──────────────────────┐
│ agent A (laptop)│ ─────────────────────────────▶│ Cloudflare Worker    │
│  shinobi dashb. │ ◀───────  re-broadcast ──────▶│  + Durable Object    │
└─────────────────┘                                │   (per workspace)    │
                                                   └──────────────────────┘
┌─────────────────┐         WebSocket                     ▲
│ agent B (phone) │ ──────────────────────────────────────┘
│  shinobi dashb. │
└─────────────────┘
```

The Worker is essentially a thin pub/sub: it does not persist events, does not
inspect payloads, and re-broadcasts every message it receives to every other
socket in the same workspace (`Durable Object` keyed by `idFromName(workspace)`).

## Setup

### 1. Deploy the Worker

```sh
cd relay-worker
npm install
npx wrangler login         # one-time
npx wrangler deploy
```

The deploy command prints the Worker URL, e.g.
`https://shinobi-relay.<your-account>.workers.dev`. The WebSocket endpoint is
the same host with `wss://` and path `/ws`.

### 2. Set the shared secret

```sh
cd relay-worker
npx wrangler secret put SHINOBI_RELAY_TOKEN
```

Paste any strong random value when prompted. This token must match
`SHINOBI_RELAY_TOKEN` configured on each agent.

> Skipping this step leaves the relay open to anyone who knows your Worker URL.
> Only acceptable for short-lived dev experiments.

### 3. Configure each agent

In each machine's `~/.shinobi/.env`:

```ini
SHINOBI_RELAY_URL=wss://shinobi-relay.<your-account>.workers.dev/ws
SHINOBI_RELAY_TOKEN=<the same secret you put on the Worker>
SHINOBI_RELAY_WORKSPACE=personal
```

`SHINOBI_RELAY_WORKSPACE` is any string — agents that share the same string
share a relay channel. Use `personal` for your own machines, or a team name
to coordinate with others.

Restart the dashboard:

```sh
shinobi dashboard
```

Open `http://localhost:8765/relay` to verify the connection. The page polls
status every 3 seconds and exposes a manual broadcast test button.

## Protocol

Every WebSocket message is a JSON envelope:

```ts
{
  type: 'sync-available' | 'activity' | 'presence',
  workspace: string,
  source_agent: string,
  ts: string,                       // ISO-8601
  payload: Record<string, unknown>
}
```

The client ignores messages where `source_agent === own_agent_id` to avoid
self-loops.

Currently the only event the client *reacts* to is `sync-available`, which
debounces a call to `syncPull()` 1.5 seconds after receipt.

## Cost

Cloudflare Workers + Durable Objects free tier covers:
- 100,000 requests/day
- 100 GB-s of Durable Object time
- 1 GB egress

A single agent generating 10 sync events/day across a 2-machine setup is
well under 1% of the free tier.
