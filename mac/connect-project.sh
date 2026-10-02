#!/usr/bin/env bash
# Connects a project (one or more git repos) to the agents on macOS, and optionally links it to an Odoo project.
# The macOS counterpart of connect-project.ps1. NOT YET TESTED ON A MAC.
#
#   ./mac/connect-project.sh --name NeuraX --base staging --odoo-project-id 91 \
#       --path ~/Projects/Emergen/NeuraX/neurax-backend --path ~/Projects/Emergen/NeuraX/neurax-app
#   ./mac/connect-project.sh --name NeuraX --repo Emergen-Tech/neurax-backend     # fresh clone into ~/projects/neurax/
#
# --path      existing local checkouts (used in place; agents work in their own git worktrees)
# --repo      GitHub owner/repo or git URL to clone instead
# --base      branch agents branch from and open PRs against (default: each repo's default branch)
# --odoo-project-id N / --odoo-project <name>   link to an Odoo project in the Hermes bridge config (project_map)
source "$(dirname "$0")/../wsl/lib.sh"
load_config

args=(); keys=()
while [ $# -gt 0 ]; do
  case "$1" in
    --odoo-project-id) args+=("$1" "$2"); keys+=("$2"); shift 2 ;;
    --odoo-project) keys+=("$2"); shift 2 ;;
    --name|--base|--repo|--path) args+=("$1" "$2"); shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done

out=$(mktemp)
set +e
"$BASH" "$REPO_DIR/wsl/50-connect-project.sh" "${args[@]}" | tee "$out" | grep -v '^PAPERCLIP_PROJECT_ID='
code=${PIPESTATUS[0]}
set -e
project_id=$(sed -n 's/^PAPERCLIP_PROJECT_ID=//p' "$out" | tail -1); rm -f "$out"
[ "$code" = 0 ] || die "connect-project failed"

if [ ${#keys[@]} -gt 0 ]; then
  hh="${HERMES_HOME:-$HOME/.hermes}"
  cfg_file="$hh/scripts/agent_ops.config.json"
  [ -f "$cfg_file" ] || { warn "Hermes bridge not installed; skipping the Odoo link"; exit 0; }
  python3 - "$cfg_file" "$project_id" "${keys[@]}" <<'PY'
import json, sys, pathlib
f, pid, keys = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
cfg = json.loads(f.read_text(encoding="utf-8-sig"))
cfg.setdefault("project_map", {})
cfg["project_map"] = cfg["project_map"] or {}
for k in keys:
    cfg["project_map"][k] = pid
f.write_text(json.dumps(cfg, indent=4), encoding="utf-8")
PY
  log "Odoo project ${keys[*]} -> Paperclip project $project_id"
fi
