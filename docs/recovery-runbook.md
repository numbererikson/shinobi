# Recovery runbook — when the brain goes down

The Shinobi server is the single shared brain: tasks, decisions, dead ends,
plans. This runbook is the tested path to bring it back when the container,
the VM, or the volume dies — written so it can be followed from a phone
(GCP browser SSH) on a bad beach connection.

It assumes the [GCP free-tier deploy](deploy-gcp-free.md): Docker container
`shinobi`, named volume `shinobi-data` mounted at `/data`, Cloudflare Tunnel
publishing `shinobi.yourdomain.com → 127.0.0.1:8765`, and nightly
`shinobi sync push` to a private GitHub snapshot repo.

## Before you leave (preflight checklist)

Recovery is only as good as what you can reach from a phone. Verify once,
at home:

- [ ] **Dashboard token** is in your password manager (every client and the
      restore procedure need it).
- [ ] **Sync-repo PAT** (fine-grained, Contents read/write on the sync repo
      only) is in your password manager — required to re-clone the backup.
- [ ] **GCP console** works on your phone (browser SSH included).
- [ ] **Cloudflare dashboard** login works on your phone.
- [ ] Last nightly backup is recent: `docker exec shinobi node /app/dist/cli.js sync status`
      shows a `last push` within 24h, and the sync repo on GitHub shows the
      commit.
- [ ] You ran the drill below at least once and know your restore time.

## Diagnose first

From any device: `https://shinobi.yourdomain.com/health`

| Symptom | Likely failure | Procedure |
| --- | --- | --- |
| `{"ok":true}` but MCP calls 503 from cloud sessions | Cloudflare min TLS raised above 1.2 | [D](#d-cloudflare-issues) |
| 502/530 from Cloudflare | Container or VM down, tunnel up | [A](#a-container-down-vm-alive), then [B](#b-vm-dead-or-deleted) |
| `ERR_NAME_NOT_RESOLVED` / tunnel shows `Routes: --` | Tunnel route lost | [D](#d-cloudflare-issues) |
| VM gone from GCP console / SSH unreachable | VM dead | [B](#b-vm-dead-or-deleted) |
| Health ok but data missing/corrupt | Volume damage | [C](#c-restore-database-from-backup) |

## A. Container down, VM alive

SSH to the VM (GCP console → VM instances → SSH):

```bash
docker ps -a                 # is the container there, just stopped?
docker start shinobi         # if stopped
docker logs --tail 50 shinobi
curl http://127.0.0.1:8765/health
```

If the container is gone (e.g. after a failed upgrade), re-run it — the
database lives on the volume and survives:

```bash
docker run -d --name shinobi --restart unless-stopped \
  -p 127.0.0.1:8765:8765 \
  -v shinobi-data:/data \
  -e SHINOBI_DASHBOARD_TOKEN=<token from password manager> \
  shinobi
```

Expected time: **2–5 minutes**.

## B. VM dead or deleted

Full rebuild on a fresh e2-micro. This is the long path — the Docker build
alone takes 10–15 minutes on the free tier. Follow
[deploy-gcp-free.md](deploy-gcp-free.md) steps 1–3 (VM + swap + Docker +
clone + build + run), with one difference: **use your existing dashboard
token** from the password manager in the `docker run`, so every client keeps
working without reconfiguration.

Then restore the database — see [C](#c-restore-database-from-backup).

Then re-attach the tunnel: Cloudflare → Zero Trust → Networks → Connectors.
The old connector will show disconnected. Either reinstall `cloudflared` on
the new VM with the existing tunnel's install command (Connectors → your
tunnel → Configure → copy the `cloudflared service install eyJ...` command),
or create a fresh tunnel and re-add the published application route
(`shinobi.yourdomain.com` → HTTP `localhost:8765`). No DNS migration needed.

> ⚠️ Keep Cloudflare **Minimum TLS at 1.2** on the new setup — see
> [deploy-gcp-free.md](deploy-gcp-free.md) for why raising it to 1.3 kills
> all MCP calls from Claude cloud sessions.

Expected time: **30–45 minutes**, dominated by the Docker build.

## C. Restore database from backup

The nightly `sync push` snapshots the DB into the private sync repo. To pull
that snapshot back into a running container:

```bash
# one-time on a fresh volume: clone the sync repo with the PAT
docker exec shinobi git clone https://YOUR_PAT@github.com/you/your-sync-repo.git /data/sync
docker exec shinobi git -C /data/sync config user.name "shinobi-server"
docker exec shinobi git -C /data/sync config user.email "shinobi@localhost"
docker exec shinobi node /app/dist/cli.js sync init /data/sync

# restore: pulls the repo and replaces the live DB with the snapshot
docker exec shinobi node /app/dist/cli.js sync pull
docker restart shinobi
curl http://127.0.0.1:8765/health
```

Mind the RPO: the snapshot is up to 24h old (nightly cron at 03:00).
Anything logged between the last push and the failure is gone — accept it,
or check whether a laptop session from that window can re-log key decisions.

After a restore, re-arm the nightly cron if the VM is new:

```bash
( crontab -l 2>/dev/null; echo '0 3 * * * docker exec shinobi node /app/dist/cli.js sync push' ) | crontab -
```

## D. Cloudflare issues

- **MCP 503s from cloud sessions only** (laptop works): someone or something
  raised Minimum TLS. Cloudflare → SSL/TLS → Edge Certificates → set
  **Minimum TLS Version = 1.2**.
- **Route lost** (`Routes: --` on the tunnel): re-add the published
  application route — Subdomain `shinobi`, Service Type HTTP,
  URL `localhost:8765`.
- **Cloudflare outage**: nothing to fix on your side. The brain and backups
  are unaffected; wait it out (degraded mode below).

## Verify recovery

From the phone, in order:

1. `https://shinobi.yourdomain.com/health` → `{"ok":true,...}`.
2. Dashboard loads with your token and shows your projects.
3. An MCP client (claude.ai chat with the Shinobi connector, or a Claude
   Code session) can run `list_projects` and sees real data.
4. `docker exec shinobi node /app/dist/cli.js sync status` shows sync
   configured, then run a manual `sync push` so a fresh snapshot exists.

## Degraded mode — what still works while the brain is offline

- Coding sessions (laptop, cloud) **work normally** — they just lose the
  shared memory tools. Code, git, deploys are unaffected.
- The discipline that matters: note decisions/dead-ends somewhere durable
  (commit messages, a scratch file) and re-log them via `log_decision` /
  `log_dead_end` once the brain is back. Don't stand up a second brain from
  a local copy — two diverging SQLite files are worse than a 24h gap.
- Approvals/push notifications are down with the server; fall back to
  reviewing PRs directly on GitHub mobile.

## The drill (run at home, before the vacation)

1. `docker stop shinobi` → confirm `/health` fails → run procedure A. ⏱
2. `docker stop shinobi && docker rm shinobi` → procedure A's re-run path. ⏱
3. Simulate volume loss on a **throwaway copy**: create a scratch volume,
   run a second container against it on another port, restore into it with
   procedure C. Never drill C against the live volume. ⏱
4. From your phone only (laptop closed): GCP SSH login → `docker ps` →
   Cloudflare dashboard login. If any login dance fails on the phone, fix
   it now.
5. Log the measured times and any surprises as dead ends/decisions in
   project "Shinobi remote MCP" — that's the institutional memory this tool
   exists for.
