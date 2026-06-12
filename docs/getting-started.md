# Getting started with Shinobi (local)

From zero to an agent that remembers your project — on one machine, no
cloud, in about ten minutes. When you outgrow one machine, see
[remote mode](remote-mcp.md) and the
[$0/month cloud deployment guide](deploy-gcp-free.md).

## 1. Install

```bash
npm install -g @shinobiapps/shinobi
```

Requirements: Node 18+. `better-sqlite3` ships prebuilt binaries for common
platforms; Windows may need
[VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
as a fallback.

## 2. Bootstrap your project

In your project's root:

```bash
shinobi init
```

This creates `~/.shinobi/` (SQLite database + config) and writes the MCP
config for your client — `.mcp.json` for Claude Code, `.cursor/mcp.json`
for Cursor. For Cline / Continue.dev / Zed, print the snippet instead:

```bash
shinobi init --print-config
```

Restart your editor / MCP client. Your agent now has 37 `shinobi` tools.

## 3. Teach the agent to use its memory

Memory only pays off if the agent reads it at the start and writes to it as
it works. Add this to your project's `CLAUDE.md` (or your client's rules
file):

```markdown
At the start of each session, call the shinobi `agent_bootstrap` tool for the
active project to load decisions, dead ends, context and open tasks. Before
implementing a new approach, call `check_dead_ends`. Log decisions and dead
ends as you go; call `session_closeout` before finishing.
```

## 4. Your first project

Tell your agent something like:

> Create a shinobi project "Payments refactor" with subtasks for: extract
> the gateway interface, migrate Stripe calls, add retry logic. Log the
> decision that we use decimal.js for money math — floats caused rounding
> bugs.

From now on, in any future session, "work on the payments refactor through
shinobi" gives the agent the full picture: open tasks, decisions with
rationale, and the approaches that already failed.

## 5. The daily loop

| Moment | What happens |
| --- | --- |
| Session start | `agent_bootstrap` — decisions, dead ends, context, open tasks |
| Before a new approach | `check_dead_ends` — "we tried this, it broke because…" |
| Architectural choice made | `log_decision` with rationale |
| Approach failed | `log_dead_end` (optionally `never_retry`) |
| Session end | `session_closeout` — summary, drafts, timeline entry |

## 6. The dashboard

```bash
shinobi dashboard
```

→ [localhost:8765](http://localhost:8765): Kanban board, decisions, dead
ends, notes, plans, timeline, analytics. Auth is off on localhost and
automatic on any other bind.

## 7. Where to go next

- **Approvals on your phone** — the agent blocks mid-task until you tap
  approve: see the Push page in the dashboard, and `docs/relay.md` for
  multi-machine realtime.
- **One brain for every device** (desktop editor + Claude Code web/mobile
  sessions): [remote mode](remote-mcp.md), and the field-tested
  [GCP free tier + Cloudflare Tunnel walkthrough](deploy-gcp-free.md).
- **Backups / second machine**: `shinobi sync` snapshots the database to a
  private git repo (see README → Cross-machine sync).
- **Plugins**: drop a `.js` file in `~/.shinobi/plugins/` —
  `docs/plugin-development.md`.
