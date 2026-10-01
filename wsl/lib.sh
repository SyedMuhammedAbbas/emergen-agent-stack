# Shared helpers for the WSL setup scripts. Source it; do not run it.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${HOME}/.agent-stack"
IDS_FILE="$STATE_DIR/ids.json"
# one-time move from the pre-1.0 location
[ -d "$STATE_DIR" ] || { [ -d "$HOME/.emergen-agent-stack" ] && mv "$HOME/.emergen-agent-stack" "$STATE_DIR"; } || true

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

# Fill {{KEY}} placeholders from config (and {{name}} partials when a partials dir is given).
# Usage: render_file <file> [partials_dir]   -> prints the result; fails on unresolved placeholders
render_file() {
  # Windows path of the Hermes home (for skills that call the bridge); HERMES_HOME in config.env wins
  if [ -z "${HERMES_HOME:-}" ] && command -v cmd.exe >/dev/null 2>&1; then
    local lad; lad=$(cd /mnt/c 2>/dev/null && cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')
    [ -n "$lad" ] && [ "$lad" != "%LOCALAPPDATA%" ] && export HERMES_HOME="$lad\\hermes"
  fi
  python3 - "$1" "${2:-}" <<'PY'
import os, sys, pathlib, re
text = pathlib.Path(sys.argv[1]).read_text()
if sys.argv[2]:
    for p in pathlib.Path(sys.argv[2]).glob("*.md"):
        text = text.replace("{{" + p.stem + "}}", p.read_text().strip())
root = os.environ.get("PROJECTS_ROOT", "")
m = re.match(r"^/mnt/([a-z])/(.*)$", root)
values = {
    "COMPANY_NAME": os.environ.get("COMPANY_NAME", ""),
    "STACK": os.environ.get("STACK", ""),
    "ENGINEERING_SKILL": os.environ.get("ENGINEERING_SKILL", ""),
    "PROJECTS_ROOT": root,
    "PROJECTS_ROOT_WINDOWS": f"{m.group(1).upper()}:\\{m.group(2).replace('/', chr(92))}" if m else root,
    "PROJECT_CATEGORIES": ", ".join(c.strip() for c in os.environ.get("PROJECT_CATEGORIES", "").split(",") if c.strip()),
    "GIT_AUTHOR": os.environ.get("GIT_AUTHOR", ""),
    "DAILY_HOURS": os.environ.get("DAILY_HOURS", "8"),
    "TIMESHEET_EXCLUDE_REPOS": ", ".join(r.strip() for r in os.environ.get("TIMESHEET_EXCLUDE_REPOS", "agent-stack").split(",") if r.strip()),
}
hh = os.environ.get("HERMES_HOME", "")  # Windows path, e.g. C:\Users\me\AppData\Local\hermes
hm = re.match(r"^([A-Za-z]):\\(.*)$", hh)
hh_wsl = f"/mnt/{hm.group(1).lower()}/{hm.group(2).replace(chr(92), '/')}" if hm else ""
values.update({
    "HERMES_PY": f"{hh_wsl}/hermes-agent/venv/Scripts/python.exe",
    "AGENT_OPS": f"{hh}\\scripts\\agent_ops.py",
    "HERMES_STATE_WSL": f"{hh_wsl}/state/agent_ops",
    "HERMES_STATE_WIN": f"{hh}\\state\\agent_ops",
})
for k, v in values.items():
    text = text.replace("{{" + k + "}}", v)
left = sorted(set(re.findall(r"\{\{[A-Za-z_-]+\}\}", text)))
if left:
    sys.exit(f"{sys.argv[1]}: unresolved {' '.join(left)} (check config.env)")
print(text.rstrip())
PY
}
