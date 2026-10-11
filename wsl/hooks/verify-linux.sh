#!/usr/bin/env bash
# Manual check for Linux/WSL/macOS: old-vs-new device-guard parity, the wrapper's fail-closed paths, and the
# Stop hook's JSON output with a hostile command line.  Usage: wsl/hooks/verify-linux.sh [old-device-guard.sh]
# (the optional argument is the previous jq-based guard, e.g. from `git show HEAD:wsl/hooks/device-guard.sh`).
set -u
here=$(cd "$(dirname "$0")" && pwd); fail=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fail=1; }
J() { node -e 'console.log(JSON.stringify({tool_name:process.argv[1],tool_input:{command:process.argv[2]}}))' "$1" "$2"; }

old=${1:-}
if [ -n "$old" ] && command -v jq >/dev/null; then
  while IFS= read -r c; do
    a=$(J Bash "$c" | bash "$old" >/dev/null 2>&1; echo $?); b=$(J Bash "$c" | "$here/device-guard.sh" >/dev/null 2>&1; echo $?)
    [ "$a" = "$b" ] && ok "parity ($a) $c" || bad "parity old=$a new=$b: $c"
  done <<'EOF'
adb install test.apk
adb -s emulator-5554 uninstall com.x
$ADB -s R5CT install -r app.apk
$ADB install -r build/app.apk
adb shell pm clear com.x
flutter run -d emu
avdmanager create avd -n x
emulator -avd x -wipe-data
ls -la
npm test
git commit -m "adb is fun"
adb devices
echo install foo.txt
EOF
fi

# wrapper fails closed without node
out=$(env PATH=/usr/bin:/bin bash -c 'command -v node >/dev/null && exit 99; echo "{}" | "$0"' "$here/device-guard.sh" 2>&1); rc=$?
[ "$rc" = 2 ] && ok "wrapper denies when node is missing" || bad "wrapper without node rc=$rc ($out)"
printf 'garbage' | "$here/device-guard.sh" >/dev/null 2>&1; [ $? = 2 ] && ok "wrapper denies garbage" || bad "wrapper allowed garbage"

# Stop hook: run it under a process whose name is "claude" with a child that looks like a build
tmp=$(mktemp -d); cp "$(command -v bash)" "$tmp/claude"
payload='{"session_id":"abc-123","hook_event_name":"Stop"}'
resp=$("$tmp/claude" -c '
  (exec -a "npm run \"build\" \\ x" sleep 8) & sleep 1
  printf "%s" "$1" | "$2"' _ "$payload" "$here/wait-for-background.sh")
echo "stop hook output: $resp"
node -e 'const j=JSON.parse(process.argv[1]); if(j.decision!=="block"||!/npm run/.test(j.reason)) process.exit(1)' "$resp" && ok "stop hook emits valid JSON with quotes and backslashes" || bad "stop hook output invalid"
[ -f /tmp/wfb-abc-123 ] && ok "session counter file created" || bad "no counter file"
rm -f /tmp/wfb-abc-123; rm -rf "$tmp"
exit $fail
