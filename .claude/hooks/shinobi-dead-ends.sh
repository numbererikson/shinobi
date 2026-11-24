#!/usr/bin/env bash
# Claude Code hook → Shinobi: injects past failures (dead ends) related to the
# prompt or to a file just edited. Silent when nothing matches, when Shinobi is
# unreachable, or when no token is configured; never blocks the agent.
#
# Needs SHINOBI_MCP_TOKEN (the dashboard token) and optionally SHINOBI_MCP_URL
# (default http://127.0.0.1:8765/mcp). See docs/claude-code-hooks.md.
[ -n "${SHINOBI_MCP_TOKEN:-}" ] || exit 0
url="${SHINOBI_MCP_URL:-http://127.0.0.1:8765/mcp}"
curl -fsS -m 3 -X POST \
  -H "Authorization: Bearer ${SHINOBI_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  "${url%/mcp}/api/hooks/claude-code" 2>/dev/null || true
exit 0
