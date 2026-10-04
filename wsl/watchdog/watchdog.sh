#!/usr/bin/env bash
# Staleness watchdog (systemd timer, or launchd agent on macOS, every 10 min). Finds tasks no agent is working on and restarts
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
RECOVERY_RE='no live execution path|cannot safely continue automatic recovery|automatically retried continuation|Adapter failed|unmanaged background task|issue workspace failed validation|execution-review participant|review stage still has no completed decision|interrupted by the disk guard'
REVIEW_STALE_MIN=${WATCHDOG_REVIEW_STALE_MIN:-180}   # in_review untouched this long, no live run, no open sub-task

now=$(date -u +%s); ts() { date -u -d "$1" +%s 2>/dev/null || echo 0; }
if [ "$(uname)" = Darwin ]; then
  # macOS: BSD date has no -d. Paperclip timestamps are UTC ISO 8601 (2026-10-03T12:34:56.789Z): drop the
  # fraction and zone, parse with -j -f
  ts() { local t="${1%%.*}"; t="${t%Z}"; t="${t%%+*}"; date -j -u -f '%Y-%m-%dT%H:%M:%S' "$t" +%s 2>/dev/null || echo 0; }
fi
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

escalate() { # issue-json reason title-suffix: hand the task to the Watchdog agent, once until that escalation is closed
  local i="$1" why="$2" what="$3" id ident hist last_runs desc eid
  [ -n "$WD" ] || return 0
  id=$(jq -r .id <<<"$i"); ident=$(jq -r .identifier <<<"$i")
  hist=$(jq -c --arg id "$id" '.[$id] // {fixes:[], escalated:null}' "$STATE")
  if [ "$(jq -r '.escalated // empty' <<<"$hist")" != "" ]; then
    case "$(jq -r --arg e "$(jq -r .escalated <<<"$hist")" '.[]|select(.id==$e)|.status' <<<"$issues")" in
      done|cancelled) ;; *) return 0 ;; esac   # Watchdog agent is on it
    # closed recently (e.g. the Watchdog agent found it is legitimately waiting on the board): do not re-escalate yet
    [ $(( now - $(jq -r '.escalatedAt // 0' <<<"$hist") )) -lt $(( ${WATCHDOG_ESCALATION_COOLDOWN_H:-12} * 3600 )) ] && return 0
  fi
  summary+=("$ident: $why -> escalated to Watchdog agent")
  [ $DRY = 1 ] && return 0
  last_runs=$(jq -r --arg id "$id" '[.[] | select(.contextSnapshot.issueId==$id)] | sort_by(.createdAt) | .[-4:][] |
    "- run `\(.id)` \(.status) exit=\(.exitCode) liveness=\(.livenessState // "-"): \(.livenessReason // .error // "-")"' <<<"$runs")
  desc=$(printf 'Watchdog escalation for [%s](/EME/issues/%s): %s.\n\nRecent runs on it:\n%s\n\nRun logs: `~/.paperclip/instances/default/data/run-logs/%s/<agentId>/<runId>.ndjson`.\n\nFollow your instructions: find the cause, fix what can be fixed in Paperclip, restart the task with precise instructions, or ask the board.' \
    "$ident" "$ident" "$why" "$last_runs" "$CID")
  eid=$(curl -sf -X POST "$API/companies/$CID/issues" -H 'content-type: application/json' -d "$(jq -nc \
    --arg t "Watchdog: $ident $what" --arg d "$desc" --arg a "$WD" --arg p "$(jq -r '.projectId // empty' <<<"$i")" \
    '{title:$t, description:$d, status:"todo", priority:"high", assigneeAgentId:$a} + (if $p=="" then {} else {projectId:$p} end)')" | jq -r .id)
  jq --arg id "$id" --arg e "$eid" --argjson now "$now" '.[$id] = ((.[$id] // {fixes:[]}) + {escalated:$e, escalatedAt:$now})' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

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
    escalate "$i" "it stalled $recent times in ${WINDOW_H}h; the last reason seen: $why" "keeps stalling"
    return 0
  fi
  # A task whose last run crashed can be held by Paperclip ("execution_reconciliation_required":
  # stale environment lease or unreconciled failed run). Comments never wake it; a fresh copy does.
  local wake reason
  wake=$(curl -s -m 60 -X POST "$API/agents/$(jq -r .assigneeAgentId <<<"$i")/wakeup" -H 'content-type: application/json' \
    -d "$(jq -nc --arg id "$id" '{source:"assignment", triggerDetail:"system", reason:"issue_assigned", payload:{issueId:$id, taskId:$id, taskKey:$id}}')")
  reason=$(jq -r '.reason // empty' <<<"$wake" 2>/dev/null)
  if [ "$reason" = execution_reconciliation_required ]; then
    if jq -e --arg id "$id" 'any(.[]; .parentId == $id and .status != "done" and .status != "cancelled")' <<<"$issues" >/dev/null; then
      summary+=("$ident: held by Paperclip run reconciliation and has open sub-tasks -> left for the Watchdog agent")
      return 0
    fi
    summary+=("$ident: held by Paperclip run reconciliation -> recreated as a fresh copy")
    [ $DRY = 1 ] && return 0
    local copy newid newident
    copy=$(jq -c --arg t "$(jq -r .title <<<"$i" | sed -E 's/ \(retry[^)]*\)$//') (retry)" --arg ident "$ident" '
      {title:$t, status:"todo", priority:(.priority // "high"), assigneeAgentId, projectId,
       description: ((.description // "") + "\n\n---\n**Continues " + $ident + "** (held by a stale Paperclip run). Read its comments first and continue from where it stopped; reuse its branch and commits.")}
      + (if .parentId then {parentId} else {} end) + (if .projectWorkspaceId then {projectWorkspaceId} else {} end)' <<<"$i")
    newid=$(curl -sf -m 60 -X POST "$API/companies/$CID/issues" -H 'content-type: application/json' -d "$copy" | jq -r '.id // empty')
    # Paperclip can hand back the existing issue for a duplicate create: never cancel without a new id
    if [ -z "$newid" ] || [ "$newid" = "$id" ]; then summary+=("$ident: copy was not created; left as is"); return 0; fi
    newident=$(curl -sf -m 60 "$API/issues/$newid" | jq -r .identifier)
    curl -sf -X POST "$API/issues/$id/comments" -H 'content-type: application/json' \
      -d "$(jq -nc --arg b "**Watchdog:** continued in $newident (this task was held by a stale Paperclip run)." '{body:$b}')" >/dev/null
    curl -sf -X PATCH "$API/issues/$id" -H 'content-type: application/json' -d '{"status":"cancelled"}' >/dev/null
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
      grep -q -E "$RECOVERY_RE" <<<"$last" && why="blocked by Paperclip run recovery, not by a question"
      # blocked on other issues that are all finished (Paperclip's own auto-resume does not always fire)
      if [ -z "$why" ] && grep -q -i -E 'blocker|blocked on|blocked by|waiting on' <<<"$last"; then
        refs=$(grep -o -E '\b[A-Z]+-[0-9]+\b' <<<"$last" | sort -u | grep -v -x "$(jq -r .identifier <<<"$i")" || true)
        if [ -n "$refs" ]; then
          open=0
          for r in $refs; do
            case "$(jq -r --arg x "$r" '.[]|select(.identifier==$x)|.status' <<<"$issues")" in done|cancelled) ;; *) open=1 ;; esac
          done
          [ $open = 0 ] && why="blocked on $(tr '\n' ' ' <<<"$refs")which are all finished"
        fi
      fi ;;
    in_review)
      # a review nobody is doing: escalate (a restart would undo the review state)
      [ "$age" -ge "$REVIEW_STALE_MIN" ] || continue
      jq -e --arg id "$id" 'any(.[]; .parentId == $id and .status != "done" and .status != "cancelled")' <<<"$issues" >/dev/null && continue
      last=$(curl -sf "$API/issues/$id/comments" | jq -r 'sort_by(.createdAt) | last | .body // ""')
      grep -q -E '^\*\*Question for board' <<<"$last" && continue
      escalate "$i" "in review for ${age} min with no reviewer run and no open review sub-task" "review is stuck"
      fixed=$((fixed+1)); continue ;;
  esac
  [ -n "$why" ] || continue
  restart "$i" "$why"; fixed=$((fixed+1))
done < <(jq -c --argjson act "$active" '($act|map(.id)) as $ids | .[] |
  select(.assigneeAgentId as $a | $ids | index($a)) | select(.status=="todo" or .status=="in_progress" or .status=="blocked" or .status=="in_review")' <<<"$issues")

# 3. disk hygiene: worktrees of finished tasks and stale Flutter temp dirs fill C: (WSL/Windows disks only grow)
if [ $DRY = 0 ]; then
  WT_ROOT="${WATCHDOG_WORKTREE_ROOT:-$HOME/projects}"
  removed=0
  for d in $(find "$WT_ROOT" -mindepth 3 -maxdepth 3 -path '*/.worktrees/*' -type d -mmin +30 2>/dev/null); do
    ident=$(basename "$d" | grep -o -E '^[A-Z]+-[0-9]+') || continue
    st=$(jq -r --arg x "$ident" '.[]|select(.identifier==$x)|.status' <<<"$issues")
    case "$st" in done|cancelled) ;; *) continue ;; esac
    gd=$(sed -n 's/^gitdir: //p' "$d/.git" 2>/dev/null); repo=${gd%%/.git/worktrees/*}
    { [ -n "$repo" ] && git -C "$repo" worktree remove --force "$d" 2>/dev/null; } || { rm -rf "$d"; [ -n "$gd" ] && rm -rf "$gd"; }
    removed=$((removed+1))
  done
  [ "$removed" -gt 0 ] && summary+=("disk: removed $removed worktree(s) of finished tasks")
  for t in /mnt/c/Users/*/AppData/Local/Temp; do
    find "$t" -maxdepth 1 -mindepth 1 -type d \( -name 'flutter_tools.*' -o -name 'neurax-dashboard-deploy-*' \) -mmin +120 -exec rm -rf {} + 2>/dev/null
  done
fi

if [ ${#summary[@]} -eq 0 ]; then say "ok: nothing stale"; else
  for s in "${summary[@]}"; do say "$([ $DRY = 1 ] && echo '[dry] ')$s"; done
fi
