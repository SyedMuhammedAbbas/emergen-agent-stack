#!/usr/bin/env bash
# Run as the agent user. Node 24, Claude Code, Paperclip, jev-router, Playwright Chromium. Idempotent.
source "$(dirname "$0")/lib.sh"
load_config
MAC=0; [ "$(uname)" = Darwin ] && MAC=1
# shell profile nvm adds itself to: zsh is the default shell on macOS
RC="$HOME/.bashrc"; [ $MAC = 1 ] && RC="$HOME/.zshrc"

export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "nvm"
  curl -fsSo /tmp/nvm-install.sh https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh
  PROFILE="$RC" bash /tmp/nvm-install.sh >/dev/null
fi
load_node
if ! node -v 2>/dev/null | grep -q '^v24'; then
  log "Node 24"; nvm install 24 >/dev/null; nvm alias default 24 >/dev/null
fi
if [ $MAC = 1 ]; then
  # macOS: native claude in ~/.local/bin on PATH for interactive (zsh) shells
  grep -q 'agent-stack PATH' "$RC" 2>/dev/null || printf '\n# agent-stack PATH: native claude in ~/.local/bin\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"
else
# Linux tools must win over the Windows ones WSL appends to PATH
grep -q 'agent-stack PATH' ~/.bashrc || printf '\n# agent-stack PATH: prefer Linux tools over /mnt/c ones\nexport PATH="$HOME/.local/bin:$PATH"\n' >> ~/.bashrc
fi

if [ ! -x "$HOME/.local/bin/claude" ]; then
  log "Claude Code (native Linux build)"
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null
fi

npm config set fetch-retries 5 >/dev/null
npm config set fetch-timeout 600000 >/dev/null
if ! command -v paperclipai >/dev/null; then
  log "Paperclip CLI"
  # embedded Postgres and a few native deps need their install scripts
  EPG=@embedded-postgres/linux-x64
  # macOS: paperclipai's optional deps include @embedded-postgres/darwin-arm64 (Apple silicon) and darwin-x64 (Intel)
  if [ $MAC = 1 ]; then case "$(uname -m)" in arm64) EPG=@embedded-postgres/darwin-arm64 ;; *) EPG=@embedded-postgres/darwin-x64 ;; esac; fi
  npm install -g --allow-scripts=$EPG,ssh2,protobufjs,cpu-features paperclipai@latest >/dev/null
fi
if ! command -v jev-router >/dev/null; then
  log "jev-router (@ediri scope; the unscoped name is a different project)"
  npm install -g @ediri/jev-router@latest >/dev/null
fi

PW_CACHE="$HOME/.cache/ms-playwright"
[ $MAC = 1 ] && PW_CACHE="$HOME/Library/Caches/ms-playwright"   # Playwright's browser cache on macOS
if [ ! -d "$PW_CACHE" ]; then
  log "Playwright Chromium (UX screenshots)"
  npx -y playwright@latest install chromium >/dev/null
fi

log "tools: node $(node -v), claude $(claude --version 2>/dev/null | cut -d' ' -f1), paperclipai $(paperclipai --version), jev-router $(jev-router version 2>/dev/null | head -1)"
