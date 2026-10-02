#!/usr/bin/env bash
# One source of truth for skills and role standards, installed for every tool:
#   skills/          general skills (ours + vendored third-party, see skills/THIRD_PARTY.md)
#   project-skills/  <project>-context skills, one per connected project
#   org/<dept>/*.md  role standards per department; rendered here into role-<key> skills
#   org/<dept>/skills/  department-only skills
# Targets: Claude Code in WSL (~/.claude/skills), Claude Code on Windows (%USERPROFILE%\.claude\skills),
# each project folder's .claude/skills (its own context skill), and Paperclip (40-org.sh imports skills/ and
# project-skills/). Only skills listed in the manifest are replaced or removed; your other skills are untouched.
# Usage: wsl/60-sync-skills.sh [--dry-run]
source "$(dirname "$0")/lib.sh"
load_config
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
OUT="$STATE_DIR/role-skills"
MANIFEST_NAME=".agent-stack-managed"

# 1. role standards -> role-<key> skills (same text the Paperclip agents run with)
rm -rf "$OUT"; mkdir -p "$OUT"
build_org > "$STATE_DIR/org.rendered.json"
while read -r key title; do
  rp=$(role_paths "$key") || continue
  rel=${rp%%|*}; rel=${rel#"$REPO_DIR"/}
  mkdir -p "$OUT/role-$key"
  {
    printf -- '---\nname: role-%s\ndescription: %s standards for the %s role (how to work, quality gates, rules). Use when acting as the %s in any project or tool, or when reviewing work done in that role.\n---\n\n' \
      "$key" "${COMPANY_NAME:-Team}" "$title" "$title"
    printf '> Generated from `%s` in the agent-stack repo; edit the template there, not this file.\n' "$rel"
    printf '> Inside Paperclip the steps about issues, comments, run summaries and the board apply as written. In other tools, follow the same intent: ask the user where it says "board", and give the summary at the end of the task.\n\n'
    render_role "$key"
  } > "$OUT/role-$key/SKILL.md"
done < <(jq -r '.agents[] | "\(.key) \(.title)"' "$STATE_DIR/org.rendered.json")

# 2. install a set of skill dirs into a target skills folder, replacing only what we manage
install_set() { # target-dir source-dirs...
  local target="$1"; shift
  mkdir -p "$target"
  local manifest="$target/$MANIFEST_NAME" new=()
  for src in "$@"; do
    [ -f "$src/SKILL.md" ] || continue
    local n; n=$(basename "$src"); new+=("$n")
    [ $DRY = 1 ] && continue
    rm -rf "${target:?}/$n"; mkdir -p "$target/$n"
    (cd "$src" && tar --exclude=node_modules --exclude=__pycache__ --exclude='*.pyc' --exclude=.git -cf - .) | (cd "$target/$n" && tar -xf -)
    # our own skills carry config placeholders; the installed copy is rendered
    grep -q '{{' "$src/SKILL.md" && render_file "$src/SKILL.md" > "$target/$n/SKILL.md"
  done
  # remove skills we installed before that no longer exist in the repo
  if [ -f "$manifest" ]; then
    while read -r old; do
      [ -n "$old" ] || continue
      printf '%s\n' "${new[@]}" | grep -qx "$old" || { [ $DRY = 1 ] || rm -rf "${target:?}/$old"; echo "  removed stale $old"; }
    done < "$manifest"
  fi
  [ $DRY = 1 ] || printf '%s\n' "${new[@]}" > "$manifest"
  log "$target: ${#new[@]} skills $([ $DRY = 1 ] && echo '(dry run)')"
}

GLOBAL=("$REPO_DIR"/skills/*/ "$OUT"/*/)
for d in $(departments); do for s in "$REPO_DIR"/org/"$d"/skills/*/; do [ -d "$s" ] && GLOBAL+=("$s"); done; done
install_set "$HOME/.claude/skills" "${GLOBAL[@]}"

WINHOME=$(cd /mnt/c 2>/dev/null && cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null </dev/null | tr -d '\r')
if [ -n "$WINHOME" ] && [ "$WINHOME" != "%USERPROFILE%" ]; then
  install_set "$(wslpath -u "$WINHOME")/.claude/skills" "${GLOBAL[@]}"
else
  warn "Windows home not found; skipped Claude Code on Windows"
fi

# 3. project context skills -> that project's folder (project-skills/projects.json, else by name under PROJECTS_ROOT)
for ps in "$REPO_DIR"/project-skills/*/; do
  [ -f "$ps/SKILL.md" ] || continue
  name=$(basename "$ps"); slug=${name%-context}
  rel=$(jq -r --arg n "$name" '.[$n] // empty' "$REPO_DIR/project-skills/projects.json" 2>/dev/null)
  if [ -n "$rel" ]; then dir="${PROJECTS_ROOT}/$rel"; [ -d "$dir" ] || dir=""
  else dir=$(find "${PROJECTS_ROOT:-/nonexistent}" -mindepth 2 -maxdepth 2 -type d -iname "$slug" 2>/dev/null | head -1); fi
  if [ -z "$dir" ]; then warn "no project folder named '$slug' under $PROJECTS_ROOT; skipped $(basename "$ps")"; continue; fi
  if [ $DRY = 0 ]; then
    mkdir -p "$dir/.claude/skills"; rm -rf "$dir/.claude/skills/$(basename "$ps")"; cp -r "$ps" "$dir/.claude/skills/"
  fi
  log "$dir/.claude/skills: $(basename "$ps")"
done
