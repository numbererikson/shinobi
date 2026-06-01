# Post-launch support cadence

The work after launch is different from the work before. This doc is
the running cadence — what to do, when, and why — so the project
doesn't drift into either burnout or neglect.

## Weekly: issue + PR triage (Monday, ~60 min)

- [ ] **Open new issues** since last triage
  - Add labels: `bug`, `enhancement`, `question`, `docs`, `good first issue`, `help wanted`, `wontfix`
  - Respond with either: an answer, a request for repro, or a "thanks, tracking" note
- [ ] **Open PRs** since last triage
  - Quick review pass: does it match the project standards? Does it
    have a corresponding issue or clear motivation?
  - Either merge, request changes, or label `needs-discussion`
- [ ] **Stale items**
  - Any issue/PR with no activity for >30 days: comment asking if it's
    still relevant
  - Any item with no response for >60 days: close with a thank-you
    message and a "feel free to reopen if relevant"

Target: every open issue has at least one maintainer response within
**5 business days**. Sustaining sponsors and Team-plan paying customers
have **2 business days**; Pro plan customers have **1 business day**.

## Weekly: changelog entry (Friday, ~20 min)

- [ ] `git log --since "last Friday" --pretty=oneline` → group by
      feature / fix / docs / chore
- [ ] Write 3–5 bullet points for `CHANGELOG.md` under "[Unreleased]"
- [ ] Tweet the highlights as a weekly thread (see launch-twitter-threads.md)
- [ ] If there's a meaningful UX change, blog it (short post, 3–5 paragraphs)

This is the activity that turns invisible maintenance work into a
visible "things are happening" signal for the community. If you skip
it for two weeks in a row, people start wondering if the project is
abandoned.

## Monthly: retrospective + roadmap pulse (first Monday, ~90 min)

- [ ] Read the past month's issues + PRs + Twitter mentions
- [ ] Identify the **top 3 themes** of user feedback
- [ ] Are any of them blocking adoption? Add to the next minor
      release's milestone
- [ ] Are any of them "nice to have but small"? Label as
      `good first issue` to bait contributors
- [ ] Check the public roadmap in the repo — does it still reflect
      reality? If not, update it
- [ ] Cut a release: `npm version <patch|minor|major>` + tag + push
      + GitHub release with the month's changelog highlights

## Quarterly: sustaining-sponsor office hours (~60 min)

- [ ] Schedule via Calendly link given to sponsors at Sustaining tier
      and above
- [ ] Group format, capped at 8 participants per quarter
- [ ] Agenda: Q&A on roadmap, technical deep-dive on whatever sponsors
      ask about, demo whatever shipped that quarter
- [ ] Recording made available to sponsors only (not public — keeps the
      tier valuable)

## Quarterly: dependency + security pass (~120 min)

- [ ] `npm outdated` — review each dep with a major bump
- [ ] `npm audit` — fix any high/critical advisories within the quarter
- [ ] Audit `~/.shinobi/.env` handling for any new attack surface added
      that quarter (e.g. new secret kinds, new external integrations)
- [ ] Review the cloud bill for the hosted SaaS if/when it's live;
      kill unused resources

## When something breaks for a user

The default response order:

1. Acknowledge the issue within 1 business day (faster for paying tiers).
2. Reproduce locally. If you can't, ask for the exact `shinobi --help`
   version + Node version + OS + the failing command's output.
3. If reproduced: fix on `main`, cut a patch release, comment on the
   issue with the new version number.
4. If not reproducible: leave the issue open with a "need more info"
   label and a deadline of 14 days. If no response, close with a
   pleasant "feel free to reopen with the requested info".

Never close an active user's issue without a reason they can understand.

## When a contributor opens their first PR

The default response order:

1. Reply within 1 business day, even if just "looking at this today".
2. Be generous with formatting / nit feedback (people remember the
   tone of their first PR review forever).
3. If the change is reasonable: merge even if you'd have done it
   slightly differently. Hand the contributor the win.
4. If the change is not reasonable: explain *why* clearly, suggest a
   concrete different approach, offer to mentor through it. Don't
   close-and-walk.
5. Add them to the contributors list (it's automatic via GitHub but
   thank them by name in the release notes).

## When the project genuinely needs a break

It's allowed. Note it publicly:

```
README.md update:
> Note: I'm taking a 2-week break from active maintenance starting
> 2026-08-15. Issues will be triaged on return; security reports still
> get same-day responses (email contact@shinobi-apps.com).
```

The community handles 2-week absences gracefully if you set the
expectation. They handle silent disappearances badly.

## What "healthy" looks like 6 months in

- 1k+ stars
- 50+ contributors who have landed at least one PR
- 10+ hosted SaaS customers (if launched)
- Monthly active install count steady or growing (via opt-in telemetry)
- Issue response time median < 3 days
- No active PRs older than 14 days

If any of those slip for two months in a row, that's a signal to
either ramp up time investment or recruit a co-maintainer.

## When to recruit a co-maintainer

When any one of these is true:

- You're consistently spending >10h/week on Shinobi and it's eating
  your other obligations
- Issue response time has been >5 days for two months straight
- You're shipping less than one release per month consistently
- You're getting a sense that you've stopped enjoying the project

Co-maintainer search target: someone who has already landed >3 PRs,
already triages other people's issues helpfully in the discussions,
and has been around for >2 months. They're rare, but they exist on
every healthy project.

## What to put on your dashboard widget for this

Add a calendar reminder for each cadence row above. Treat them like
any other work commitment — they're how Shinobi stays alive past
launch week.

---

**The one-line version of this whole doc:** triage weekly, ship weekly,
retro monthly, deep-pass quarterly, take breaks when needed, recruit
help before you burn out.
