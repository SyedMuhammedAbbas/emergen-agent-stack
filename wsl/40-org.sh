#!/usr/bin/env bash
# Run as the agent user. Creates/updates the Paperclip company, skills and agents from agents/org.json.
# Safe to re-run: existing agents are updated in place (matched by saved id, then by name).
source "$(dirname "$0")/lib.sh"
load_config
load_node
need paperclipai "Run 20-tools.sh first."
API=http://127.0.0.1:3100/api
CLAUDE="$HOME/.local/bin/claude"
mkdir -p "$STATE_DIR"
[ -n "${COMPANY_NAME:-}" ] || die "config.env: COMPANY_NAME is empty"
# org.json with {{ENGINEERING_SKILL}} etc. filled in
ORG="$STATE_DIR/org.rendered.json"
render_file "$REPO_DIR/agents/org.json" > "$ORG"
[ -f "$IDS_FILE" ] || echo '{}' > "$IDS_FILE"
ids=$(cat "$IDS_FILE")
save() { echo "$ids" | jq . > "$IDS_FILE"; }

# ---- company ----
CID=$(jq -r '.company // empty' <<<"$ids")
[ -n "$CID" ] || CID=$(curl -sf "$API/companies" | jq -r --arg n "$COMPANY_NAME" '.[] | select(.name==$n) | .id' | head -1)
if [ -z "$CID" ]; then
  log "creating company $COMPANY_NAME"
  CID=$(paperclipai company create --json --payload-json "$(jq -nc --arg n "$COMPANY_NAME" --arg d "$COMPANY_DESCRIPTION" '{name:$n, description:$d}')" | jq -r .id)
fi
ids=$(jq -c --arg c "$CID" '.company=$c' <<<"$ids"); save
log "company $COMPANY_NAME ($CID)"

# ---- skills: repo skills + project context skills (+ optional extra folder) -> Paperclip managed dir -> import ----
MANAGED="$HOME/.paperclip/instances/default/skills/$CID"
mkdir -p "$MANAGED"
imported=0
for src in "$REPO_DIR"/skills/*/ "$REPO_DIR"/project-skills/*/ "${SKILLS_SOURCE:-/nonexistent}"/*/; do
  [ -f "$src/SKILL.md" ] || continue
  name=$(basename "$src")
  # this repo's skills win over a same-named folder in SKILLS_SOURCE
  case "${src%/}" in "$REPO_DIR"/skills/*|"$REPO_DIR"/project-skills/*) ;;
    *) { [ -d "$REPO_DIR/skills/$name" ] || [ -d "$REPO_DIR/project-skills/$name" ]; } && continue ;; esac
  rm -rf "${MANAGED:?}/$name"; cp -r "$src" "$MANAGED/$name"
  # skills may use config placeholders ({{PROJECTS_ROOT}}, {{STACK}}, ...)
  if grep -q '{{' "$src/SKILL.md"; then
    render_file "$src/SKILL.md" > "$MANAGED/$name/SKILL.md" || die "rendering skill $name failed"
  fi
  paperclipai skills import "$MANAGED/$name" -C "$CID" --json >/dev/null && imported=$((imported+1)) || warn "skill import failed: $name"
done
log "skills imported/refreshed: $imported"
# slug -> one skill key. A slug can exist twice (e.g. created in the UI and imported later);
# prefer the imported "local/..." record so every run resolves to the same one.
declare -A SKILL_KEY=()
while read -r key slug; do
  [ -n "${SKILL_KEY[$slug]:-}" ] && [[ "${SKILL_KEY[$slug]}" == local/* ]] && continue
  SKILL_KEY[$slug]=$key
done < <(paperclipai skills list -C "$CID" | sed -n 's/.* key=\([^ ]*\) slug=\([^ ]*\) .*/\1 \2/p')

# ---- agents ----
render() { render_file "$REPO_DIR/agents/$1.md" "$REPO_DIR/agents/_partials"; }

existing_agents=$(curl -sf "$API/companies/$CID/agents")
router_env=$(jq -c .routerEnv "$ORG")
# EXTRA_SKILLS (config.env, comma-separated): your own skills every agent gets, e.g. project context skills
common_skills="$(jq -r '.commonSkills[]' "$ORG") $(tr ',' ' ' <<<"${EXTRA_SKILLS:-}")"

for key in $(jq -r '.agents[].key' "$ORG"); do
  a=$(jq -c --arg k "$key" '.agents[] | select(.key==$k)' "$ORG")
  name=$(jq -r .name <<<"$a")
  id=$(jq -r --arg k "$key" '.[$k] // empty' <<<"$ids")
  [ -n "$id" ] || id=$(jq -r --arg n "$name" '.[] | select(.name==$n) | .id' <<<"$existing_agents" | head -1)
  reports=$(jq -r .reportsTo <<<"$a"); rid=""
  [ "$reports" = null ] || rid=$(jq -r --arg k "$reports" '.[$k] // empty' <<<"$ids")

  cfg=$(jq -nc --arg c "$CLAUDE" --argjson a "$a" --argjson env "$router_env" \
    '{engine:"cli", command:$c, timeoutSec:3600}
     + (if $a.model then {model:$a.model} else {} end)
     + (if $a.router then {env:$env} else {} end)')
  body=$(jq -nc --argjson a "$a" --arg r "$rid" \
    '{name:$a.name, role:$a.role, title:$a.title, icon:$a.icon, budgetMonthlyCents:$a.budgetCents}
     + (if $r=="" then {} else {reportsTo:$r} end)')
  instr=$(render "$key")

  if [ -n "$id" ]; then
    cur=$(paperclipai agent get "$id" --json | jq -c '.adapterConfig | del(.env, .model)')
    body=$(jq -nc --argjson b "$body" --argjson cur "$cur" --argjson cfg "$cfg" '$b + {adapterConfig: ($cur + $cfg)}')
    paperclipai agent update "$id" --json --payload-json "$body" >/dev/null
    curl -sf -X PUT "$API/agents/$id/instructions-bundle/file" -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg c "$instr" '{path:"AGENTS.md", content:$c}')" >/dev/null || die "instructions update failed: $name"
    action=updated
  else
    body=$(jq -nc --argjson b "$body" --argjson cfg "$cfg" --arg c "$instr" \
      '$b + {adapterType:"claude_local", adapterConfig:$cfg, instructionsBundle:{entryFile:"AGENTS.md", files:{"AGENTS.md":$c}}}')
    id=$(paperclipai agent create -C "$CID" --json --payload-json "$body" | jq -r .id)
    action=created
  fi
  ids=$(jq -c --arg k "$key" --arg v "$id" '.[$k]=$v' <<<"$ids"); save

  if [ "$(jq -r '.heartbeat // false' <<<"$a")" = true ] && [ "${MANAGER_HEARTBEAT_SEC:-0}" -gt 0 ]; then
    paperclipai agent update "$id" --json --payload-json \
      "{\"runtimeConfig\":{\"heartbeat\":{\"enabled\":true,\"intervalSec\":$MANAGER_HEARTBEAT_SEC,\"maxConcurrentRuns\":1}}}" >/dev/null
  elif [ "$(jq -r '.maxConcurrentRuns // empty' <<<"$a")" != "" ]; then
    # cap parallel runs (e.g. reviewers sharing one test device)
    paperclipai agent update "$id" --json --payload-json \
      "{\"runtimeConfig\":{\"heartbeat\":{\"enabled\":false,\"maxConcurrentRuns\":$(jq -r .maxConcurrentRuns <<<"$a")}}}" >/dev/null
  fi

  args=(); missing=()
  for s in $common_skills $(jq -r '.skills[]' <<<"$a"); do
    if [ -n "${SKILL_KEY[$s]:-}" ]; then args+=(--skill "${SKILL_KEY[$s]}"); else missing+=("$s"); fi
  done
  paperclipai skills agent sync "$id" -C "$CID" --mode replace "${args[@]}" >/dev/null
  printf '  %-8s %-18s %-9s %s skills%s\n' "$action" "$name" "$(jq -r '.model // "jev-router"' <<<"$a")" "$(( ${#args[@]} / 2 ))" \
    "$([ ${#missing[@]} -gt 0 ] && echo "  (missing: ${missing[*]})")"
done

# ---- routines: scheduled issues for agents (e.g. the Timekeeper's end-of-day timesheet proposal) ----
for key in $(jq -r '.agents[] | select(.routine) | .key' "$ORG"); do
  r=$(jq -c --arg k "$key" '.agents[] | select(.key==$k) | .routine' "$ORG")
  cron_var=$(jq -r .cronEnv <<<"$r"); cron="${!cron_var:-}"
  [ -n "$cron" ] || { warn "routine for $key: $cron_var is empty in config.env, skipped"; continue; }
  agent_id=$(jq -r --arg k "$key" '.[$k]' <<<"$ids")
  rid=$(jq -r --arg k "$key" '.routines[$k].id // empty' <<<"$ids")
  if [ -z "$rid" ]; then
    rid=$(curl -sf -X POST "$API/companies/$CID/routines" -H 'Content-Type: application/json' -d "$(jq -nc --argjson r "$r" --arg a "$agent_id" \
      '{title:$r.title, description:$r.description, assigneeAgentId:$a, priority:"medium"}')" | jq -r .id)
    [ -n "$rid" ] && [ "$rid" != null ] || die "creating routine for $key failed"
  fi
  tid=$(jq -r --arg k "$key" '.routines[$k].trigger // empty' <<<"$ids")
  trig=$(jq -nc --arg c "$cron" --arg tz "${TIMEZONE:-UTC}" '{kind:"schedule", cronExpression:$c, timezone:$tz, enabled:true}')
  if [ -n "$tid" ] && curl -sf -X PATCH "$API/routine-triggers/$tid" -H 'Content-Type: application/json' -d "$(jq -c 'del(.kind)' <<<"$trig")" >/dev/null; then
    :
  else
    tid=$(curl -sf -X POST "$API/routines/$rid/triggers" -H 'Content-Type: application/json' -d "$trig" | jq -r '.id // .trigger.id')
    [ -n "$tid" ] && [ "$tid" != null ] || die "creating schedule for routine $key failed"
  fi
  ids=$(jq -c --arg k "$key" --arg r "$rid" --arg t "$tid" '.routines[$k] = {id:$r, trigger:$t}' <<<"$ids"); save
  printf '  routine  %-18s %s (%s)\n' "$(jq -r .title <<<"$r")" "$cron" "${TIMEZONE:-UTC}"
done

# Stop hook: agents may not end a run while a build/test they started is still running
mkdir -p ~/.claude/hooks
install -m 755 "$REPO_DIR/wsl/hooks/wait-for-background.sh" ~/.claude/hooks/wait-for-background.sh
[ -f ~/.claude/settings.json ] || echo '{}' > ~/.claude/settings.json
tmp=$(mktemp)
jq '.hooks.Stop = [{"hooks":[{"type":"command","command":"$HOME/.claude/hooks/wait-for-background.sh","timeout":30}]}]' \
  ~/.claude/settings.json > "$tmp" && mv "$tmp" ~/.claude/settings.json
log "stop hook installed"

# Staleness watchdog: restarts tasks nothing is working on; escalates repeat stalls to the Watchdog agent
install -m 755 "$REPO_DIR/wsl/watchdog/watchdog.sh" "$STATE_DIR/watchdog.sh"
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/agent-watchdog.service <<UNIT
[Unit]
Description=Agent staleness watchdog
[Service]
Type=oneshot
ExecStart=/bin/bash -lc '$STATE_DIR/watchdog.sh >> $STATE_DIR/watchdog.log 2>&1'
UNIT
cat > ~/.config/systemd/user/agent-watchdog.timer <<UNIT
[Unit]
Description=Run the agent staleness watchdog every ${WATCHDOG_INTERVAL_MIN:-10} min
[Timer]
OnBootSec=5min
OnUnitActiveSec=${WATCHDOG_INTERVAL_MIN:-10}min
[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now agent-watchdog.timer >/dev/null
log "watchdog timer enabled (every ${WATCHDOG_INTERVAL_MIN:-10} min)"

# same skills + role standards for Claude Code (WSL and Windows) and each project folder
bash "$REPO_DIR/wsl/60-sync-skills.sh" || warn "skill sync for Claude Code failed (run wsl/60-sync-skills.sh)"

log "org ready. Agent ids: $IDS_FILE"
