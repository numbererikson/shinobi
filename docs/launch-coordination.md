# Launch coordination checklist

Single day of effort spread across four channels: Hacker News (Show HN),
Product Hunt, the right subreddits, and `awesome-mcp` PRs. The day is
predictable; the prep makes or breaks it.

## Two weeks before launch

- [ ] Decide the launch date (Tuesday or Wednesday — best HN/PH traffic).
      Avoid US holiday weeks. Avoid the day after a major Anthropic
      release (signal-to-noise).
- [ ] Lock the feature set. No new features in the two weeks before
      launch; only bug fixes.
- [ ] Make sure the GitHub repo has:
  - Clean README with the 60s install snippet at the top
  - LICENSE file (MIT)
  - Topics set: `mcp`, `ai-tools`, `claude-code`, `cursor`, `task-management`
  - Description ≤ 80 chars: "Local-first task spine for AI coding agents"
  - Public issue tracker enabled
- [ ] CONTRIBUTING.md + issue templates published (see subtask #200)
- [ ] FUNDING.yml live (see subtask #201)

## One week before

- [ ] Record the three screencasts (see launch-screencasts.md), upload
      to Loom + YouTube, embed in marketing site
- [ ] Marketing site live at https://shinobi-apps.com/shinobi
      with TLS, analytics, OG image
- [ ] First two blog posts (01 + 02) published on Hashnode (canonical)
      + cross-posted to dev.to
- [ ] Twitter thread 1 ("Why I built this") pinned to profile
- [ ] Direct-message 5–10 friendly devs who know the space and ask if
      they'll comment on the HN post in the first hour (this seeds
      momentum; first-hour comments are the strongest ranking signal)
- [ ] Make a test post to a throwaway HN account at 9am PT on any
      non-launch day to remind yourself the rate-limiter exists
- [ ] Coffee. Plan for sleep the night before.

## Day-0: launch day timeline (all times in your local; key inflection
points marked in PT for HN visibility)

### 06:30 PT — HN Show HN post
- [ ] Title: "Show HN: Shinobi – local-first task spine for AI coding agents"
- [ ] Body (one paragraph + bullet list, no marketing fluff):
  ```
  Hey HN — I've been pair-programming with Claude Code for three
  months and got tired of re-explaining the same decisions every
  session. Shinobi is what came out: an MCP server + local SQLite +
  dashboard that gives the agent a persistent task spine and
  decision log.

  - Install: npm install -g @shinobiapps/shinobi
  - Self-host free forever (MIT)
  - Optional: web push approvals from your phone, multi-agent
    Cloudflare relay, voice meeting capture, GitHub PR linking,
    VS Code + Cursor extensions

  Repo: https://github.com/numbererikson/shinobi
  Walkthrough video (2 min): <Loom link>

  Happy to answer anything. The architecture doc is in the repo at
  docs/hosted-saas-architecture.md if you want the technical bits.
  ```
- [ ] Wait for the link to render, then DM the 5–10 seeded devs the
      URL. They comment within the first 30 min.
- [ ] Don't reply to your own post yet (boosts ranking when others
      comment first).

### 07:00 PT — Product Hunt launch (if same day)
- [ ] Post on PH with the same Loom video as the gallery's first item
- [ ] Tagline ≤ 60 chars: "Persistent memory + task tracking for AI coding agents"
- [ ] Description: a tighter version of the HN body
- [ ] Pre-arranged hunter (if you have one) submits at 12:01 AM PT

### 08:00 PT — answer every HN comment
- [ ] Respond to *every* comment that day. Even the snarky ones. Even
      "why not just use a README" — explain it once politely with a
      link to blog post 1.
- [ ] Be specific. "Yes, we support X — see docs/Y.md" beats "Great
      question, looking into it."

### 09:00 — reddit posts (your local time, but stagger by sub)
- [ ] r/programming — link to the HN post, very short text ("Show HN
      live, comments welcome")
- [ ] r/ClaudeAI — focus on the MCP / Claude Code angle
- [ ] r/cursor — focus on the Cursor extension
- [ ] r/selfhosted — focus on the SQLite + local-first story
- [ ] r/sideproject — let the community know, no marketing speak

### 10:00 — awesome-mcp + similar lists
- [ ] PR to https://github.com/awesome-mcp/awesome-mcp adding Shinobi
      in the Task Management section (or create it)
- [ ] PR to https://github.com/punkpeye/awesome-mcp-servers
- [ ] Similar PRs to any other curated MCP lists you find via
      `awesome-mcp` topic on GitHub
- [ ] Each PR: one-line description + repo link, no self-promotion paragraphs

### 11:00 onward — Twitter
- [ ] Post Twitter thread 4 (launch announcement)
- [ ] Reply to anyone who shares the HN post
- [ ] DM friendly accounts who might retweet
- [ ] Reply to *every* mention all day

### Evening — keep answering
- [ ] HN comments keep coming for 24h. Check every 30 min.
- [ ] PH comments roll over the next day too.
- [ ] If you spot a recurring question, edit the README to address it
      proactively (and link back to the answer in the HN reply).

## Day +1

- [ ] Twitter thread 5 ("Why SQLite-per-tenant for the SaaS")
- [ ] Blog post 2 ("Approve from the beach") on dev.to if not already
- [ ] Write a "Day-1 numbers" reply on the original HN thread (no
      bragging — just transparent: "X installs in 24h, Y stars, Z
      issues opened, none are bug reports so far")

## Week +1

- [ ] Blog post 3 ("Multi-agent real-time sync")
- [ ] Triage all opened issues, label with `good-first-issue` where
      applicable
- [ ] Reach out to anyone who opened a thoughtful issue and ask if
      they'd like to be a contributor

## Week +2

- [ ] Blog post 4 ("Your data stays local")
- [ ] First "weekly digest" tweet — what shipped, what's coming
- [ ] Onboard 1–2 contributors if anyone bit on the outreach

## What success looks like

- 200+ HN comments (front page for 6+ hours)
- 500+ GitHub stars in week 1
- 50+ Discord-style real conversations (issues, Twitter DMs, emails)
- 5–10 thoughtful contributor PRs in the first month
- 1–2 paying hosted SaaS customers (if signups went live)

If you hit half of those numbers it was still a real launch. Don't
chase vanity metrics; chase real conversations.

## What failure looks like (and how to recover)

- HN post stays below the fold all day → not enough early upvotes. Try
  again in two weeks with a sharper title and a different lead screenshot.
  HN allows reposts after a week if the original got few comments.
- No comments on PH → most PH traffic is from the email blast. Make
  sure the tagline + first screenshot tell the whole story.
- The repo gets 200 stars but 0 actually-installed users → the install
  friction is too high. Watch the install thread; profile the time-to-first-decision-log.

The launch is one day. The product is decades. Don't burn yourself out
chasing one specific day's metrics — there will be a next launch
(v1.1, hosted GA, a major feature) where you can land harder with the
network you built today.
