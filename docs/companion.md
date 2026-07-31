# Companion (Rin)

A face on the brain. When enabled, the dashboard shows a small draggable widget
that reacts to the **actual state of the work** — completions, blocked tasks,
logged dead ends, unanswered approvals, a session that has run for hours with
nothing written down.

It is deliberately **not** a compliment dispenser. The tone is chosen by what
the numbers say, so encouragement only appears when it has been earned; praise
that arrives unconditionally carries no information and trains you to ignore it.

Off by default.

## Turning her on

Dashboard → **Settings → Companion**, or in `~/.shinobi/.env`:

```bash
SHINOBI_COMPANION=on
SHINOBI_COMPANION_NAME=Rin        # what she is called in the widget
SHINOBI_COMPANION_LOCALE=en       # en | hr
SHINOBI_COMPANION_ART_DIR=        # defaults to ~/.shinobi/companion/art
```

No restart needed for the widget itself — reload the dashboard.

## Registers

The register is picked from project state, never at random. Trouble outranks
progress: a block in the same batch as three completions produces the block,
because that is the thing you need to hear.

| Register | When | Pose |
|---|---|---|
| `business` | A task closed, a decision logged, a plan saved | `talk` |
| `cheer` | Three completions in a row with no block between them | `celebrate` |
| `caution` | A task came back blocked; a dead end was logged | `warn` |
| `dry` | The *same* task blocked twice or more | `think` |
| `nag` | Approvals waiting; hours of work with no `session_closeout` | `warn` |

Ambient nudges (approvals, unclosed session) only fire when nothing else
happened, so she never talks over live work.

## Artwork

Six poses, one image each, in the art directory:

```
~/.shinobi/companion/art/
  idle.webp   talk.webp   celebrate.webp
  warn.webp   think.webp  sleep.webp
```

`webp`, `png`, `jpg`, `jpeg` and `gif` are accepted, in that order of
preference. Any pose without an image falls back to a lettered placeholder, so
a partial set works fine.

For a character that does not visibly change between states, generate one
reference image first and produce the rest as variations of it — same face,
hair, outfit and lighting, changing only expression and pose. Keep the framing
identical across all six or the widget will appear to "jump" when the pose
changes.

Artwork is served from `/api/companion/art/:pose`, read from disk on each
request, and the pose name is whitelisted before it ever reaches a path.

## State

Her memory is a plain JSON file at `~/.shinobi/companion/state.json`:
seen-activity watermark, current completion streak, per-task block counts,
recently used lines (so she does not repeat a sentence), and the last thing she
said.

It is deliberately *not* stored in the `plugin_state` table — keeping it in a
file means this layer needs no migration and runs on any Shinobi that has an
`activity` table. Deleting the file resets her; nothing else is affected.

## Idle behaviour

With nothing new to say she keeps her last line, drops to the `idle` pose after
10 minutes and to `sleep` after 90. State is only written when something
actually changed, so a dashboard left open all day does not rewrite the file
every poll.

## Why this lives in core (for now)

The plugin API (`registerTool` + scoped `state`) contributes **MCP tools only**
— it cannot add HTTP routes or dashboard UI, both of which a widget needs. So
the companion ships in core behind a default-off flag, written as a
self-contained module (`src/services/companion/`) with no coupling to the rest
of the server: the reactor is a pure function, the only database access is one
read-only module, and persistence is its own file.

When the plugin API grows route and UI contributions, moving this out is
mechanical. That extension is the real prerequisite for the Outlook, Teams and
fitness integrations to own their own surfaces too.
