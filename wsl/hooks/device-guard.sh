#!/usr/bin/env bash
# Claude Code PreToolUse hook for the agents (WSL / macOS entry point). The rules live in device-guard.mjs,
# which needs only node, so there is no jq dependency. Fails closed: no node, or no rules file, means the
# call is refused, never allowed.
dir=$(cd "$(dirname "$0")" && pwd)
if ! command -v node >/dev/null 2>&1 || [ ! -f "$dir/device-guard.mjs" ]; then
  echo "Blocked by the device guard: node or device-guard.mjs is missing, so the guard cannot check this call. Ask the board (Question for board)." >&2
  exit 2
fi
exec node "$dir/device-guard.mjs"
