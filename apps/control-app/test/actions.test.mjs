import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact } from '../src/redact.mjs';
import { createAudit } from '../src/audit.mjs';
import { createActions, CONTROL } from '../src/actions.mjs';
import { readLogs } from '../src/logs.mjs';
import { runDoctor, toWslPath } from '../src/doctor.mjs';
import { createServer } from '../server.mjs';

test('redact masks key-shaped strings and leaves ordinary text alone', () => {
  const secrets = ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv', 'ghp_1234567890abcdefghijABCDEFGHIJ', 'xoxb-1234567890-abcdefghij', 'AKIAABCDEFGHIJKLMNOP',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r', 'Bearer abcdef0123456789xyz', 'a'.repeat(8) + 'f'.repeat(40)];
  for (const s of secrets) assert.doesNotMatch(redact(`line ${s} end`), new RegExp(s.slice(0, 16).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `should hide: ${s.slice(0, 12)}…`);
  assert.match(redact('password=hunter22xyz'), /password=\[redacted\]/i);
  assert.match(redact('GET /?t=6ef3e0bcc0f0e7518672e07d17bae975 HTTP/1.1'), /t=\[redacted\]/);
  assert.equal(redact('Paperclip heartbeat run started agent=QA port 3100'), 'Paperclip heartbeat run started agent=QA port 3100');
});

test('audit: appends one JSON line per action, newest first, error text redacted', () => {
  const a = createAudit(mkdtempSync(join(tmpdir(), 'audit-')));
  a.add({ service: 'paperclip', action: 'restart', ok: true });
  a.add({ service: 'omniroute', action: 'stop', ok: false, error: 'failed with token=abcdef123456 in env' });
  const r = a.recent(5); assert.equal(r.length, 2); assert.equal(r[0].service, 'omniroute'); assert.equal(r[0].actor, 'local-user');
  assert.match(r[0].error, /token=\[redacted\]/); assert.doesNotMatch(readFileSync(a.file, 'utf8'), /abcdef123456/);
});

// ---- the action runner, against fakes ----
function rig({ working = 0, execImpl, settleMs = 50 } = {}) {
  const svcs = { paperclip: 'ok', jev: 'ok', omniroute: 'ok', keepalive: 'ok', wsl: 'ok' };
  const calls = [];
  const view = () => ({ services: Object.entries(svcs).map(([id, state]) => ({ id, state, text: state })), crew: Array.from({ length: working }, () => ({ mood: 'working' })) });
  const store = { get: async () => view(), refresh: async () => view() };
  const io = { exec: async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (execImpl) return execImpl(cmd, args, svcs);
    const unit = args.at(-1), act = args.at(-2);
    const id = { 'paperclipai.service': 'paperclip', 'jev-router.service': 'jev', 'omniroute.service': 'omniroute' }[unit];
    if (id) svcs[id] = act === 'stop' ? 'fail' : 'ok';
    if (cmd === 'schtasks.exe' && args[0] === '/run') { svcs.keepalive = 'ok'; svcs.wsl = 'ok'; }
    return { stdout: 'Status: Running\n' };
  } };
  const audit = createAudit(mkdtempSync(join(tmpdir(), 'act-')));
  const actions = createActions({ settings: { distro: 'Ubuntu-24.04' }, store, audit, io, wait: async () => {}, cooldownMs: 0, settleMs, pollMs: 1 });
  return { actions, calls, svcs, audit };
}

test('allow-list: unknown services and actions are refused, and nothing is executed', async () => {
  const { actions, calls } = rig();
  for (const [service, action] of [['nope', 'restart'], ['hermes', 'start'], ['keepalive', 'stop'], ['wsl', 'stop'], ['paperclip', 'rm -rf /'], ['paperclip; whoami', 'restart'], ['paperclip', '--force'], ['__proto__', 'start'], ['', '']]) {
    const r = await actions.run({ service, action }); assert.equal(r.status, 400, `${service}/${action}`);
  }
  assert.equal(calls.length, 0);
});

test('a restart runs exactly the systemctl command, no shell, then waits for the service to be running', async () => {
  const { actions, calls, audit } = rig();
  const r = await actions.run({ service: 'omniroute', action: 'restart' });
  assert.equal(r.status, 200); assert.equal(r.ok, true); assert.equal(r.state.state, 'ok');
  assert.deepEqual(calls[0], ['wsl.exe', '-d', 'Ubuntu-24.04', '--', 'systemctl', '--user', 'restart', 'omniroute.service']);
  assert.equal(audit.recent(1)[0].action, 'restart'); assert.equal(audit.recent(1)[0].ok, true);
});

test('stop waits for the stopped state', async () => {
  const { actions, svcs } = rig(); const r = await actions.run({ service: 'jev', action: 'stop' });
  assert.equal(r.ok, true); assert.equal(svcs.jev, 'fail');
});

test('busy guard: stopping or restarting while agents work needs force; start does not', async () => {
  const { actions, calls } = rig({ working: 2 });
  const r = await actions.run({ service: 'paperclip', action: 'stop' });
  assert.equal(r.status, 409); assert.equal(r.needsConfirm, 'busy'); assert.equal(r.working, 2); assert.equal(calls.length, 0);
  assert.equal((await actions.run({ service: 'paperclip', action: 'restart' })).status, 409);
  assert.equal((await actions.run({ service: 'paperclip', action: 'restart', force: true })).status, 200);
  assert.equal((await actions.run({ service: 'omniroute', action: 'start' })).status, 200);
  assert.equal((await actions.run({ service: 'paperclip', action: 'restart', force: 'yes' })).status, 409);       // only literal true counts
});

test('one action at a time, and a cool-down per service', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { actions } = rig({ execImpl: async () => { await gate; return { stdout: '' }; }, settleMs: 5 });
  const first = actions.run({ service: 'jev', action: 'start' });
  assert.equal((await actions.run({ service: 'omniroute', action: 'start' })).status, 409); release(); await first;
  const cool = createActions({ settings: { distro: 'U' }, store: { get: async () => ({ crew: [] }), refresh: async () => ({ services: [{ id: 'jev', state: 'ok' }] }) }, audit: createAudit(mkdtempSync(join(tmpdir(), 'c-'))), io: { exec: async () => ({}) }, wait: async () => {}, cooldownMs: 60000, settleMs: 5, pollMs: 1 });
  assert.equal((await cool.run({ service: 'jev', action: 'start' })).status, 200); assert.equal((await cool.run({ service: 'jev', action: 'start' })).status, 429);
});

test('failures are reported, redacted and audited', async () => {
  const { actions, audit } = rig({ execImpl: async () => { throw Object.assign(new Error('boom'), { stderr: 'Failed to restart: token=abcdef123456 denied' }); } });
  const r = await actions.run({ service: 'paperclip', action: 'restart' });
  assert.equal(r.status, 500); assert.equal(r.ok, false); assert.doesNotMatch(r.error, /abcdef123456/);
  const a = audit.recent(1)[0]; assert.equal(a.ok, false); assert.match(a.error, /Failed to restart/);
});

test('a service that never reaches the expected state is a failure, with the state it is in', async () => {
  const { actions } = rig({ execImpl: async () => ({ stdout: '' }), settleMs: 5 });     // exec "works" but the service stays up on a stop
  const r = await actions.run({ service: 'omniroute', action: 'stop' });
  assert.equal(r.ok, false); assert.match(r.error, /Did not reach the expected state/);
});

test('Start WSL uses the keepalive task when it exists, a one-shot wsl command otherwise', async () => {
  const withTask = rig({ execImpl: async (cmd, args) => ({ stdout: cmd === 'schtasks.exe' && args[0] === '/query' ? 'Status: Running\n' : '' }) });
  await withTask.actions.run({ service: 'wsl', action: 'start' });
  assert.deepEqual(withTask.calls.at(-1), ['schtasks.exe', '/run', '/tn', 'WSL-Agents-Keepalive']);
  const none = rig({ execImpl: async (cmd, args) => { if (cmd === 'schtasks.exe') throw new Error('not found'); return { stdout: '' }; } });
  await none.actions.run({ service: 'wsl', action: 'start' });
  assert.deepEqual(none.calls.at(-1), ['wsl.exe', '-d', 'Ubuntu-24.04', '--exec', 'true']);
});

test('CONTROL only contains what the UI is allowed to offer', () => {
  assert.deepEqual(Object.keys(CONTROL).sort(), ['jev', 'keepalive', 'omniroute', 'paperclip', 'wsl']);
  for (const d of Object.values(CONTROL)) for (const a of d.actions) assert.ok(['start', 'stop', 'restart'].includes(a));
});

test('logs: journalctl for units (redacted), task info for tasks, a message otherwise', async () => {
  let seen; const exec = async (cmd, args) => { seen = [cmd, ...args]; return { stdout: '2026-10-11T21:00:00 started\n2026-10-11T21:00:01 ANTHROPIC_API_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv ok\n' }; };
  const r = await readLogs('paperclip', { distro: 'Ubuntu-24.04' }, { exec });
  assert.deepEqual(seen.slice(0, 8), ['wsl.exe', '-d', 'Ubuntu-24.04', '--', 'journalctl', '--user', '-u', 'paperclipai.service']);
  assert.doesNotMatch(r.text, /sk-ant/); assert.match(r.text, /started/);
  for (const bad of ['constructor', '__proto__', 'toString', 'paperclipai.service; id']) assert.match((await readLogs(bad, { distro: 'x' }, { exec })).text, /No log is available/);
  assert.match((await readLogs('nonsense', { distro: 'x' }, { exec })).text, /No log is available/);
  assert.match((await readLogs('hermes', { distro: 'x' }, { exec: async () => { throw new Error('x'); } })).text, /not registered/);
});

// ---- doctor ----
const stateOf = (over = {}) => ({ services: ['wsl', 'keepalive', 'paperclip', 'jev', 'omniroute'].map((id) => ({ id, state: 'ok', text: 'Running', ...(over[id] ?? {}) })), disk: { cFreeGB: 80 }, ...(over.top ?? {}) });
const drExec = (o = {}) => async (cmd, args) => {
  const joined = [cmd, ...args].join(' ');
  if (cmd === 'claude') { if (o.winMissing) throw Object.assign(new Error('x'), { code: 'ENOENT' }); return { stdout: o.winLogin === false ? '{"loggedIn": false}' : '{"loggedIn": true}' }; }
  if (joined.includes('auth status')) return { stdout: o.wslLogin === false ? '{"loggedIn": false}' : '{"loggedIn": true}' };
  if (joined.includes('stack.mjs')) { if (o.contract === false) throw Object.assign(new Error('x'), { code: 2, stdout: 'FAIL PATCH /api/agents/{id} accepts metadata' }); return { stdout: 'contract ok' }; }
  if (joined.includes('path.conf') && o.noPath) throw new Error('grep failed');
  return { stdout: '' };
};
const doc = (state, o = {}) => runDoctor({ settings: { distro: 'Ubuntu-24.04', paperclip: 'http://x' }, state, repo: 'C:\\Abbas\\Emergen\\agent-stack', io: { exec: drExec(o), fetch: async () => ({ json: async () => ({ version: '2026.1005.0' }) }) } });
const by = (r, id) => r.results.find((x) => x.id === id);

test('doctor: a healthy system passes, and fixes are only ever service starts/restarts', async () => {
  const r = await doc(stateOf());
  assert.equal(r.counts.fail ?? 0, 0); assert.equal(by(r, 'paperclip').status, 'ok'); assert.equal(by(r, 'contract').status, 'ok'); assert.equal(by(r, 'claude-wsl').status, 'ok');
});

test('doctor: seeded faults produce the right finding and a safe fix (or none)', async () => {
  let r = await doc(stateOf({ wsl: { state: 'fail' }, paperclip: { state: 'unknown' } }));
  assert.deepEqual(by(r, 'wsl').fix, { service: 'wsl', action: 'start', label: 'Start WSL' });
  assert.equal(by(r, 'paperclip').status, 'warn'); assert.match(by(r, 'paperclip').detail, /WSL/); assert.equal(by(r, 'contract').status, 'warn');
  r = await doc(stateOf({ omniroute: { state: 'fail', text: 'Stopped' } })); assert.deepEqual(by(r, 'omniroute').fix, { service: 'omniroute', action: 'start', label: 'Start OmniRoute' });
  r = await doc(stateOf({ jev: { state: 'warn', text: 'Running but not answering' } })); assert.equal(by(r, 'jev').fix.action, 'restart');
  r = await doc(stateOf({ keepalive: { state: 'fail', text: 'Not registered' } })); assert.equal(by(r, 'keepalive').status, 'fail'); assert.equal(by(r, 'keepalive').fix, undefined);
  r = await doc(stateOf({ keepalive: { state: 'warn', text: 'Ready' } })); assert.deepEqual(by(r, 'keepalive').fix, { service: 'keepalive', action: 'start', label: 'Start the keepalive' });
  r = await doc(stateOf({ top: { disk: { cFreeGB: 3 } } })); assert.equal(by(r, 'disk').status, 'fail');
  r = await doc(stateOf({ top: { disk: { cFreeGB: 9 } } })); assert.equal(by(r, 'disk').status, 'warn');
  r = await doc(stateOf(), { wslLogin: false }); assert.equal(by(r, 'claude-wsl').status, 'fail');
  r = await doc(stateOf(), { winMissing: true }); assert.equal(by(r, 'claude-win').status, 'warn');
  r = await doc(stateOf(), { noPath: true }); assert.equal(by(r, 'service-path').status, 'fail');
  r = await doc(stateOf(), { contract: false }); assert.equal(by(r, 'contract').status, 'fail'); assert.match(by(r, 'contract').detail, /metadata/);
  for (const x of (await doc(stateOf({ wsl: { state: 'fail' }, omniroute: { state: 'fail' }, keepalive: { state: 'warn', text: 'Ready' } }))).results.filter((y) => y.fix)) assert.ok(['start', 'restart'].includes(x.fix.action));
});

test('doctor: paths and a check that throws', async () => {
  assert.equal(toWslPath('C:\\Abbas\\Emergen\\agent-stack'), '/mnt/c/Abbas/Emergen/agent-stack');
  const r = await runDoctor({ settings: { distro: 'U', paperclip: 'http://x' }, state: stateOf(), repo: 'C:\\Abbas\\Emergen\\agent-stack', io: { exec: async () => { throw new Error('everything broke'); }, fetch: async () => { throw new Error('refused'); } } });
  assert.ok(r.results.length >= 10); assert.ok(r.results.every((x) => ['ok', 'warn', 'fail'].includes(x.status)));   // nothing escapes as an exception
});

// ---- server: the new routes keep the same guard rails ----
const call = (port, method, path, { headers = {}, body } = {}) => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port, path, method, headers }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b })); }); q.on('error', rej); if (body) q.write(body); q.end(); });
test('server: POST needs JSON and the token; action/doctor/logs/audit are wired', async () => {
  const { actions, audit } = rig();
  const { server, token } = createServer({ store: { get: async () => ({ services: [], crew: [], disk: {} }) }, token: 'k', actions, audit, settings: { distro: 'U', paperclip: 'http://x' }, io: { exec: async () => ({ stdout: 'log line' }), fetch: async () => { throw new Error('x'); } } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const port = server.address().port, H = { 'x-stack-token': token };
  try {
    assert.equal((await call(port, 'POST', '/api/action', { body: '{}', headers: { 'content-type': 'application/json' } })).status, 401);
    assert.equal((await call(port, 'POST', '/api/action', { body: '{}', headers: { ...H, 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await call(port, 'POST', '/api/action', { body: '{not json', headers: { ...H, 'content-type': 'application/json' } })).status, 400);
    assert.equal((await call(port, 'POST', '/api/action', { body: JSON.stringify({ service: 'paperclip', action: 'delete-everything' }), headers: { ...H, 'content-type': 'application/json' } })).status, 400);
    assert.equal((await call(port, 'POST', '/api/action', { body: JSON.stringify({ service: 'jev', action: 'restart' }), headers: { ...H, 'content-type': 'application/json' } })).status, 200);
    assert.equal((await call(port, 'POST', '/api/action', { body: JSON.stringify({ service: 'jev', action: 'restart' }), headers: { ...H, 'content-type': 'application/json', origin: 'http://evil.example' } })).status, 403);
    assert.equal(JSON.parse((await call(port, 'GET', '/api/audit', { headers: H })).body)[0].service, 'jev');
    assert.match((await call(port, 'GET', '/api/logs?service=paperclip', { headers: H })).body, /log line/);
    assert.equal((await call(port, 'POST', '/api/doctor', { body: '{}', headers: { ...H, 'content-type': 'application/json' } })).status, 200);
    assert.equal((await call(port, 'POST', '/api/state', { body: '{}', headers: { ...H, 'content-type': 'application/json' } })).status, 404);
  } finally { server.close(); }
});
