#!/usr/bin/env bash
# Claude Code Stop hook for the agents: a run may not end while a build or test
# it started is still running (the task would be left without a verdict).
in=$(cat)
sid=$(echo "$in" | jq -r '.session_id // "x"')

# the claude process this hook belongs to
p=$$
while [ "$p" -gt 1 ]; do
  [ "$(cat /proc/$p/comm 2>/dev/null)" = claude ] && break
  p=$(awk '{print $4}' /proc/$p/stat 2>/dev/null || echo 1)
done
[ "$p" -gt 1 ] || exit 0

desc() { for c in $(cat /proc/$1/task/*/children 2>/dev/null); do echo "$c"; desc "$c"; done; }
pat='flutter|dart|gradle|pnpm|npm (run|test|ci)|yarn|jest|vitest|pytest|tsc|eslint|build_runner|adb |cmd\.exe|powershell\.exe'
busy=$(for c in $(desc "$p"); do
  [ "$c" = $$ ] && continue
  a=$( { tr '\0' ' ' </proc/$c/cmdline; } 2>/dev/null )
  echo "$a" | grep -q -E "hooks/" && continue
  echo "$a" | grep -q -E "$pat" && echo "$a" | cut -c1-100
done | head -3)

[ -n "$busy" ] || { rm -f "/tmp/wfb-$sid"; exit 0; }
n=$(( $(cat "/tmp/wfb-$sid" 2>/dev/null || echo 0) + 1 )); echo "$n" > "/tmp/wfb-$sid"
[ "$n" -le 40 ] || exit 0   # safety valve: stop blocking after ~40 attempts
jq -n --arg r "A command you started is still running: $(echo "$busy" | head -1). Do not end the run. Wait with a foreground command (sleep 240), then check its output; repeat until it exits, then post the verdict/summary." \
  '{decision:"block",reason:$r}'
