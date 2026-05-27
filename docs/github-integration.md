# GitHub deep integration

Shinobi listens for GitHub webhook events and automates three flows:

| GitHub event | What Shinobi does |
|---|---|
| **PR opened/edited** with `[SHI-N]` in title or body | Links the PR to subtask N (`pr_links` table), records `pr_opened` activity |
| **PR merged** | Auto-flips the linked subtask to `done`, records `subtask_auto_completed` activity with the merge URL |
| **PR comment** matching `/shinobi decision <kind>: <summary>` | Logs a decision (`logDecision`) on the project, linked to the subtask |

The `<kind>` values recognised: `architecture`, `library`, `pattern`,
`tradeoff`, `workaround`, `other`. Anything else falls back to `other`.

## Setup

### 1. Set the shared HMAC secret

Generate a random string and set it both on GitHub and on the agent:

```sh
# Generate
openssl rand -hex 32
```

Add it to `~/.shinobi/.env`:

```ini
SHINOBI_GITHUB_WEBHOOK_SECRET=<the-hex-string>
```

Restart the dashboard. The endpoint `/api/github/webhook` now refuses any
request whose `X-Hub-Signature-256` does not match.

### 2. Expose the dashboard

The webhook URL must be reachable from GitHub. Easiest paths:

- **Cloudflare Tunnel** (recommended for ad-hoc use):
  ```sh
  cloudflared tunnel --url http://127.0.0.1:8765
  ```
  Use the printed `https://...trycloudflare.com/api/github/webhook` URL.

- **Persistent Tailscale Funnel / named CF Tunnel / public bind** with auth
  forced on (see [`remote-access.md`](remote-access.md)).

### 3. Add the webhook on GitHub

Repository → Settings → Webhooks → Add webhook:

- **Payload URL**: `<your-public-base>/api/github/webhook`
- **Content type**: `application/json`
- **Secret**: same string you set in `~/.shinobi/.env`
- **Events**: select individual events:
  - Pull requests
  - Issue comments
- **Active**: ✓

GitHub sends a `ping` event on save — Shinobi responds with `pong` so you
should see a green check in the Webhook → Recent Deliveries panel.

## Tag syntax

Any PR title or body containing `[SHI-42]` (case-insensitive) links to
subtask #42. Example PR title:

```
[SHI-185] feat: GitHub webhook receiver
```

## Decision comment syntax

In any PR comment:

```
/shinobi decision architecture: Switched from REST polling to WebSocket relay
to support real-time multi-agent sync. Trade-off: requires Cloudflare Worker
deployment but saves git push round-trips.
```

The first line becomes the decision `summary`; the full body becomes the
`rationale`. The decision attaches to the same subtask + project as the PR.

## What Shinobi does NOT do (yet)

- Post comments back to GitHub on subtask completion. The plumbing is
  scaffolded (`SHINOBI_GITHUB_TOKEN` setting reserved) but the outbound
  request is not implemented in this release.
- Auto-create PRs from subtasks.
- Reconcile force-pushed branches or rewritten commits.

## Inspecting linked PRs

```sh
curl http://127.0.0.1:8765/api/projects/36/pr-links
```

Returns the most recent 50 links for the project, ordered by `opened_at`
descending, with `state` (`open` / `closed` / `merged`) and timestamps.

## Troubleshooting

- **401 invalid signature** — the secret on GitHub does not match the one
  in `~/.shinobi/.env`. Re-paste both.
- **503 SHINOBI_GITHUB_WEBHOOK_SECRET not configured** — the env var is
  empty; restart the dashboard after editing the file.
- **PR opens but no link created** — no `[SHI-N]` tag found, or the subtask
  with that ID doesn't exist. Check the recent deliveries on GitHub to see
  the dispatch outcome (`no_tag` / `subtask_not_found`).
