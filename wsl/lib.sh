# Shared helpers for the WSL setup scripts. Source it; do not run it.
# wsl/ is the shared Linux/macOS layer: the same scripts run inside WSL (Windows install) and natively on macOS
# (mac/install.sh). macOS-only branches are guarded with [ "$(uname)" = Darwin ]; the Linux/WSL paths are unchanged.
set -euo pipefail

if [ "$(uname)" = Darwin ]; then
  # Homebrew tools (jq, gh, python3, bash 5) first in PATH, also when a script is run from a bare shell
  for _b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$_b" ] && { eval "$("$_b" shellenv)"; break; }; done
  # macOS ships bash 3.2; these scripts need bash 4+ (declare -A, empty arrays under set -u): re-run under Homebrew bash
  if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    for _b in /opt/homebrew/bin/bash /usr/local/bin/bash; do [ -x "$_b" ] && exec "$_b" "$0" "$@"; done
    printf '[agent-stack] error: bash 4+ is required on macOS. Run: brew install bash\n' >&2; exit 1
  fi
fi

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

# Fill {{KEY}} placeholders from config (and {{name}} partials from the partials dirs, first match wins).
# Usage: render_file <file> [partials_dir[:partials_dir...]]   -> prints the result; fails on unresolved placeholders
render_file() {
  # Windows path of the Hermes home (for skills that call the bridge); HERMES_HOME in config.env wins
  # macOS: Hermes lives at ~/.hermes by default (a POSIX path)
  if [ -z "${HERMES_HOME:-}" ] && [ "$(uname)" = Darwin ]; then export HERMES_HOME="$HOME/.hermes"; fi
  if [ -z "${HERMES_HOME:-}" ] && command -v cmd.exe >/dev/null 2>&1; then
    local lad; lad=$(cd /mnt/c 2>/dev/null && cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null </dev/null | tr -d '\r')
    [ -n "$lad" ] && [ "$lad" != "%LOCALAPPDATA%" ] && export HERMES_HOME="$lad\\hermes"
  fi
  python3 - "$1" "${2:-}" <<'PY'
import os, sys, pathlib, re
text = pathlib.Path(sys.argv[1]).read_text()
for d in [d for d in sys.argv[2].split(":") if d]:
    for p in pathlib.Path(d).glob("*.md"):
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
    # WORKDAYS: Mon=0 ... Sun=6
    "WORKDAYS_TEXT": ", ".join(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][int(d)]
                               for d in os.environ.get("WORKDAYS", "0,1,2,3,4").split(",") if d.strip().isdigit()),
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
if sys.platform == "darwin":
    # macOS: Hermes runs natively (default ~/.hermes); the "WSL" and "Windows" state paths are the same POSIX path
    hh = hh.rstrip("/")
    values.update({
        "HERMES_PY": f"{hh}/hermes-agent/venv/bin/python",
        "AGENT_OPS": f"{hh}/scripts/agent_ops.py",
        "HERMES_STATE_WSL": f"{hh}/state/agent_ops",
        "HERMES_STATE_WIN": f"{hh}/state/agent_ops",
    })
for k, v in values.items():
    text = text.replace("{{" + k + "}}", v)
left = sorted(set(re.findall(r"\{\{[A-Za-z_-]+\}\}", text)))
if left:
    sys.exit(f"{sys.argv[1]}: unresolved {' '.join(left)} (check config.env)")
print(text.rstrip())
PY
}

# Departments: org/company.json + org/<dept>/department.json for each key in DEPARTMENTS (config.env,
# comma-separated; default: every department whose department.json has "enabled" not false).
# Prints one merged org: {commonSkills, routerEnv, departments:[...], agents:[... each with "department"]}.
departments() {
  local want="${DEPARTMENTS:-}" d out=()
  if [ -n "$want" ]; then
    for d in ${want//,/ }; do [ -f "$REPO_DIR/org/$d/department.json" ] || die "DEPARTMENTS: org/$d/department.json not found"; out+=("$d"); done
  else
    for d in "$REPO_DIR"/org/*/department.json; do
      [ "$(jq -r '.enabled == false' "$d")" = true ] && continue
      out+=("$(basename "$(dirname "$d")")")
    done
  fi
  printf '%s
' "${out[@]}"
}
build_org() {
  local parts=() d
  for d in $(departments); do parts+=("$(render_file "$REPO_DIR/org/$d/department.json")"); done
  render_file "$REPO_DIR/org/company.json" | jq --argjson deps "$(printf '%s
' "${parts[@]}" | jq -s .)" '
    del(._comment) + {departments: [$deps[] | {key, name, description, head}],
                      agents: [$deps[] | .key as $k | .agents[] | . + {department: $k}]}'
}
# Role file and partials dirs for an agent key: "<file>|<dir>:<dir>"
role_paths() {
  local d
  for d in $(departments) operations; do
    [ -f "$REPO_DIR/org/$d/$1.md" ] && { printf '%s|%s:%s
' "$REPO_DIR/org/$d/$1.md" "$REPO_DIR/org/$d/_partials" "$REPO_DIR/org/_partials"; return; }
  done
  return 1
}
render_role() { local rp; rp=$(role_paths "$1") || die "no role file org/*/$1.md"; render_file "${rp%%|*}" "${rp#*|}"; }
