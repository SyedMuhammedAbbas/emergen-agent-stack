#!/usr/bin/env bash
# One source of truth for skills and role standards, installed for every tool:
#   skills/          general skills (ours + vendored third-party, see skills/THIRD_PARTY.md)
#   project-skills/  <project>-context skills, one per connected project
#   org/<dept>/*.md  role standards per department; rendered here into role-<key> skills
#   org/<dept>/skills/  department-only skills
#   org/_agents/*.md    Claude Code subagents (engineer, code-reviewer, qa, docs, security-reviewer)
#   org/_global/CLAUDE.md  the user-level rules file (docs/ai-factory.md)
# Targets: Claude Code in WSL (~/.claude), Claude Code on Windows (%USERPROFILE%\.claude, plus CLAUDE.md and an
# agents junction in %USERPROFILE%\.claude-personal when that second config dir exists), and each project folder's
# .claude/skills (its own context skill). Only skills and agents listed in a manifest are replaced or removed; a
# CLAUDE.md is only overwritten when this script wrote it. Your other files are untouched.
# Usage: wsl/60-sync-skills.sh [--dry-run]
source "$(dirname "$0")/lib.sh"
load_config
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
OUT="$STATE_DIR/role-skills"
MANIFEST_NAME=".agent-stack-managed"

# 1. role standards -> role-<key> skills
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
    printf '\n'
    render_role "$key"
  } > "$OUT/role-$key/SKILL.md"
done < <(jq -r '.agents[] | "\(.key) \(.title)"' "$STATE_DIR/org.rendered.json")

# 1b. subagents + the global CLAUDE.md, rendered once
AGENTS_OUT="$STATE_DIR/agents"; rm -rf "$AGENTS_OUT"; mkdir -p "$AGENTS_OUT"
for f in "$REPO_DIR"/org/_agents/*.md; do render_file "$f" > "$AGENTS_OUT/$(basename "$f")" || die "rendering $f failed"; done
render_file "$REPO_DIR/org/_global/CLAUDE.md" > "$STATE_DIR/CLAUDE.md" || die "rendering org/_global/CLAUDE.md failed"
GEN_MARK='Generated from org/_global/CLAUDE.md'

install_agents() { # claude-config-dir: agents/ from AGENTS_OUT, replacing/removing only what we manage
  local dir="$1/agents" new=() n
  for n in "$AGENTS_OUT"/*.md; do new+=("$(basename "$n")"); done
  if [ $DRY = 0 ]; then
    mkdir -p "$dir"
    if [ -f "$dir/$MANIFEST_NAME" ]; then
      while read -r n; do
        if [ -n "$n" ] && ! printf '%s\n' "${new[@]}" | grep -qx "$n"; then rm -f "${dir:?}/$n"; echo "  removed stale agent $n"; fi
      done < "$dir/$MANIFEST_NAME"
    fi
    cp "$AGENTS_OUT"/*.md "$dir/"
    printf '%s\n' "${new[@]}" > "$dir/$MANIFEST_NAME"
  fi
  log "$dir: ${#new[@]} agents $([ $DRY = 1 ] && echo '(dry run)')"
}
install_claude_md() { # claude-config-dir: CLAUDE.md, never over one written by hand
  if [ -f "$1/CLAUDE.md" ] && ! grep -qF "$GEN_MARK" "$1/CLAUDE.md"; then
    warn "$1/CLAUDE.md was not written by agent-stack; left alone (rendered copy: $STATE_DIR/CLAUDE.md)"; return 0
  fi
  [ $DRY = 1 ] || cp "$STATE_DIR/CLAUDE.md" "$1/CLAUDE.md"
  log "$1/CLAUDE.md $([ $DRY = 1 ] && echo '(dry run)')"
}

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
install_agents "$HOME/.claude"
install_claude_md "$HOME/.claude"

if [ "$(uname)" = Darwin ]; then
  :  # macOS: ~/.claude above is the only Claude Code install; no Windows side
else
WINHOME=$(cd /mnt/c 2>/dev/null && cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null </dev/null | tr -d '\r')
if [ -n "$WINHOME" ] && [ "$WINHOME" != "%USERPROFILE%" ]; then
  WINCLAUDE="$(wslpath -u "$WINHOME")/.claude"
  install_set "$WINCLAUDE/skills" "${GLOBAL[@]}"
  install_agents "$WINCLAUDE"
  install_claude_md "$WINCLAUDE"
  # second Claude config dir (another account, CLAUDE_CONFIG_DIR): same CLAUDE.md; agents/ is a junction to .claude\agents,
  # like its skills/ junction
  PERSONAL="$(wslpath -u "$WINHOME")/.claude-personal"
  if [ -d "$PERSONAL" ]; then
    install_claude_md "$PERSONAL"
    if [ -e "$PERSONAL/agents" ] || [ -L "$PERSONAL/agents" ]; then :
    elif [ $DRY = 1 ]; then log "$PERSONAL/agents: junction to $WINHOME\\.claude\\agents (dry run)"
    else
      (cd /mnt/c && cmd.exe /c mklink /J "$WINHOME\\.claude-personal\\agents" "$WINHOME\\.claude\\agents" </dev/null >/dev/null) ||
        warn "could not create the .claude-personal\\agents junction"
      log "$PERSONAL/agents: junction to $WINHOME\\.claude\\agents"
    fi
  fi
else
  warn "Windows home not found; skipped Claude Code on Windows"
fi
fi  # end Linux/WSL

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
