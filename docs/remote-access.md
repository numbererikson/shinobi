# Remote access — reach the Shinobi dashboard from anywhere

Out of the box, `shinobi dashboard` binds to `127.0.0.1:8765`. The web UI and
JSON API are only reachable from the same machine. This is the safe default —
you should opt-in deliberately before exposing the dashboard to the internet.

Two practical paths to reach the dashboard from a phone, tablet, or another
laptop:

| Path | Trust model | Best when |
|------|-------------|-----------|
| **Tailscale** (recommended) | Mesh VPN, devices only see each other if both are logged in to the same tailnet | You want zero public exposure and trust the Tailscale account |
| **Cloudflare Tunnel** | Public URL fronted by Cloudflare with auth required | You want a phone-friendly `https://...` URL without VPN setup |

Both paths require **dashboard auth enabled**. The dashboard auto-enables auth
whenever it binds to anything other than a loopback address (`127.0.0.1`,
`localhost`, `::1`). If you change the bind host, also do a one-time
`shinobi dashboard` run to capture the printed `?token=...` URL.

---

## Option A — Tailscale (recommended)

Tailscale is a WireGuard-based mesh VPN. Devices on the same tailnet can reach
each other by stable `100.x.y.z` IP (or magic DNS hostname like
`mylaptop.tailnet.ts.net`) without opening any port on your router or any
public URL.

### 1. Install on the dashboard host

```sh
# macOS / Linux
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

```powershell
# Windows: download installer from https://tailscale.com/download/windows
# Then run from elevated PowerShell:
tailscale up
```

Authorize the machine via the browser link Tailscale prints.

Note your tailnet IP:

```sh
tailscale ip -4
# e.g. 100.101.102.103
```

### 2. Install on the phone

- iOS: <https://apps.apple.com/app/tailscale/id1470499037>
- Android: <https://play.google.com/store/apps/details?id=com.tailscale.ipn>

Log in to the same Tailscale account.

### 3. Bind the dashboard to your tailnet IP

In `~/.shinobi/.env`:

```ini
SHINOBI_DASHBOARD_HOST=0.0.0.0
SHINOBI_DASHBOARD_PORT=8765
```

> `0.0.0.0` binds to *every* network interface — including your LAN. If you
> want strictly tailnet-only, use the Tailscale IP from step 1 directly:
> `SHINOBI_DASHBOARD_HOST=100.101.102.103`. macOS/Linux tend to allow binding
> to the Tailscale IP cleanly; Windows sometimes does not, in which case
> `0.0.0.0` + Windows Firewall scoping is the practical workaround.

Restart the dashboard:

```sh
shinobi dashboard
```

The startup log now reads:

```
shinobi dashboard: listening on http://0.0.0.0:8765
shinobi dashboard: auth ON (non-loopback bind)
  token file: /home/you/.shinobi/dashboard-token
  open once:  http://0.0.0.0:8765/?token=<random-64-chars>
```

### 4. Open from the phone

In your phone browser, visit:

```
http://100.101.102.103:8765/?token=<token from the log>
```

Once opened, the token is stored as a cookie and you do not need to paste it
again on that device.

### 5. Save to home screen (PWA install)

The dashboard ships a web manifest + service worker, so you can install it as
a PWA — looks like a native app, opens fullscreen. On iOS: Share → Add to Home
Screen. On Android: ⋮ → Install app.

This also enables push notifications (see `/push` page) which is the killer
combo with the `request_approval` MCP tool.

---

## Option B — Cloudflare Tunnel (no VPN)

Cloudflare Tunnel (cloudflared) creates an outbound-only connection from your
machine to Cloudflare and gives you a public `https://...trycloudflare.com`
URL — no port forwarding, no public IP exposure.

### 1. Install cloudflared

```sh
# macOS
brew install cloudflared

# Linux (Debian/Ubuntu)
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Windows: install via winget
winget install --id Cloudflare.cloudflared
```

### 2. Spawn an ad-hoc tunnel

Keep the dashboard bound to `127.0.0.1` (the default) — cloudflared connects
to it locally.

```sh
shinobi dashboard          # one terminal
cloudflared tunnel --url http://127.0.0.1:8765   # another terminal
```

cloudflared prints something like:

```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at:                                          |
|    https://chunky-words-fall-here.trycloudflare.com                                        |
+--------------------------------------------------------------------------------------------+
```

### 3. Force auth on (the bind is still loopback)

The dashboard auto-enables auth for non-loopback binds. Because cloudflared
connects over `127.0.0.1`, you must force-enable auth so the tunneled
endpoint is not an open door:

```ini
# ~/.shinobi/.env
SHINOBI_DASHBOARD_HOST=127.0.0.1
SHINOBI_DASHBOARD_PORT=8765
SHINOBI_DASHBOARD_AUTH=on
# Optional — supply your own token; otherwise one is generated at
# ~/.shinobi/dashboard-token on first run:
# SHINOBI_DASHBOARD_TOKEN=<64-hex-chars>
```

Restart the dashboard. The first non-`/health` request without a valid
`?token=`, `Authorization: Bearer`, `x-shinobi-token`, or cookie is rejected
with `401`. Visit the public tunnel URL once with `?token=<value>` appended;
the dashboard sets a 30-day cookie and you do not need to paste it again on
that device.

You can read the generated token from `~/.shinobi/dashboard-token` at any
time. Rotate it by deleting that file (next start regenerates) or by setting
`SHINOBI_DASHBOARD_TOKEN` to a new value.

### 4. Persistent named tunnel (optional)

The ad-hoc URL rotates on every restart. For a stable URL:

```sh
cloudflared tunnel login
cloudflared tunnel create shinobi
# Map a hostname (requires a Cloudflare-managed domain):
cloudflared tunnel route dns shinobi shinobi.example.com
# Run:
cloudflared tunnel run shinobi
```

---

## Security checklist

Before exposing the dashboard, verify:

- [ ] Bind is non-loopback OR a tunnel is in front → **dashboard auth is ON**
- [ ] Token is at least 32 hex characters (default) and only shared on trusted devices
- [ ] `~/.shinobi/.env` is `chmod 600` (your secret keys live there)
- [ ] If using Cloudflare Tunnel, the named hostname is behind Cloudflare Access (Zero Trust → Access → Application) for SSO instead of a static token
- [ ] You restart the dashboard after any change to bind host/port/auth (these settings have `requiresRestart=true`)

## Combining with web push

Once the dashboard is reachable from your phone via Tailscale, also subscribe
the phone to push notifications via the `/push` page. This way:

1. Agent calls `request_approval` from MCP.
2. Phone gets a push notification with `[yes] [no]` action buttons.
3. Tap a button → response posts back even if the dashboard tab is closed.
4. MCP tool unblocks within ~1 second.

You can be on a beach and still gate AI agent decisions.

## Combining with multi-agent relay

See [`relay.md`](relay.md). If you set up both, every `shinobi sync push`
broadcasts to peer agents, and every peer auto-pulls within ~1.5 seconds.
Approvals + relay + push together turn Shinobi into a real-time coordination
fabric across all your machines.
