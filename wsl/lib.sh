# Shared helpers for the WSL setup scripts. Source it; do not run it.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${HOME}/.emergen-agent-stack"
IDS_FILE="$STATE_DIR/ids.json"

log()  { printf '\033[1;34m[agent-stack]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[agent-stack] warning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[agent-stack] error:\033[0m %s\n' "$*" >&2; exit 1; }

load_config() {
  local f="$REPO_DIR/config.env"
  [ -f "$f" ] || die "config.env not found. Copy config.example.env to config.env and edit it."
  # KEY=value lines only; values may contain spaces
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    export "$k=${v%$'\r'}"
  done < "$f"
}

load_node() {
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  export PATH="$HOME/.local/bin:$PATH"
}

need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found. $2"; }
