# Launch screencast scenarios

Three short demo videos (2–3 min each) that should ship before the
public launch. Aim for Loom or Tella: easy edit, easy share, native
inline playback on the marketing site + HN thread + GitHub README.

Each scenario below has:
1. **Setup** — what to prepare before recording
2. **Take** — what to do on screen, paced so the cuts come out clean
3. **Voice-over** — what to actually say (one or two sentences per shot)
4. **CTA** — where the video ends + what link to drop in the description

---

## Video 1 — "Solo dev, full loop in 60 seconds"

**Audience:** Indie hacker scrolling Twitter who has never heard of Shinobi
but uses Claude Code. Goal: get them to `npm install -g …`.

### Setup
- Fresh terminal, fresh `~/example-project/` dir with a few sample files
- Dashboard NOT yet started
- Claude Code already open in a side terminal, logged in
- Browser ready on a blank tab

### Take (2:30 target)
1. **0:00 — install**
   ```sh
   npm install -g @shinobiapps/shinobi
   cd ~/example-project
   shinobi init
   ```
2. **0:20 — start dashboard**
   ```sh
   shinobi dashboard
   ```
   Switch to browser, open `http://localhost:8765`. Empty workspace.
3. **0:35 — restart Claude Code** (it picks up the new `.mcp.json`)
4. **0:40 — prompt Claude:**
   > "Create a Shinobi project called Example with 3 subtasks: research,
   > implement, ship. Then claim the first one."
5. **0:55 — flip back to browser**, dashboard now shows the project, the
   three subtasks, and "research" marked in_progress.
6. **1:15 — prompt Claude again:**
   > "We're going to use Postgres for this. Log that decision and then
   > complete the research subtask."
7. **1:35 — flip to dashboard**, show the new decision on the Decisions
   tab and the subtask flipped to done.
8. **1:55 — split screen**: Claude Code on the left, dashboard on the
   right. Type into Claude:
   > "What did we decide?"
   It uses `recall` and answers from memory.
9. **2:20 — close** with the dashboard view of the full project state.

### Voice-over
- "Install one CLI."
- "Drop into any project, run init, start the dashboard."
- "Claude Code now has tools to create projects, claim tasks, and log decisions."
- "Everything goes into a local SQLite — your data stays on your machine."
- "Next session, even days later, Claude reads the decisions and dead-ends
   back instead of suggesting the same thing again."

### CTA
"60-second install — github.com/numbererikson/shinobi. MIT-licensed."

---

## Video 2 — "Approve from the beach"

**Audience:** Solo dev who runs long agent jobs and wants to be able to
step away. Goal: convey the mobile push + approval flow.

### Setup
- Dashboard running on laptop, exposed via Tailscale or Cloudflare Tunnel
  (see docs/remote-access.md)
- iPhone or Android with the dashboard PWA installed
- Push subscribed to that phone (Subscribe button on the /push page)
- A trivial agent script that calls `request_approval` after 5s

### Take (2:00 target)
1. **0:00 — laptop wide shot**, dashboard showing empty Approvals page.
2. **0:10 — phone shot**, home screen with the Shinobi PWA icon.
3. **0:15 — laptop**: kick off the agent script. "I'm going to step away
   now."
4. **0:25 — cut to phone**, push notification slides in with title
   "Shinobi approval needed" and two action buttons "yes" / "no".
5. **0:40 — slow-mo finger taps "yes"**. Notification dismisses.
6. **0:55 — cut to laptop**, terminal shows the agent script unblocked
   and continuing with the "yes" branch. The Approvals page now shows
   the response.
7. **1:30 — cut back to phone** showing the now-responded approval on
   the dashboard.
8. **1:55 — close** with the laptop dashboard, decision auto-logged.

### Voice-over
- "Long-running agent. You don't want to babysit it. You also don't want
   it deciding on its own."
- "Drop `request_approval` into the agent's instructions. It pushes to
   your phone with action buttons."
- "Tap from anywhere. The agent unblocks within a second."
- "You stayed in control without staying at the desk."

### CTA
"Tailscale + Cloudflare Tunnel walkthroughs in the repo docs."

---

## Video 3 — "Two laptops, one workspace"

**Audience:** Two-person team or solo dev with desktop + laptop. Goal:
convey the multi-agent relay + git sync story.

### Setup
- Two laptops side by side (or split screen if recording remotely)
- Both have the relay env vars configured (see docs/relay.md)
- Both pointed at the same workspace
- A demo project with a couple of in-progress subtasks

### Take (2:30 target)
1. **0:00 — wide shot of both laptops**
2. **0:10 — laptop A**: prompt Claude
   > "Claim subtask 'wire up auth' and log a decision: we'll use NextAuth."
3. **0:25 — laptop A dashboard** flashes the new decision.
4. **0:35 — cut to laptop B**: terminal runs `shinobi dashboard` already.
   Show the dashboard auto-pulling the snapshot (you'll see the "auto-pulled
   DB snapshot after peer sync-available event" stderr line).
5. **0:55 — laptop B dashboard** now shows the same decision + subtask
   in-progress. ZERO manual sync action.
6. **1:15 — laptop B**: prompt its Claude
   > "What's the auth decision we just made?"
   Claude uses `recall`, reads the decision, answers correctly.
7. **1:45 — show the Relay page** on either laptop, "Connected" status,
   "last event: sync-available (2s ago)".
8. **2:15 — close** with a wide shot of both dashboards in sync.

### Voice-over
- "Two machines, two agents. They need to see the same project."
- "Shinobi's free Cloudflare Worker relay broadcasts sync events between
   them in real time."
- "When laptop A pushes, laptop B pulls within 1.5 seconds. No manual `git pull`."
- "Solo dev with desktop + laptop, or two-person team — same flow."

### CTA
"Free tier covers ~100k events/day. Walkthrough at github.com/numbererikson/shinobi/blob/main/docs/relay.md."

---

## Production checklist

- [ ] Record at 1080p, 30fps minimum (60 for terminal scroll)
- [ ] Crop terminal font to ~14pt so text is readable on mobile
- [ ] Use a dark editor theme that matches the dashboard (it does
      already — Tokyo Night, Dracula, etc.)
- [ ] No music — voice-over over silence is fine and friendlier to viewers
      who have audio off
- [ ] Captions: Loom auto-generates; review and fix proper nouns
      (Shinobi, MCP, Whisper, VAPID)
- [ ] Each video < 3 min; HN front-page attention drops sharply after 2
- [ ] Same intro card on all three: "Shinobi 🥷 — local-first task spine
      for AI coding agents"
- [ ] Same outro: GitHub URL + "MIT-licensed" + the 60s install snippet
- [ ] Upload to Loom for embed + YouTube for SEO; link both from the
      marketing site
