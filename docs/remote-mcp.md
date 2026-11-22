# Remote mode: one Shinobi brain for every device

By default Shinobi runs local-first: the MCP server speaks stdio and the
SQLite database lives in `~/.shinobi/` on one machine. Remote mode exposes the
same 38 tools over MCP **streamable HTTP** so any MCP client — Claude Code
(desktop *and* web/mobile sessions), Cursor, Cline, Continue.dev, Zed — can
share a single brain hosted on a server you control.

```
laptop: VS Code + Claude Code ──┐
                                ├──► https://your-host/mcp ──► one SQLite brain
phone: Claude Code web session ─┘         (token auth)
```

Decisions logged from your desk are known to the session you open from your
phone, and vice versa. Sessions stay disposable; the memory doesn't.

## How it works

`shinobi serve` starts the dashboard and mounts the MCP endpoint at `/mcp` in
the same process (same port). The endpoint is stateless — every POST gets a
fresh server over the shared tool registry — so it survives restarts and works
behind load balancers.

Auth reuses the dashboard token middleware:

- loopback bind (`127.0.0.1`) → auth off, same as the local dashboard
- any other bind → token auth **on automatically**; clients send
  `Authorization: Bearer <token>`
- the token comes from `SHINOBI_DASHBOARD_TOKEN`, or is generated once and
  stored at `<config-dir>/dashboard-token`

> **Never** expose a non-authenticated bind to the internet. The MCP tools
> can read and write your entire project memory. Always front the endpoint
> with HTTPS (reverse proxy or your platform's TLS).

> 💸 Want this for $0/month? Follow the step-by-step
> [GCP free tier + Cloudflare Tunnel walkthrough](deploy-gcp-free.md).

## Quickstart: Docker Compose (recommended)

```bash
mkdir ~/shinobi-server && cd ~/shinobi-server
curl -fsSLO https://raw.githubusercontent.com/numbererikson/shinobi/main/compose.yaml
umask 077 && echo "SHINOBI_DASHBOARD_TOKEN=$(openssl rand -hex 24)" > shinobi.env
docker compose up -d
docker compose ps        # STATUS shows (healthy) after ~20 s
```

Read the token later with `grep TOKEN ~/shinobi-server/shinobi.env`; it is
never printed in logs. Upgrade with:

```bash
cd ~/shinobi-server && docker compose pull && docker compose up -d
```

Optional nightly auto-upgrade (04:17), which skips the restart when nothing changed:

```bash
( crontab -l 2>/dev/null; echo '17 4 * * * cd $HOME/shinobi-server && docker compose pull -q && docker compose up -d' ) | crontab -
```

Plain `docker run` works too:

```bash
docker run -d --name shinobi --restart unless-stopped \
  -p 127.0.0.1:8765:8765 \
  -v shinobi-data:/data \
  --env-file shinobi.env \
  shinobiapps/shinobi:latest
```

The volume on `/data` is **mandatory in practice** — the SQLite database
lives there (`SHINOBI_CONFIG_DIR=/data`); without it every restart wipes your
memory.

Then put HTTPS in front, e.g. Caddy:

```
shinobi.example.com {
    reverse_proxy 127.0.0.1:8765
}
```

## Quickstart: bare Node (no Docker)

```bash
npm install -g @shinobiapps/shinobi
SHINOBI_DASHBOARD_TOKEN="$(openssl rand -hex 24)" \
  shinobi serve --host 0.0.0.0 --port 8765
```

Same rules: non-loopback bind enables token auth; front with HTTPS.

## Connecting clients

**Two endpoints:**

| URL | Offers | Use it for |
| --- | --- | --- |
| `/mcp` | every enabled module (Development + plugins) | Claude Code, Cursor, … (coding) |
| `/mcp/home` | every enabled module **except Development** | the Claude app / phone chat (music, AdGuard, reminders, …) |

The phone chat then loads only the home tools, not the ~40 development
tools, so it starts faster and stays focused. Both endpoints use the same
auth, and OAuth tokens work on both.

**Claude app / claude.ai (custom connector, OAuth):** Settings → Connectors →
Add custom connector. Enter **only the URL** `https://shinobi.example.com/mcp/home` (or `/mcp` if you also code from that chat):
no token, no headers, "No sign-in" not needed. Press **Connect**. The Shinobi
consent page opens. Enter your dashboard token once (or just press Allow if
you are signed in to the dashboard in that browser), and Claude receives its
own short-lived access token with a rotating refresh token. The connector
syncs to the phone app. Connected apps are listed in the dashboard under
**Settings → Connected apps**, where each one can be revoked.

Under the hood this follows the MCP authorization spec:
- `/mcp` answers 401 with `WWW-Authenticate: Bearer resource_metadata=…`;
- metadata lives at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`;
- clients register dynamically at `/oauth/register`, then use authorization code + PKCE (S256) and refresh-token rotation (`/oauth/token`).

Codes and tokens are stored only as SHA-256 hashes. OAuth tokens are accepted
on `/mcp` only, never on the dashboard API. The dashboard token keeps working
everywhere as before.

**Claude Code (CLI / VS Code extension):**

```bash
claude mcp add --transport http shinobi https://shinobi.example.com/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

**Claude Code on the web:** add the same URL + header in your environment's
MCP server configuration.

**Cursor / Cline / Continue.dev / Zed** (any client supporting remote MCP):

```json
{
  "mcpServers": {
    "shinobi": {
      "url": "https://shinobi.example.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

**Make every session start informed** — add to your project's `CLAUDE.md`
(or rules file):

```markdown
At the start of each session, call the shinobi `agent_bootstrap` tool for the
active project to load decisions, dead ends, context and open tasks. Before
implementing a new approach, call `check_dead_ends`. Log decisions and dead
ends as you go; call `session_closeout` before finishing.
```

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `SHINOBI_MCP_HTTP` | `off` | Set `on` to expose `/mcp` from `shinobi dashboard` (the `serve` command implies it) |
| `SHINOBI_DASHBOARD_HOST` | `127.0.0.1` | Bind address (`serve --host` overrides) |
| `SHINOBI_DASHBOARD_PORT` | `8765` | Port (`serve --port` overrides) |
| `SHINOBI_DASHBOARD_TOKEN` | generated | Bearer token for dashboard + `/mcp` |
| `SHINOBI_DASHBOARD_AUTH` | auto | `on`/`off` override; auto = on for non-loopback binds |
| `SHINOBI_CONFIG_DIR` | `~/.shinobi` | Database + config location (Docker image sets `/data`) |
| `SHINOBI_DB_PATH` | `<config-dir>/shinobi.db` | Explicit database file override |
| `SHINOBI_OAUTH` | on | `off` disables the OAuth endpoints (bearer token only) |
| `SHINOBI_PUBLIC_URL` | from request | Public origin used in OAuth metadata, e.g. `https://shinobi.example.com` (normally derived from the tunnel's `X-Forwarded-*` headers) |

## FAQ

**Does local mode still work?** Yes, nothing changes — stdio (`shinobi mcp`)
remains the default and the npm install flow is untouched. Remote mode is the
same binary with a different transport.

**Can I keep a local copy of the brain?** Yes — `shinobi sync` (git snapshot
push/pull) works on the server like anywhere else, so the hosted database can
be backed up to a private git repo and pulled to any machine.

**Multiple people?** Remote mode is designed for one operator across many
devices. The token grants full read/write; don't share it as a team auth
scheme.
