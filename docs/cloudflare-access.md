# Cloudflare Access in front of the dashboard

The dashboard already needs the token, but anyone who finds the address can
reach the sign-in page and try to guess it. Cloudflare Access adds a second
lock in front: an email login handled by Cloudflare. The request never
reaches Shinobi until the login has passed.

- You log in **once per device per month**, not on every visit.
- Claude keeps working. `/mcp`, the OAuth pages and `/health` bypass Access,
  because Claude cannot answer an email login. Those paths are still
  protected by Shinobi's own OAuth and token checks.
- It is free for up to 50 users on the Zero Trust Free plan.

Needs a Cloudflare Tunnel or proxied DNS record for the host (orange cloud),
e.g. `shinobi.example.com`.

## 1. Login method

Zero Trust → **Settings → Authentication → Login methods**. **One-time PIN**
is there by default: Cloudflare emails a 6-digit code. To skip the code,
add **GitHub** or **Google** instead.

## 2. The dashboard application (login required)

Zero Trust → **Access → Applications → Add an application → Self-hosted**:

| Field | Value |
| --- | --- |
| Application name | `Shinobi dashboard` |
| Session duration | **1 month** |
| Public hostname | subdomain `shinobi`, domain `example.com`, path empty |

Policy: name `Me`, action **Allow**, include **Emails** → your address (add
family or friends here later). Save.

## 3. The open paths (bypass)

Add a second **Self-hosted** application. Access uses the most specific path,
so these entries win over the dashboard application:

| Field | Value |
| --- | --- |
| Application name | `Shinobi API (bypass)` |
| Public hostnames | the same host, once per path below |

Paths:

```
mcp
mcp/*
oauth/*
.well-known/*
health
manifest.webmanifest
icon-192.png
icon-512.png
icon-192.svg
apple-touch-icon.png
```

- `mcp`, `oauth/*`, `.well-known/*`: Claude's connector and its OAuth flow.
- `health`: uptime monitors.
- The manifest and icons: browsers fetch them without cookies when you add
  the dashboard to the home screen.
- `api/github/webhook`: add it too if you use the GitHub webhook.

Policy: name `Everyone`, action **Bypass**, include **Everyone**. Save.

## 4. Check it

1. In a private browser window, open `https://shinobi.example.com`. The
   Cloudflare login appears. After it, Shinobi's own sign-in appears (once per
   30 days).
2. Open `https://shinobi.example.com/health`. It shows `{"ok":true,...}` with
   no login.
3. In the Claude app, start a new chat and ask for something that uses
   Shinobi. If the connector asks to reconnect, press **Connect**. The
   consent page is on a bypassed path.

## Phone app (home-screen dashboard) and push

- The installed app on iOS keeps its own cookies, separate from Safari. It
  shows the Cloudflare login once, then once a month.
- Push notifications are unaffected. They travel from Apple's or Google's
  push service to the phone, not through Access. Tapping one opens the app,
  which is still signed in within the month.
- When the month ends, the next open shows the Cloudflare login again.

## If something breaks

| Symptom | Cause |
| --- | --- |
| Claude says the connector failed or needs auth again and again | A bypass path is missing. Check `mcp`, `mcp/*`, `oauth/*`, `.well-known/*`. |
| Home-screen icon is blank | The manifest or icons are not bypassed. |
| Login on every visit | Session duration is not set to 1 month on the dashboard application, or the browser blocks cookies. |
| Every Claude call fails right after enabling something in Cloudflare | Minimum TLS was raised above 1.2. Set it back to 1.2. |
