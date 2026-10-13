#!/usr/bin/env bash
# Run as the agent user. Checks the logins the tools need. Idempotent.
# Exits 3 when a manual step is needed; the installer prints what to do.
source "$(dirname "$0")/lib.sh"
load_config
load_node

manual=()
gh auth status >/dev/null 2>&1 || manual+=("GitHub:  gh auth login")
claude auth status 2>/dev/null | grep -q '"loggedIn": true' || manual+=("Claude:  claude   (log in, then /exit)")

if [ ${#manual[@]} -gt 0 ]; then
  if [ "$(uname)" = Darwin ]; then
    printf '\nManual steps needed in a Terminal, then re-run ./mac/install.sh:\n'
  else
    printf '\nManual steps needed in an Ubuntu terminal (wsl -d %s), then re-run the installer:\n' "$WSL_DISTRO"
  fi
  printf '  - %s\n' "${manual[@]}"
  exit 3
fi
log "logins ok"
