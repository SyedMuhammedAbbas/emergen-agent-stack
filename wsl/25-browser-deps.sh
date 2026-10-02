#!/usr/bin/env bash
# Run as root, after 20-tools.sh: system libraries Playwright's Chromium needs. Idempotent.
source "$(dirname "$0")/lib.sh"
load_config
[ "$(uname)" = Darwin ] && die "Linux/WSL only. On macOS, mac/install.sh installs the Homebrew equivalents."
[ "$(id -u)" = 0 ] || die "run as root (wsl -u root)"

NPX="$(su - "$WSL_USER" -c 'export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh >/dev/null 2>&1; command -v npx' || true)"
[ -n "$NPX" ] || die "npx not found for $WSL_USER; run 20-tools.sh first"
log "Playwright Chromium system dependencies"
PATH="$(dirname "$NPX"):$PATH" "$NPX" -y playwright@latest install-deps chromium >/dev/null
log "browser deps done"
