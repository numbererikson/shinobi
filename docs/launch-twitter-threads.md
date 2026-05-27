# Build-in-public Twitter threads

Templates for the daily / weekly threads that feed the build-in-public
narrative leading into launch. Each thread is fewer than 5 tweets;
the goal is to ship one or two per week starting now, then daily
during launch week.

Each thread block below has:
- **Trigger** — when to post it (event-based, not just calendar-based)
- **Hook** — the first tweet (most important; this is what people see)
- **Body** — the supporting tweets
- **CTA** — the final tweet's link

Pacing: don't fire all of these at once. Threads work because they
build a narrative arc over weeks.

---

## Thread 1 — "Why I built this"

**Trigger:** Pin to profile at launch; first post when you start
build-in-public.

**Hook:**
> Three months of pair-programming with Claude Code taught me one thing:
> the agent has the memory of a goldfish.
>
> Every session starts from scratch. Every decision has to be re-litigated.
>
> So I built the missing piece. 🧵

**Body:**
> 2/ The problem: Claude is brilliant inside a single chat. Across
> sessions, it forgets which library you picked, what you already
> tried, what you decided to skip. You spend half the next session
> re-explaining.

> 3/ Tried the obvious fixes. README files get out of date. Notion
> integration is too slow. Markdown in `.claude/` is plain text — no
> querying, no FTS, no relations.

> 4/ Shinobi is an MCP server + local SQLite + dashboard. The agent
> calls `claim_task`, `log_decision`, `check_dead_ends`, `recall` —
> just like any other tool. The data lives in `~/.shinobi/shinobi.db`.

**CTA:**
> 5/ MIT-licensed. Install with one npm command. Self-host forever.
>
> https://shinobi.numbererikson.workers.dev

---

## Thread 2 — "Approvals from the beach"

**Trigger:** When the mobile push feature has been working for >1 week
in your own setup. Post when you have a concrete story to tell.

**Hook:**
> I let Claude run for two hours yesterday on a database migration.
>
> I was at the beach.
>
> Phone buzzed. "About to drop legacy table. Confirm?"
>
> Tapped yes. Walked back into the water.

**Body:**
> 2/ The agent doesn't decide alone. It calls `request_approval`,
> blocks, fires a web push to my phone, polls for the response, then
> branches.

> 3/ Web push with action buttons. Tap "yes" or "no" right on the
> notification — no need to open the app. The agent unblocks within
> a second.

> 4/ Tailscale to reach my laptop's dashboard from the phone. No public
> URLs, no third party in the loop. Just my devices.

**CTA:**
> 5/ This is the part that turned Claude from "a tool I babysit" into
> "a coworker that asks before doing anything irreversible".
>
> <Hashnode blog URL — fill in on launch day>

---

## Thread 3 — "Two laptops, one workspace"

**Trigger:** When the relay has been running for a week.

**Hook:**
> Desktop's Claude Code working on backend. Laptop's Cursor working on
> frontend. Same project. Both reading the same task list, same
> decision log.
>
> No manual git pull. Ever.

**Body:**
> 2/ 100-line Cloudflare Worker with a Durable Object per workspace.
> When one machine pushes, the other auto-pulls within ~1.5s. Pure
> pub/sub — the worker stores nothing.

> 3/ Free tier covers ~100k events/day. Realistically you'll generate
> 30 a day. The whole thing costs nothing.

> 4/ Code is in the repo: relay-worker/src/index.ts. The whole worker
> is fewer lines than the typical "set up websockets on Node" tutorial.

**CTA:**
> 5/ Walkthrough: <Hashnode blog URL — fill in on launch day>

---

## Thread 4 — Launch announcement

**Trigger:** Day of HN Show / Product Hunt launch.

**Hook:**
> 🥷 Shinobi launches today.
>
> Three months ago: "I'm tired of re-explaining things to Claude."
>
> Today: A task spine + memory layer + mobile approvals + multi-machine
> sync, all local-first, all MIT-licensed.

**Body:**
> 2/ What it solves: your AI agent forgets between sessions. Shinobi
> gives it a SQLite-backed memory of tasks, decisions, dead-ends,
> meeting notes — queryable in 60s.

> 3/ What's in v1.0: MCP server, dashboard, voice capture, mobile push
> approvals, multi-agent relay, VS Code extension, Cursor extension,
> token cost tracking, GitHub PR linking, plugin marketplace.

> 4/ Self-host free forever. Hosted SaaS waitlist open (Team $19,
> Pro $79 — early access). The hosted version uses the same SQLite
> schema — you can always download your data and move back to local.

**CTA:**
> 5/ HN thread: <fill in on launch day>
> Repo: https://github.com/numbererikson/shinobi
> Web: https://shinobi.numbererikson.workers.dev

---

## Thread 5 — "Why I picked SQLite-per-tenant for the SaaS"

**Trigger:** Day after launch when there are technical questions in
the HN thread; deepen the technical conversation.

**Hook:**
> "Why do hosted SaaS apps usually pick Postgres for everything?"
>
> Habit, mostly. Here's why I went with SQLite-per-tenant for Shinobi's
> hosted version 👇

**Body:**
> 2/ The self-hosted Shinobi is one SQLite file. The hosted version
> needs to keep the same schema, same migrations, same MCP tools —
> otherwise the "download your data, run it locally" promise breaks.

> 3/ Shared Postgres for cross-tenant things (auth, billing, plugin
> registry). Per-tenant SQLite snapshots in R2. Fly Replay routes
> requests to the runtime pod that has that tenant's DB mounted.

> 4/ Cost floor: an inactive free-tier user costs ~$0 in R2 storage.
> A Postgres connection alone is ~$5/mo. The economics flip
> dramatically at the long tail.

**CTA:**
> 5/ Whole architecture document is public:
> https://github.com/numbererikson/shinobi/blob/main/docs/hosted-saas-architecture.md

---

## Quick-fire one-liners (mix into the timeline between threads)

> Voice capture → Whisper transcript → LLM extracts decisions → you
> review on the Drafts tab. Three taps to get a meeting recap into
> the project memory.

> Pre-flight check: `shinobi cost ingest` parses your Claude Code
> transcripts and tells you exactly how much each subtask cost. Reality
> check before quoting a client.

> The dashboard is a PWA. Install to home screen on iOS or Android.
> Reads offline, writes when reconnected.

> @shinobi/plugin-* on npm = your shareable plugin. The dashboard
> Marketplace page searches npm + installs into ~/.shinobi/plugins-npm/
> with one click.

> Mention @<localpart-of-email> anywhere in a decision body and the
> mentioned user gets a row in their inbox. No external notification
> service required.

## Visual asset checklist

For threads 1, 2, 3, 4: each should have at least one image or short
video. The dashboard screenshots that work best:
- /home with multiple workspaces
- /push subscribe button + phone receiving the notification (use a real
  iPhone shot)
- /relay page showing "Connected" + peer agent IDs
- /approvals page mid-pending with the option buttons rendered

For thread 5 (technical): an architecture diagram. The one in
docs/hosted-saas-architecture.md can be re-rendered as a PNG with any
diagram tool.
