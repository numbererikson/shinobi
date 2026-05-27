# Shinobi marketing site

Static HTML/CSS, zero build step. Currently deployed to Cloudflare
Workers (static asset) at https://shinobi.numbererikson.workers.dev.

## Local preview

```sh
cd marketing-site
python3 -m http.server 4000   # or `npx serve .` if you prefer
# open http://localhost:4000
```

## Deploy

Currently a manual drag-and-drop upload from this folder into Cloudflare
Workers → shinobi project → New deployment. Auto-deploy via Git was
skipped at launch because Cloudflare's framework auto-detection picks
up Hono from the parent package.json and tries to treat the deploy as
a Worker function rather than static assets.

To re-deploy after edits:

1. Cloudflare → Workers & Pages → shinobi → Deployments tab
2. "Create deployment" → drag the contents of this folder
3. Deploy

## Edit checklist before going live

- [x] Email mailto links → `contact@shinobi-apps.hr`
- [x] Cloudflare Web Analytics beacon wired
- [x] CTA "Get early access" → "Join waitlist" (honest signaling)
- [ ] Wire Team/Pro buttons to a real waitlist form (Tally / Formspree)
      — currently mailto fallback
- [ ] Open Graph image: drop a `og-image.png` at the root + add
      `<meta property="og:image" content="...">` once designed
- [ ] PNG favicon variants (currently SVG only) for older browsers
- [ ] Future: custom domain `mcp.shinobi-apps.hr` (Faza 9 post-launch
      after DNS migration to Cloudflare)

## What this site IS

- Above-the-fold pitch + install snippet + GitHub CTA
- Feature grid (6 cards covering the things you actually shipped)
- Install instructions
- Three-tier pricing card (Self-hosted free, Team / Pro waitlist)
- Open-source pitch + repo link

## What this site IS NOT (yet)

- A blog (link out to Hashnode + dev.to)
- A docs site (link out to repo README + docs/ folder)
- A signup form for the hosted plan (that ships when the SaaS runtime
  is live)

## Color palette

Mirrors the dashboard (`bg=#0f1216`, `accent=#7cb7ff`) so visitors who
install Shinobi see a familiar UI when the dashboard opens.
