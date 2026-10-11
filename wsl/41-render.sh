#!/usr/bin/env bash
# Write the desired state for the reconciler (apps/cli/stack.mjs) to ~/.agent-stack/desired/:
#   org.json            the merged org (same as org.rendered.json)
#   agents/<key>.md     each agent's rendered instructions
#   settings.json       the config.env values the reconciler needs
# Uses the same renderer as 40-org.sh (lib.sh), so both paths see identical text. Read-only toward Paperclip.
source "$(dirname "$0")/lib.sh"
load_config
load_node
need jq "Run 20-tools.sh first."
OUT="$STATE_DIR/desired"
mkdir -p "$OUT/agents"
build_org > "$OUT/org.json"
# drop files of agents that no longer exist, so a stale role file can't be applied
keep=$(jq -r '.agents[].key' "$OUT/org.json")
for f in "$OUT"/agents/*.md; do [ -e "$f" ] || continue; grep -qxF "$(basename "$f" .md)" <<<"$keep" || rm -f "$f"; done
for key in $keep; do render_role "$key" > "$OUT/agents/$key.md" || die "rendering the instructions of $key failed"; done
tpl=$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)
[ -z "$(git -C "$REPO_DIR" status --porcelain -- org skills project-skills 2>/dev/null)" ] || tpl="$tpl+dirty"
jq -n --arg claude "$HOME/.local/bin/claude" --arg tpl "$tpl" --arg company "${COMPANY_NAME:-}" --arg tz "${TIMEZONE:-UTC}" \
  --argjson hb "${MANAGER_HEARTBEAT_SEC:-0}" --arg extra "${EXTRA_SKILLS:-}" \
  '{claudeCommand:$claude, tpl:$tpl, companyName:$company, timezone:$tz, managerHeartbeatSec:$hb,
    extraSkills: ($extra | split(",") | map(gsub("^\\s+|\\s+$";"")) | map(select(length>0)))}' > "$OUT/settings.json"
log "desired state written to $OUT ($(jq '.agents|length' "$OUT/org.json") agents, template $tpl)"
