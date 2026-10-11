import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeWslFiles, credentialFolders, parseBackupList, okCopyDir, readInventory, listBackups, runBackup, runLeakScan, lastScan, WSL_SECRET_FILES } from '../src/safety.mjs';

const SK = 'sk-' + 'ant-api03-' + 'AbCdEfGhIjKlMnOpQrStUv';

test('WSL secret files: private is ok, group/other readable is a warning with the exact fix, missing is absent', () => {
  const r = Object.fromEntries(judgeWslFiles(['600|regular file|~/.config/jev-router/env', '644|regular file|~/.paperclip/instances/default/.env', '750|directory|~/.omniroute', '600|regular file|~/.config/gh/hosts.yml'].join('\n')).map((x) => [x.id, x]));
  assert.equal(r['jev-env'].state, 'ok'); assert.equal(r['pc-env'].state, 'warn'); assert.match(r['pc-env'].note, /chmod 600 ~\/\.paperclip\/instances\/default\/\.env/);
  assert.equal(r.omniroute.state, 'ok');                                                       // a directory only its group can enter
  assert.equal(judgeWslFiles('755|directory|~/.omniroute').find((x) => x.id === 'omniroute').state, 'warn');
  assert.equal(r['pc-key'].state, 'absent'); assert.equal(judgeWslFiles('').length, WSL_SECRET_FILES.length);
});

test('credential-looking folders are listed by name only, and files are ignored', () => {
  const r = credentialFolders([{ name: '_Credentials', path: 'C:\\U\\Downloads\\_Credentials', isDir: true }, { name: 'API keys', path: 'C:\\U\\Desktop\\API keys', isDir: true }, { name: 'passwords.txt', path: 'C:\\U\\Downloads\\passwords.txt', isDir: false }, { name: 'Photos', path: 'C:\\U\\Desktop\\Photos', isDir: true }]);
  assert.deepEqual(r.map((x) => x.path), ['C:\\U\\Downloads\\_Credentials', 'C:\\U\\Desktop\\API keys']); assert.match(r[0].note, /contents were not read/);
});

test('backup listing parses ls output, newest first, and skips non-backups', () => {
  const ls = ['total 940', '-rw-rw-r-- 1 syedabbas syedabbas 481534 2026-10-11 21:44 paperclip-20261011-214419.sql.gz', '-rw-rw-r-- 1 syedabbas syedabbas 470100 2026-10-11 20:44 paperclip-20261011-204401.sql.gz', '-rw-rw-r-- 1 syedabbas syedabbas 12 2026-10-11 22:00 notes.txt'].join('\n');
  const b = parseBackupList(ls); assert.deepEqual(b.map((x) => x.name), ['paperclip-20261011-214419.sql.gz', 'paperclip-20261011-204401.sql.gz']); assert.equal(b[0].bytes, 481534);
  assert.equal(new Date(b[0].at).getHours(), 21);
});

test('listBackups reads the settings and the folder through wsl --exec, and degrades when WSL is down', async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push(args); if (args.join(' ').includes('config.json')) return { stdout: '/home/u/.paperclip/instances/default/data/backups|true|60|30\n' }; return { stdout: '-rw-rw-r-- 1 u u 100 2026-10-11 21:44 paperclip-x.sql.gz\n' }; };
  const r = await listBackups({ distro: 'U', backupCopyDir: 'D:\\Stack' }, { exec });
  assert.equal(r.available, true); assert.equal(r.automatic, true); assert.equal(r.everyMinutes, 60); assert.equal(r.keepDays, 30); assert.equal(r.count, 1); assert.equal(r.copyDir, 'D:\\Stack');
  assert.ok(calls.every((a) => a[2] === '--exec'), 'no shell between wsl.exe and bash'); assert.deepEqual(calls[1].slice(-2), ['_', '/home/u/.paperclip/instances/default/data/backups']);   // the folder travels as an argument
  assert.equal((await listBackups({ distro: 'U' }, { exec: async () => { throw new Error('wsl down'); } })).available, false);
});

test('copy folder validation: absolute drive paths only, no control characters or odd syntax', () => {
  for (const ok of ['D:\\Backups\\agent-stack', 'C:/Users/me/Backups', 'E:\\My Backups\\stack $1']) assert.equal(okCopyDir(ok), true, ok);
  for (const bad of ['Backups', '\\\\server\\share', 'D:\\a"b', 'D:\\a\nb', 'D:\\x|y', 'D:\\x?', '', null, undefined, 42]) assert.equal(okCopyDir(bad), false, String(bad));
});

test('a backup runs db:backup, and copies the file as plain arguments (nothing is interpolated into the shell command)', async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push(args); return { stdout: args.join(' ').includes('db:backup') ? JSON.stringify({ path: '/home/u/.paperclip/instances/default/data/backups/paperclip-20261011-220000.sql.gz', bytes: 1 }) : '' }; };
  const dir = 'D:\\Back ups\\$(touch pwned)';
  const r = await runBackup({ distro: 'U', backupCopyDir: dir }, { exec });
  assert.equal(r.file.endsWith('.sql.gz'), true); assert.equal(r.copied, dir);
  assert.match(calls[0].at(-1), /paperclipai db:backup --json/);
  const cp = calls[1]; assert.equal(cp[2], '--exec'); assert.equal(cp[4], '-c'); assert.equal(cp[5], 'mkdir -p -- "$2" && cp -- "$1" "$2"/');       // a fixed script
  assert.equal(cp[7], r.file); assert.equal(cp[8], '/mnt/d/Back ups/$(touch pwned)');                                                          // data only in arguments
  const none = await runBackup({ distro: 'U' }, { exec }); assert.equal(none.copied, null);
  const badDir = await runBackup({ distro: 'U', backupCopyDir: 'relative' }, { exec }); assert.equal(badDir.copied, null);
  const failing = await runBackup({ distro: 'U', backupCopyDir: 'D:\\x' }, { exec: async (c, a) => { if (a.join(' ').includes('cp --')) throw new Error('disk gone'); return { stdout: '{"path":"/home/u/b.sql.gz"}' }; } });
  assert.equal(failing.copied, false);                                                                                                         // the backup itself still succeeded
});

test('inventory: WSL down is "unknown", an unignored config.env is a warning, missing files are absent', async () => {
  const fsx = { exists: (p) => p.endsWith('config.env'), readdir: () => [] };
  const down = await readInventory({ distro: 'U', repo: 'C:\\r' }, { exec: async () => { throw new Error('x'); }, fs: fsx, env: { LOCALAPPDATA: 'C:\\L', USERPROFILE: 'C:\\U' } });
  assert.equal(down[0].state, 'unknown'); assert.equal(down.find((x) => x.id === 'config-env').state, 'warn'); assert.match(down.find((x) => x.id === 'config-env').note, /NOT excluded/);
  assert.equal(down.find((x) => x.id === 'hermes-env').state, 'absent');
  const ign = await readInventory({ distro: 'U', repo: 'C:\\r' }, { exec: async (c) => (c === 'git' ? { stdout: '' } : { stdout: '' }), fs: fsx, env: { LOCALAPPDATA: 'C:\\L', USERPROFILE: 'C:\\U' } });
  assert.equal(ign.find((x) => x.id === 'config-env').state, 'ok');
});

test('leak scan: aggregates every scope, reports file/line/kind only, saves its result, and survives a failing scope', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ls-')), app = mkdtempSync(join(tmpdir(), 'la-'));
  writeFileSync(join(d, 'notes.env'), `ANTHROPIC_API_KEY=${SK}\n`); writeFileSync(join(d, 'clean.txt'), 'nothing\n'); writeFileSync(join(app, 'audit.jsonl'), '{"ok":1}\n');
  const exec = async (cmd, args) => {
    if (cmd === 'git') return { stdout: 'notes.env\nclean.txt\n' };
    if (args.join(' ').includes('--stdin')) throw new Error('journal unreadable ' + 'token=abcdef123456');
    return { stdout: JSON.stringify({ scanned: 3, skipped: 1, findings: [{ file: '~/.agent-stack/x.json', line: 7, kind: 'JWT' }] }) };
  };
  const r = await runLeakScan({ distro: 'U', repo: d }, { exec, appDir: app, cliPath: '/mnt/c/x/cli.mjs' });
  assert.equal(r.total, 3); assert.deepEqual(r.scopes.map((s) => s.name), ['Repository (tracked files)', 'App data on Windows', 'Reconciler state and router log (WSL)', 'Service logs (WSL journal)']);
  assert.deepEqual(r.findings.map((f) => f.file + ':' + f.line + ':' + f.kind).sort(), ['notes.env:1:API key', 'notes.env:1:Secret assignment', '~/.agent-stack/x.json:7:JWT']);   // a line can match two rules
  assert.ok(r.findings.some((f) => f.file === 'notes.env' && f.line === 1)); assert.ok(r.findings.some((f) => f.kind === 'JWT'));
  assert.match(r.scopes[3].error, /journal unreadable/); assert.doesNotMatch(r.scopes[3].error, /abcdef123456/);        // one scope failing never hides the others, and its error is redacted
  const saved = readFileSync(join(app, 'secret-scan.json'), 'utf8'); assert.ok(!saved.includes('AbCdEfGh') && !JSON.stringify(r).includes('AbCdEfGh'));       // the value is nowhere
  assert.equal(lastScan(app).total, 3); assert.equal(lastScan(join(app, 'nope')), null);
});

// ---- needs, audited actions, endpoint ----
import http from 'node:http';
import { createAudit } from '../src/audit.mjs';
import { createSafetyActions } from '../src/safety.mjs';
import { deriveNeeds } from '../src/needs.mjs';
import { createServer } from '../server.mjs';

const NOW = new Date('2026-10-11T18:00:00Z');
const bk = (hoursAgo, over = {}) => ({ available: true, automatic: true, count: 1, backups: [{ name: 'b', bytes: 1, at: new Date(NOW - hoursAgo * 3600000).toISOString() }], ...over });
const needFor = (safety) => deriveNeeds({ services: [], paperclip: { up: true, crew: [] }, diskFreeGB: 80, safety, now: NOW });

test('needs: backups missing or stale, secret places to look at, and leaks found', () => {
  assert.equal(needFor({ backups: bk(1), inventory: [], lastScan: null }).length, 0);
  assert.match(needFor({ backups: { available: true, count: 0, backups: [] } })[0].title, /no database backups/);
  assert.match(needFor({ backups: bk(9) })[0].title, /9 hours old/);
  assert.equal(needFor({ backups: bk(9, { automatic: false }) }).length, 0);                               // with automatic backups off, daily is the bar
  assert.match(needFor({ backups: bk(30, { automatic: false }) })[0].why, /off/);
  assert.equal(needFor({ backups: { available: false } }).length, 0);                                       // unknown is not a problem to nag about
  const loc = needFor({ inventory: [{ state: 'warn', path: 'C:\\U\\Downloads\\_Credentials' }, { state: 'ok', path: 'x' }] }); assert.match(loc[0].title, /1 secret location needs a look/); assert.match(loc[0].why, /Downloads\/_Credentials/);
  const leak = needFor({ lastScan: { total: 2 } })[0]; assert.equal(leak.level, 'fail'); assert.match(leak.title, /2 possible secrets/);
  assert.equal(needFor({ lastScan: { total: 0 } }).length, 0);
});

function actionRig(over = {}) {
  const calls = [], app = mkdtempSync(join(tmpdir(), 'sa-')), audit = createAudit(app); let refreshed = 0, t = 1000;
  const exec = over.exec ?? (async (cmd, args) => { calls.push(args.join(' ')); return { stdout: cmd === 'git' ? '' : (args.join(' ').includes('db:backup') ? '{"path":"/home/u/b.sql.gz"}' : JSON.stringify({ scanned: 1, skipped: 0, findings: [] })) }; });
  const s = createSafetyActions({ settings: { distro: 'U', repo: app }, audit, io: { exec }, appDir: app, refresh: async () => { refreshed++; }, now: () => t, cooldownMs: 5000 });
  return { s, audit, calls, refreshed: () => refreshed, tick: (ms) => { t += ms; } };
}

test('safety actions: only scan and backup, one at a time, with a cool-down, each audited without secrets', async () => {
  const r = actionRig();
  for (const a of ['', 'restore', 'delete', 'scan; rm -rf', '__proto__']) assert.equal((await r.s.run({ action: a })).status, 400);
  assert.equal(r.calls.length, 0);
  const scan = await r.s.run({ action: 'scan' }); assert.equal(scan.status, 200); assert.equal(scan.result.total, 0); assert.equal(r.refreshed(), 1);
  assert.equal((await r.s.run({ action: 'backup' })).status, 429); r.tick(6000);                              // cool-down
  const bak = await r.s.run({ action: 'backup' }); assert.equal(bak.status, 200); assert.equal(bak.result.file, '/home/u/b.sql.gz');
  const log = r.audit.recent(5); assert.deepEqual(log.map((x) => [x.service, x.action, x.ok]), [['safety', 'backup', true], ['safety', 'scan', true]]);
  assert.equal(log[0].file, 'b.sql.gz'); assert.equal(log[1].findings, 0);
});

test('safety actions: a running one blocks the next, and failures are redacted and audited', async () => {
  let release; const gate = new Promise((x) => { release = x; });
  const r = actionRig({ exec: async () => { await gate; return { stdout: '{}' }; } });
  const first = r.s.run({ action: 'backup' }); await new Promise((x) => setTimeout(x, 5));
  assert.equal((await r.s.run({ action: 'scan' })).status, 409); release(); await first;
  const bad = actionRig({ exec: async () => { throw new Error('pg_dump failed: token=abcdef123456'); } });
  const f = await bad.s.run({ action: 'backup' }); assert.equal(f.status, 500); assert.doesNotMatch(f.error, /abcdef123456/); assert.equal(bad.audit.recent(1)[0].ok, false); assert.doesNotMatch(bad.audit.recent(1)[0].error, /abcdef123456/);
});

test('POST /api/safety needs the token and JSON, and refuses unknown actions', async () => {
  const r = actionRig();
  const { server, token } = createServer({ store: { get: async () => ({}) }, token: 'k', safety: r.s });
  await new Promise((x) => server.listen(0, '127.0.0.1', x)); const port = server.address().port;
  const post = (body, headers) => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port, path: '/api/safety', method: 'POST', headers }, (rs) => { let b = ''; rs.on('data', (d) => (b += d)); rs.on('end', () => res({ status: rs.statusCode, body: b })); }); q.on('error', rej); q.end(body); });
  try {
    assert.equal((await post('{"action":"scan"}', { 'content-type': 'application/json' })).status, 401);
    assert.equal((await post('{"action":"scan"}', { 'x-stack-token': token, 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('{"action":"format-disk"}', { 'x-stack-token': token, 'content-type': 'application/json' })).status, 400);
    assert.equal((await post('{"action":"scan"}', { 'x-stack-token': token, 'content-type': 'application/json' })).status, 200);
  } finally { server.close(); }
});
