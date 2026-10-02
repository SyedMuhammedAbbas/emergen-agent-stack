#!/bin/bash
# Installs or updates the agent stack natively on macOS (the macOS counterpart of install.ps1). Idempotent.
# NOT YET TESTED ON A MAC. See docs/setup-mac.md.
#
#   ./mac/install.sh                 everything: Homebrew packages, tools, services, org, Hermes bridge (if Hermes is installed)
#   ./mac/install.sh --only-org      only re-apply org/ (agents, instructions, skills), e.g. after git pull
#   ./mac/install.sh --skip-hermes   do not install the Hermes bridge
#
# Exits 3 when a manual step is needed (gh auth login, claude login, jev-router key); it prints the list.
#
# This file runs under macOS's bash 3.2 (no bash-4 features here). The shared scripts in wsl/ need bash 4+ and are
# run with Homebrew's bash, which this script installs.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
log()  { printf '\033[1;34m[agent-stack]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[agent-stack] warning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[agent-stack] error:\033[0m %s\n' "$*" >&2; exit 1; }

ONLY_ORG=0; SKIP_HERMES=0
for a in "$@"; do
  case "$a" in
    --only-org) ONLY_ORG=1 ;;
    --skip-hermes) SKIP_HERMES=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "unknown argument $a (use --only-org, --skip-hermes)" ;;
  esac
done

[ "$(uname)" = Darwin ] || die "mac/install.sh is for macOS. On Windows use install.ps1."
macos_major=$(sw_vers -productVersion | cut -d. -f1)
[ "$macos_major" -ge 13 ] || warn "macOS $(sw_vers -productVersion): macOS 13 or newer is expected (realpath, plutil raw)."

# ---- Homebrew: required, never installed silently ----
BREW=""
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && { BREW="$b"; break; }; done
if [ -z "$BREW" ]; then
  printf '\nHomebrew is required. Install it yourself, then re-run ./mac/install.sh:\n\n'
  printf '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n\n'
  exit 1
fi
eval "$("$BREW" shellenv)"

# ---- config.env ----
CFG="$REPO_DIR/config.env"
[ -f "$CFG" ] || die "config.env not found. Run: cp config.example.env config.env, then edit it (see docs/setup-mac.md)."
cfg_get() { sed -n "s/^$1=//p" "$CFG" | tail -1 | tr -d '\r'; }
pr=$(cfg_get PROJECTS_ROOT)
case "$pr" in
  /mnt/*) die "config.env: PROJECTS_ROOT=$pr is a WSL path. On macOS use an absolute path such as $HOME/Projects." ;;
  "~"*)   die "config.env: PROJECTS_ROOT must be absolute (no ~). Use $HOME${pr#\~}." ;;
  "")     warn "config.env: PROJECTS_ROOT is empty (the Estimator and project skills need it)" ;;
  *)      [ -d "$pr" ] || warn "config.env: PROJECTS_ROOT=$pr does not exist yet" ;;
esac
case "$(cfg_get SKILLS_SOURCE)" in /mnt/*) die "config.env: SKILLS_SOURCE is a WSL path; leave it empty or use a macOS path." ;; esac

# ---- Homebrew packages (the macOS counterpart of wsl/10-base.sh) ----
if [ $ONLY_ORG = 0 ]; then
  log "== Homebrew packages"
  export HOMEBREW_NO_INSTALL_UPGRADE=1   # install what is missing; never upgrade on a re-run
  for f in git jq gh python bash; do
    brew list --formula "$f" >/dev/null 2>&1 || { log "brew install $f"; brew install -q "$f"; }
  done
  # project-estimation writes .xlsx (apt's python3-openpyxl on Linux). Homebrew's Python is externally managed,
  # so this is a --user install.
  if ! python3 -c 'import openpyxl' 2>/dev/null; then
    log "openpyxl (python3 --user)"
    python3 -m pip install -q --user --break-system-packages openpyxl || warn "openpyxl install failed; the Estimator cannot write .xlsx until it is installed"
  fi
fi
BASH5="$(brew --prefix)/bin/bash"
[ -x "$BASH5" ] || die "Homebrew bash not found at $BASH5. Run: brew install bash"

step() { # name script [args]
  local name="$1" script="$2" code=0; shift 2
  log "== $name"
  "$BASH5" "$REPO_DIR/$script" "$@" || code=$?
  if [ $code = 3 ]; then printf '\n'; warn "Re-run ./mac/install.sh after the steps above."; exit 3; fi
  [ $code = 0 ] || die "$name failed (exit $code)"
}

if [ $ONLY_ORG = 0 ]; then
  step 'Tools (Node 24, Claude Code, Paperclip, jev-router, Playwright Chromium)' wsl/20-tools.sh
  step 'Services and logins' wsl/30-services.sh
fi
step 'Paperclip org, agents and skills' wsl/40-org.sh

if [ $ONLY_ORG = 0 ] && [ $SKIP_HERMES = 0 ]; then
  HH="${HERMES_HOME:-$(cfg_get HERMES_HOME)}"; HH="${HH:-$HOME/.hermes}"
  if [ -x "$HH/hermes-agent/venv/bin/python" ]; then
    step 'Hermes bridge' mac/hermes-bridge.sh
  else
    log "Hermes not found at $HH; skipped the bridge (install Hermes, then run ./mac/hermes-bridge.sh)"
  fi
fi
log "done. Paperclip: http://localhost:3100  jev-router live view: http://127.0.0.1:4100"
