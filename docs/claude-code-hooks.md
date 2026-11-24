# Claude Code hooks: dead ends without asking

`check_dead_ends` only helps when the agent remembers to call it. With these
hooks, Shinobi adds past failures to the agent's context automatically:

| When | What the agent gets |
| --- | --- |
| You send a prompt (`UserPromptSubmit`) | Dead ends that share at least two significant words with the prompt |
| The agent edits a file (`PostToolUse` on Edit/Write/MultiEdit/NotebookEdit) | Dead ends recorded for that file |

Behaviour:
- **Silent by default.** Nothing is added when nothing matches.
- **No repeats.** Each dead end appears at most once per session, and each
  file is checked once per session.
- **Never in the way.** The hook never blocks the agent. If Shinobi is down
  or no token is set, it exits quietly after at most 3 s.
- **Obsolete ones drop out.** Dead ends marked obsolete (`update_dead_end`)
  are skipped.
- **Measured.** Every warning is logged as activity `dead_end_hook` in the
  project timeline, so you can see how often it fired and whether it helped.

## Set up in a repository

1. Copy [`.claude/hooks/shinobi-dead-ends.sh`](../.claude/hooks/shinobi-dead-ends.sh)
   into the repository at the same path and make it executable
   (`chmod +x`).
2. Merge this into the repository's `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/shinobi-dead-ends.sh", "timeout": 5 }] }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/shinobi-dead-ends.sh", "timeout": 5 }]
      }
    ]
  }
}
```

3. Give the hook the same two variables the `.mcp.json` setup uses:
   - `SHINOBI_MCP_TOKEN`: the dashboard token (OAuth connector tokens are for
     `/mcp` only);
   - `SHINOBI_MCP_URL`: e.g. `https://shinobi.example.com/mcp`. The default is
     `http://127.0.0.1:8765/mcp`.

   On a laptop, export them in your shell profile. In Claude Code on the web,
   set them as environment variables of the cloud environment.

The hook calls `POST /api/hooks/claude-code` with Claude Code's hook JSON. It
answers with `hookSpecificOutput.additionalContext`, or `204` when there is
nothing to say.

## When a dead end stops applying

A dependency gets upgraded or the upstream bug is fixed: mark the dead end
obsolete instead of deleting it, so the history stays.

```
update_dead_end { "id": 42, "obsolete": true, "reason": "fixed in node 22" }
```

`check_dead_ends` and the hooks then skip it. To see obsolete ones anyway, call
`check_dead_ends` with `include_obsolete: true`. `obsolete: false` makes a
dead end active again.
