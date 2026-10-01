#!/usr/bin/env bash
# Staleness watchdog (systemd timer, every 10 min). Finds tasks no agent is working on and restarts
# them through the issue itself (a board comment wakes the assignee with the issue bound to the run).
# A task that keeps stalling is escalated to the Watchdog agent instead of being restarted again.
#   watchdog.sh            apply fixes
#   watchdog.sh --dry-run  only print what it would do
set -uo pipefail
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
API="${PAPERCLIP_API:-http://localhost:3100/api}"
IDS="$HOME/.agent-stack/ids.json"
STATE="$HOME/.agent-stack/watchdog-state.json"
CID=$(jq -r .company "$IDS"); WD=$(jq -r '.watchdog // empty' "$IDS")
STALE_MIN=${WATCHDOG_STALE_MIN:-15}      # in_progress/todo untouched this long with no live run
MAX_FIXES=${WATCHDOG_MAX_FIXES:-3}       # restarts per task within WINDOW_H before escalating
WINDOW_H=${WATCHDOG_WINDOW_H:-6}
MAX_PER_CYCLE=${WATCHDOG_MAX_PER_CYCLE:-6}
RECOVERY_RE='no live execution path|cannot safely continue automatic recovery|automatically retried continuation|Adapter failed|unmanaged background task'

now=$(date -u +%s); ts() { date -u -d "$1" +%s 2>/dev/null || echo 0; }
say() { echo "$(date +%H:%M) $*"; }
[ -f "$STATE" ] || echo '{}' > "$STATE"

agents=$(curl -sf "$API/companies/$CID/agents") || { say "paperclip unreachable"; exit 0; }
issues=$(curl -sf "$API/companies/$CID/issues") || { say "paperclip unreachable"; exit 0; }
runs=$(curl -sf "$API/companies/$CID/heartbeat-runs") || runs='[]'

# live = queued/running runs whose process is still alive (or not started yet)
live_runs=$(jq -c '[.[] | select(.status=="queued" or .status=="running")]' <<<"$runs")
live_issue_ids=" "
while read -r r; do
  [ -z "$r" ] && continue
  pid=$(jq -r '.processPid // empty' <<<"$r"); st=$(jq -r .status <<<"$r")
  if [ "$st" = running ] && [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then continue; fi
  live_issue_ids+="$(jq -r '.contextSnapshot.issueId // empty' <<<"$r") "
done < <(jq -c '.[]' <<<"$live_runs")

fixed=0; summary=()

# 1. agents stuck in error with nothing running: back to idle
while read -r a; do
  [ -z "$a" ] && continue
  id=$(jq -r .id <<<"$a"); name=$(jq -r .name <<<"$a")
  n=$(jq --arg id "$id" '[.[]|select(.agentId==$id)]|length' <<<"$live_runs")
  [ "$n" -gt 0 ] && continue
  summary+=("agent $name: error -> idle")
  [ $DRY = 1 ] || curl -sf -X PATCH "$API/agents/$id" -H 'content-type: application/json' -d '{"status":"idle"}' >/dev/null
done < <(jq -c '.[] | select(.status=="error" and .adapterType=="claude_local")' <<<"$agents")

# active agents: not paused/terminated, run by Claude (skip the Hermes gateway)
active=$(jq -c '[.[] | select(.status!="paused" and .status!="terminated" and .adapterType=="claude_local") | {id, name, cap: (.runtimeConfig.heartbeat.maxConcurrentRuns // 1)}]' <<<"$agents")

restart() { # issue-json reason
  local i="$1" why="$2" id ident hist recent
  id=$(jq -r .id <<<"$i"); ident=$(jq -r .identifier <<<"$i")
  hist=$(jq -c --arg id "$id" '.[$id] // {fixes:[], escalated:null}' "$STATE")
  recent=$(jq --argjson now "$now" --argjson w $((WINDOW_H*3600)) '[.fixes[] | select(. > ($now - $w))] | length' <<<"$hist")
  if [ "$(jq -r '.escalated // empty' <<<"$hist")" != "" ]; then
    local esc_status
    esc_status=$(jq -r --arg e "$(jq -r .escalated <<<"$hist")" '.[]|select(.id==$e)|.status' <<<"$issues")
    case "$esc_status" in done|cancelled) ;; *) return 0 ;; esac   # Watchdog agent is on it
  fi
  if [ "$recent" -ge "$MAX_FIXES" ] && [ -n "$WD" ]; then
    summary+=("$ident: stalled $recent times in ${WINDOW_H}h -> escalated to Watchdog agent")
    [ $DRY = 1 ] && return 0
    local last_runs desc eid
    last_runs=$(jq -r --arg id "$id" '[.[] | select(.contextSnapshot.issueId==$id)] | sort_by(.createdAt) | .[-4:][] |
      "- run `\(.id)` \(.status) exit=\(.exitCode) liveness=\(.livenessState // "-"): \(.livenessReason // .error // "-")"' <<<"$runs")
    desc=$(printf 'Watchdog escalation for [%s](/EME/issues/%s): it stalled %s times in %sh; the last reason seen: %s.\n\nRecent runs on it:\n%s\n\nRun logs: `~/.paperclip/instances/default/data/run-logs/%s/<agentId>/<runId>.ndjson`.\n\nFollow your instructions: find the cause, fix what can be fixed in Paperclip, restart the task with precise instructions, or ask the board.' \
      "$ident" "$ident" "$recent" "$WINDOW_H" "$why" "$last_runs" "$CID")
    eid=$(curl -sf -X POST "$API/companies/$CID/issues" -H 'content-type: application/json' -d "$(jq -nc \
      --arg t "Watchdog: $ident keeps stalling" --arg d "$desc" --arg a "$WD" --arg p "$(jq -r '.projectId // empty' <<<"$i")" \
      '{title:$t, description:$d, status:"todo", priority:"high", assigneeAgentId:$a} + (if $p=="" then {} else {projectId:$p} end)')" | jq -r .id)
    jq --arg id "$id" --arg e "$eid" '.[$id] = ((.[$id] // {fixes:[]}) + {escalated:$e})' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
    return 0
  fi
  summary+=("$ident: $why -> restarted")
  [ $DRY = 1 ] && return 0
  local body
  body="**Watchdog:** $why. Continue this task from where it stopped (check your earlier comments and the worktree first). Run long commands attached with output to a log and keep checking them in the foreground until they exit; do not end the run before posting your result."
  curl -sf -X POST "$API/issues/$id/comments" -H 'content-type: application/json' -d "$(jq -nc --arg b "$body" '{body:$b}')" >/dev/null
  [ "$(jq -r .status <<<"$i")" = todo ] || curl -sf -X PATCH "$API/issues/$id" -H 'content-type: application/json' -d '{"status":"todo"}' >/dev/null
  jq --arg id "$id" --argjson now "$now" '.[$id] = ((.[$id] // {fixes:[], escalated:null}) | .fixes += [$now] | .escalated = null)' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

# 2. tasks of active agents that nothing is working on
while read -r i; do
  [ -z "$i" ] && continue
  [ "$fixed" -ge "$MAX_PER_CYCLE" ] && break
  id=$(jq -r .id <<<"$i"); st=$(jq -r .status <<<"$i"); aid=$(jq -r .assigneeAgentId <<<"$i")
  case "$live_issue_ids" in *" $id "*) continue ;; esac
  age=$(( (now - $(ts "$(jq -r .updatedAt <<<"$i")")) / 60 ))
  why=""
  case "$st" in
    in_progress) [ "$age" -ge "$STALE_MIN" ] && why="marked in progress but no run has worked on it for ${age} min" ;;
    todo)
      busy=$(jq --arg a "$aid" '[.[]|select(.agentId==$a)]|length' <<<"$live_runs")
      cap=$(jq -r --arg a "$aid" '.[]|select(.id==$a)|.cap' <<<"$active")
      [ "$age" -ge "$STALE_MIN" ] && [ "$busy" -lt "${cap:-1}" ] && why="waiting in todo for ${age} min with the agent free" ;;
    blocked)
      last=$(curl -sf "$API/issues/$id/comments" | jq -r 'sort_by(.createdAt) | last | .body // ""')
      grep -q -E '^\*\*Question for board' <<<"$last" && continue
      grep -q -E "$RECOVERY_RE" <<<"$last" && why="blocked by Paperclip run recovery, not by a question" ;;
  esac
  [ -n "$why" ] || continue
  restart "$i" "$why"; fixed=$((fixed+1))
done < <(jq -c --argjson act "$active" '($act|map(.id)) as $ids | .[] |
  select(.assigneeAgentId as $a | $ids | index($a)) | select(.status=="todo" or .status=="in_progress" or .status=="blocked")' <<<"$issues")

if [ ${#summary[@]} -eq 0 ]; then say "ok: nothing stale"; else
  for s in "${summary[@]}"; do say "$([ $DRY = 1 ] && echo '[dry] ')$s"; done
fi
