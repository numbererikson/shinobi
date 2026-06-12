# Deploy Shinobi for $0/month: GCP free tier + Cloudflare Tunnel

End-to-end walkthrough for hosting your Shinobi brain on Google Cloud's
Always Free e2-micro VM, published over HTTPS with a free Cloudflare Tunnel —
no open ports, no static IP, no monthly bill. ~45 minutes.

This is the battle-tested version of [remote mode](remote-mcp.md): every
gotcha below was hit for real. Read the callouts.

## What you need

- Google account with billing enabled (card on file; the bill stays $0)
- Cloudflare account with your domain's DNS on Cloudflare (any plan, Free works)

## 1. Create the VM (GCP console)

[console.cloud.google.com](https://console.cloud.google.com) → Compute Engine
→ VM instances → **Create instance**:

| Setting | Value |
| --- | --- |
| Name | `shinobi` |
| Region | **us-central1, us-east1 or us-west1 only** — free tier is limited to these three |
| Machine type | General purpose → E2 → **Shared-core → e2-micro** |
| Boot disk | Debian 12, **30 GB**, type **Standard persistent disk** |
| Snapshot schedule | **None** — remove `default-schedule-1` if pre-attached |

> ⚠️ **The console defaults are NOT free.** It pre-selects e2-medium
> (~$25/mo), a 10 GB *Balanced* disk (charged), and sometimes attaches a
> snapshot schedule (charged). Change all three.
>
> ⚠️ **The estimate will still show ~$6/mo for e2-micro.** That's expected:
> the estimator doesn't know about the Always Free tier. The discount is
> applied on the invoice (Billing → Reports shows the charge and the
> offsetting credit). Verify after a few days.

Create, wait for the green check, then open the browser **SSH** button.

## 2. Swap, Docker, build (VM via SSH)

The 1 GB e2-micro cannot build Shinobi without swap — add it first:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Docker + clone + build:

```bash
sudo apt update && sudo apt install -y docker.io git
sudo usermod -aG docker $USER
exit   # reopen SSH so the docker group applies

git clone https://github.com/numbererikson/shinobi && cd shinobi
docker build -t shinobi .
```

> ⏳ The build takes 10–15 minutes on e2-micro and looks frozen during the
> TypeScript/Vite steps. It isn't. Wait for `Successfully tagged shinobi:latest`.

## 3. Run it

```bash
TOKEN=$(openssl rand -hex 24) && echo "SAVE THIS: $TOKEN"
docker run -d --name shinobi --restart unless-stopped \
  -p 127.0.0.1:8765:8765 \
  -v shinobi-data:/data \
  -e SHINOBI_DASHBOARD_TOKEN=$TOKEN \
  shinobi

curl http://127.0.0.1:8765/health   # → {"ok":true,...}
```

Save the token in your password manager — every client authenticates with it.

The `-v shinobi-data:/data` volume holds the SQLite database
(`/data/shinobi.db`); without it, replacing the container wipes your memory.

## 4. Cloudflare Tunnel

Cloudflare dashboard → **Zero Trust** (first time: pick the **Free** plan;
it asks for a card for anti-abuse verification — the plan bills $0 and
tunnels have no usage charges).

1. **Networks → Connectors** (a.k.a. Tunnels) → **Create a tunnel** →
   type **Cloudflared** → name `shinobi` → Save.
2. On "Install and run a connector": switch the OS dropdown to
   **Debian / 64-bit** (it defaults to Windows!) and run the **two** shown
   blocks in the VM's SSH — first installs `cloudflared` via apt, second
   (`sudo cloudflared service install eyJ...`) registers it as a systemd
   service. Skip the third "run manually" variant.
3. Wait for the connector to show **Connected**, then add the route — tab
   **Published application routes** → Add:
   - Subdomain: `shinobi`, Domain: your zone → `shinobi.yourdomain.com`
   - Service: Type **HTTP**, URL **`localhost:8765`** (the full value, not
     just the port)

> ⚠️ If the browser later says `ERR_NAME_NOT_RESOLVED`, the route didn't
> save — the tunnel list will show `Routes: --`. Re-add the published
> application route. Also make sure the domain you picked shows **Active**
> (not "Pending Nameserver Update") under Cloudflare → Websites.

Test from any device: `https://shinobi.yourdomain.com/health` → `{"ok":true}`.
Opening `/` without a token shows the auth wall — that's the security
working. Log in once with `https://shinobi.yourdomain.com/?token=YOUR_TOKEN`.

## 5. Migrate an existing local database (optional, one-time)

If you've been running Shinobi locally, move your brain up:

1. On your machine: close every client using Shinobi (editor sessions,
   dashboard), then locate `~/.shinobi/shinobi.db`
   (Windows: `C:\Users\<you>\.shinobi\shinobi.db`).
2. In the browser SSH window use **Upload file** to drop `shinobi.db` into
   your VM home directory.
3. On the VM, place it into the volume and restart:

```bash
docker stop shinobi
docker run --rm -v shinobi-data:/data -v "$HOME":/host node:22-slim \
  bash -c 'cp /data/shinobi.db /data/shinobi.db.bak 2>/dev/null; cp /host/shinobi.db /data/shinobi.db && rm -f /data/shinobi.db-wal /data/shinobi.db-shm'
docker start shinobi
curl http://127.0.0.1:8765/health
```

Open the dashboard — your projects, decisions and dead ends are there.
From now on the server is the single brain; point all clients at it and
retire the local database.

## 6. Connect clients

See [remote-mcp.md → Connecting clients](remote-mcp.md#connecting-clients).
Short version:

```bash
claude mcp add --transport http shinobi https://shinobi.yourdomain.com/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

## Ongoing costs & care

- **GCP**: $0 while this is your only e2-micro in a free region with a
  ≤30 GB standard disk. Check Billing → Reports once after the first week.
- **Cloudflare**: $0 (tunnel + DNS on Free plan).
- **Upgrades**: `cd ~/shinobi && git pull && docker build -t shinobi . `
  then `docker stop shinobi && docker rm shinobi` and re-run the
  `docker run` command from step 3 (same token). The database lives on the
  volume and survives.
- **Backups**: the volume survives container replacement but not project
  deletion. Wire `shinobi sync` to a private git repo (git is included in
  the image):

  ```bash
  # one-time: fine-grained GitHub PAT with Contents read/write on the sync repo
  docker exec shinobi git clone https://YOUR_PAT@github.com/you/your-sync-repo.git /data/sync
  docker exec shinobi git -C /data/sync config user.name "shinobi-server"
  docker exec shinobi git -C /data/sync config user.email "shinobi@localhost"
  docker exec shinobi node /app/dist/cli.js sync init /data/sync
  docker exec shinobi node /app/dist/cli.js sync push   # test it

  # nightly cron on the VM host:
  ( crontab -l 2>/dev/null; echo '0 3 * * * docker exec shinobi node /app/dist/cli.js sync push' ) | crontab -
  ```

  The clone lives on the `/data` volume, so credentials and git config
  survive container upgrades.

  > ⚠️ If the first push dies with `RPC failed; curl 55 ... unexpected
  > disconnect` (common when sending multi-MB binary snapshots from small
  > VMs over HTTP/2), pin the repo to HTTP/1.1 and raise the post buffer —
  > both stick because the config lives on the volume:
  >
  > ```bash
  > docker exec shinobi git -C /data/sync config http.version HTTP/1.1
  > docker exec shinobi git -C /data/sync config http.postBuffer 157286400
  > ```
