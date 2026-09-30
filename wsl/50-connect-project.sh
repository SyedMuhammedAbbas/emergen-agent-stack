#!/usr/bin/env bash
# Run as the agent user. Attach git repos to a Paperclip project so the agents can work on them.
#   bash wsl/50-connect-project.sh --name NeuraX --base staging --odoo-project-id 91 \
#        --repo org/neurax-backend              # cloned into ~/projects/<slug>/ (Linux filesystem, fastest)
#        --path /mnt/d/Projects/Emergen/NeuraX/neurax-app   # or use your existing local checkout as-is
# Each issue gets its own git worktree (a separate folder + branch), so agents never touch the files you
# have open, even when the repo is your local checkout. Safe to re-run.
source "$(dirname "$0")/lib.sh"
load_config
load_node
API=http://127.0.0.1:3100/api

name=""; base=""; odoo_pid=""; repos=(); locals=()
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --base) base="$2"; shift 2 ;;
    --repo) repos+=("$2"); shift 2 ;;
    --path) locals+=("$2"); shift 2 ;;
    --odoo-project-id) odoo_pid="$2"; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$name" ] && [ $(( ${#repos[@]} + ${#locals[@]} )) -gt 0 ] \
  || die "usage: 50-connect-project.sh --name <project> [--base <branch>] [--odoo-project-id N] (--repo <owner/repo|url> | --path <local repo>)..."
[ -f "$IDS_FILE" ] || die "run 40-org.sh first"
CID=$(jq -r .company "$IDS_FILE"); MGR=$(jq -r .manager "$IDS_FILE")
gh auth status >/dev/null 2>&1 || die "gh is not logged in (gh auth login)"

slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g; s/^-//; s/-$//')
dir="$HOME/projects/$slug"; mkdir -p "$dir"

# ---- clone / update ----
declare -a paths=() urls=() refs=()
for r in "${repos[@]}"; do
  repo_name=$(basename "${r%.git}")
  path="$dir/$repo_name"
  if [ -d "$path/.git" ]; then
    log "fetching $repo_name"; git -C "$path" fetch --all --prune -q
  elif [[ "$r" == http* || "$r" == git@* ]]; then
    log "cloning $r"; git clone -q "$r" "$path"
  else
    log "cloning $r"; gh repo clone "$r" "$path" -- -q
  fi
  url=$(git -C "$path" remote get-url origin)
  ref="$base"
  if [ -n "$ref" ] && ! git -C "$path" rev-parse -q --verify "origin/$ref" >/dev/null; then
    warn "$repo_name has no branch $ref; using its default branch"; ref=""
  fi
  [ -n "$ref" ] || ref=$(git -C "$path" symbolic-ref -q --short refs/remotes/origin/HEAD | sed 's#^origin/##')
  paths+=("$path"); urls+=("$url"); refs+=("$ref")
done

# ---- existing local checkouts (used in place) ----
for path in "${locals[@]}"; do
  path=$(realpath "$path")
  git -C "$path" rev-parse --git-dir >/dev/null 2>&1 || die "$path is not a git repository"
  # a Windows checkout seen from WSL: stop git flagging every file as changed on mode/line endings
  git -C "$path" config core.fileMode false
  log "using local checkout $path"
  git -C "$path" fetch --all --prune -q || warn "fetch failed for $path (offline?)"
  url=$(git -C "$path" remote get-url origin 2>/dev/null || echo "file://$path")
  ref="$base"
  if [ -n "$ref" ] && ! git -C "$path" rev-parse -q --verify "origin/$ref" >/dev/null && ! git -C "$path" rev-parse -q --verify "$ref" >/dev/null; then
    warn "$(basename "$path") has no branch $ref; using its default branch"; ref=""
  fi
  [ -n "$ref" ] || ref=$(git -C "$path" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  [ -n "$ref" ] || ref=$(git -C "$path" branch --show-current)
  paths+=("$path"); urls+=("$url"); refs+=("$ref")
done

# ---- Paperclip project ----
pid=$(jq -r --arg n "$name" '.projects[$n].id // empty' "$IDS_FILE")
[ -n "$pid" ] || pid=$(curl -sf "$API/companies/$CID/projects" | jq -r --arg n "$name" '.[] | select(.name==$n) | .id' | head -1)
# worktrees always live on the Linux filesystem, even for a /mnt/d checkout: faster, and your folder stays clean
policy=$(jq -nc --arg ref "${refs[0]}" --arg wt "$dir/.worktrees" '{enabled:true, defaultMode:"isolated_workspace", allowIssueOverride:true,
  workspaceStrategy:{type:"git_worktree", baseRef:$ref, worktreeParentDir:$wt}}')
if [ -z "$pid" ]; then
  log "creating Paperclip project $name"
  pid=$(curl -sf -X POST "$API/companies/$CID/projects" -H 'Content-Type: application/json' -d "$(jq -nc \
    --arg n "$name" --arg m "$MGR" --argjson p "$policy" --arg d "Repos: ${urls[*]}" \
    '{name:$n, description:$d, status:"in_progress", leadAgentId:$m, executionWorkspacePolicy:$p}')" | jq -r .id)
  [ -n "$pid" ] && [ "$pid" != null ] || die "project creation failed"
else
  curl -sf -X PATCH "$API/projects/$pid" -H 'Content-Type: application/json' \
    -d "$(jq -nc --argjson p "$policy" '{executionWorkspacePolicy:$p}')" >/dev/null || warn "could not update workspace policy"
fi

# ---- one workspace per repo (first repo is primary) ----
existing=$(curl -sf "$API/projects/$pid/workspaces" || echo '[]')
for i in "${!paths[@]}"; do
  wname=$(basename "${paths[$i]}")
  if jq -e --arg c "${paths[$i]}" '(if type=="array" then . else (.workspaces // .items // []) end) | any(.cwd==$c)' <<<"$existing" >/dev/null; then
    log "workspace $wname already attached"; continue
  fi
  curl -sf -X POST "$API/projects/$pid/workspaces" -H 'Content-Type: application/json' -d "$(jq -nc \
    --arg n "$wname" --arg c "${paths[$i]}" --arg u "${urls[$i]}" --arg r "${refs[$i]}" --argjson p "$([ "$i" = 0 ] && echo true || echo false)" \
    '{name:$n, sourceType:"git_repo", cwd:$c, repoUrl:$u, defaultRef:$r, isPrimary:$p}')" >/dev/null \
    || die "attaching workspace $wname failed"
  log "workspace $wname -> ${paths[$i]} (base ${refs[$i]})"
done

tmp=$(mktemp)
jq --arg n "$name" --arg id "$pid" --arg d "$dir" --arg o "$odoo_pid" --args   '.projects[$n] = {id:$id, dir:$d, repos:$ARGS.positional, odoo_project_id:(if $o=="" then null else ($o|tonumber) end)}'   "${paths[@]}" < "$IDS_FILE" > "$tmp" && mv "$tmp" "$IDS_FILE"
log "project $name ($pid) ready. Assign issues to it in Paperclip; agents work in git worktrees under $dir/.worktrees."
echo "PAPERCLIP_PROJECT_ID=$pid"
