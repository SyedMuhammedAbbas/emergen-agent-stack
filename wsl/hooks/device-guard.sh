#!/usr/bin/env bash
# Claude Code PreToolUse hook for the agents: shared test devices are set up by the owner.
# Installing, reinstalling or uninstalling an app, clearing its data, or creating / wiping an
# emulator can sign the owner's test accounts out or fill the disk, so the agents may not do it.
# The owner installs builds (see org/engineering/qa.md, "Shared test devices").
in=$(cat)
[ "$(echo "$in" | jq -r '.tool_name // ""')" = Bash ] || exit 0
cmd=$(echo "$in" | jq -r '.tool_input.command // ""')

deny() {
  echo "Blocked by the device guard: $1. Shared test devices are the owner's: never install, reinstall, uninstall or clear an app, and never create or wipe an emulator. If the build on the device is not the one you need, ask the board (Question for board) and stop device work." >&2
  exit 2
}

echo "$cmd" | grep -q -i -E 'adb(\.exe)?([^|;&]*)[[:space:]](install|install-multiple|install-multi-package|uninstall)([[:space:]]|$)' && deny "adb install/uninstall"
# adb called through a variable or alias ($ADB -s <serial> install ..., install -r app.apk)
echo "$cmd" | grep -q -i -E '[[:space:]]-s[[:space:]]+[^[:space:]]+[[:space:]]+(install|install-multiple|uninstall)([[:space:]]|$)' && deny "install/uninstall on a device"
echo "$cmd" | grep -q -i -E '[[:space:]](install|install-multiple)[[:space:]]+(-[a-z]+[[:space:]]+)*[^[:space:]]*\.apk' && deny "installing an APK"
echo "$cmd" | grep -q -E '(^|[[:space:]"'"'"'])pm[[:space:]]+(install|uninstall|clear)([[:space:]]|$)' && deny "pm install/uninstall/clear"
echo "$cmd" | grep -q -E 'flutter(\.bat)?[[:space:]]+(install|run)([[:space:]]|$)' && deny "flutter install/run on a device"
echo "$cmd" | grep -q -E 'avdmanager([^|;&]*)[[:space:]](create|delete)([[:space:]]|$)' && deny "creating or deleting an emulator"
echo "$cmd" | grep -q -E 'emulator(\.exe)?([^|;&]*)-wipe-data' && deny "wiping an emulator"
exit 0
