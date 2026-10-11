// Claude Code PreToolUse hook for the agents: shared test devices are set up by the owner.
// Installing, reinstalling or uninstalling an app, clearing its data, or creating / wiping an
// emulator can sign the owner's test accounts out or fill the disk, so the agents may not do it.
// The owner installs builds (see org/engineering/qa.md, "Shared test devices").
// Needs only node (no jq, no bash), so it behaves the same on Linux, macOS and Windows.
// Fails closed: if the input cannot be read or parsed, the call is denied (exit 2), never allowed.
import { readFileSync } from 'node:fs';

// Each rule is tested per line, like the grep version it replaces.
export const RULES = [
  [/adb(\.exe)?([^|;&]*)\s(install|install-multiple|install-multi-package|uninstall)(\s|$)/i, 'adb install/uninstall'],
  // adb called through a variable or alias ($ADB -s <serial> install ..., install -r app.apk)
  [/\s-s\s+\S+\s+(install|install-multiple|uninstall)(\s|$)/i, 'install/uninstall on a device'],
  [/\s(install|install-multiple)\s+(-[a-z]+\s+)*\S*\.apk/i, 'installing an APK'],
  [/(^|[\s"'])pm\s+(install|uninstall|clear)(\s|$)/, 'pm install/uninstall/clear'],
  [/flutter(\.bat)?\s+(install|run)(\s|$)/, 'flutter install/run on a device'],
  [/avdmanager([^|;&]*)\s(create|delete)(\s|$)/, 'creating or deleting an emulator'],
  [/emulator(\.exe)?([^|;&]*)-wipe-data/, 'wiping an emulator'],
];

/** Returns null to allow, or the reason to deny. Throws on input it cannot trust (the caller denies). */
export function check(raw) {
  const input = JSON.parse(raw);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('hook input is not an object');
  if (input.tool_name !== 'Bash') return null;
  const cmd = input.tool_input?.command;
  if (typeof cmd !== 'string') throw new Error('Bash call without a command string');
  for (const line of cmd.split('\n'))
    for (const [re, why] of RULES) if (re.test(line)) return why;
  return null;
}

const deny = (why) => {
  console.error(`Blocked by the device guard: ${why}. Shared test devices are the owner's: never install, reinstall, uninstall or clear an app, and never create or wipe an emulator. If the build on the device is not the one you need, ask the board (Question for board) and stop device work.`);
  process.exit(2);
};

// run only when executed as the hook, not when a test imports check()
if (/device-guard\.mjs$/.test(process.argv[1] ?? '')) {
  try {
    const why = check(readFileSync(0, 'utf8'));
    if (why) deny(why);
  } catch (e) {
    deny(`the guard could not read this call (${e.message}), so it was refused`);
  }
}
