// node --test wsl/hooks/
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from './device-guard.mjs';

const hook = fileURLToPath(new URL('./device-guard.mjs', import.meta.url));
const bash = (command) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
const run = (stdin) => spawnSync(process.execPath, [hook], { input: stdin, encoding: 'utf8' });

test('blocks device installs, uninstalls and emulator changes', () => {
  for (const c of [
    'adb install test.apk', 'adb -s emulator-5554 uninstall com.x', '$ADB -s R5CT install -r app.apk',
    '$ADB install -r build/app.apk','adb shell pm clear com.x', 'sh -c "pm install a.apk"', 'flutter install',
    'flutter run -d emu', 'avdmanager create avd -n x', 'avdmanager delete avd -n x', 'emulator -avd x -wipe-data',
    'ls\nadb install a.apk\necho done', 'ADB.EXE INSTALL a.apk',
  ]) assert.ok(check(bash(c)), `should block: ${c}`);
});

test('allows ordinary commands and other tools', () => {
  for (const c of ['ls -la', 'npm test', 'git commit -m "install guide"', 'adb devices', 'adb logcat -d', 'echo pmx install'])
    assert.equal(check(bash(c)), null, `should allow: ${c}`);
  assert.equal(check(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'adb install' } })), null);
});

test('rules apply per line, like grep did (no match across lines)', () => {
  assert.equal(check(bash('adb devices\necho install')), null);
});

test('exit codes: blocked = 2 with a message, allowed = 0', () => {
  const b = run(bash('adb install x.apk'));
  assert.equal(b.status, 2);
  assert.match(b.stderr, /Blocked by the device guard/);
  assert.equal(run(bash('ls')).status, 0);
});

test('fails closed on anything it cannot trust', () => {
  for (const bad of ['', 'not json', '{', 'null', '[]', '"x"', JSON.stringify({ tool_name: 'Bash' }),
                     JSON.stringify({ tool_name: 'Bash', tool_input: { command: 42 } })]) {
    const r = run(bad);
    assert.equal(r.status, 2, `should deny input: ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /could not read this call/);
  }
});
