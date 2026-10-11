#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher mcp__.*): per-tool allow / ask / off for MCP tools. The rules live in mcp-policy.mjs.
# Fails closed: no node, or no rules file, means the call is refused, never allowed.
dir=$(cd "$(dirname "$0")" && pwd)
if ! command -v node >/dev/null 2>&1 || [ ! -f "$dir/mcp-policy.mjs" ]; then
  echo "Blocked by the integrations policy: node or mcp-policy.mjs is missing, so this call cannot be checked. Ask the board (Question for board)." >&2
  exit 2
fi
exec node "$dir/mcp-policy.mjs"
