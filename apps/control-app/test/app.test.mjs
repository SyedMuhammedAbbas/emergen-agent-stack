import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseSystemdShow, parseSystemdTime, parseSchtasks, httpProbe, wslRunning, diskFreeGB } from '../src/probes.mjs';
import { judge, readServices, DEFS } from '../src/services.mjs';
import { moodOf, summariseRuns, projectMonth, readPaperclip } from '../src/paperclip.mjs';
import { deriveNeeds, headline } from '../src/needs.mjs';
import { createStore } from '../src/state.mjs';
import { createServer } from '../server.mjs';

// ---- captured from this PC (spikes/m2-step0.mjs) ----
const SYSTEMD = `Id=paperclipai.service
ActiveState=active
SubState=running
ActiveEnterTimestamp=Sun 2026-10-11 20:41:48 PKT
MemoryCurrent=952020992
NRestarts=0
LoadState=loaded

Id=agent-watchdog.timer
ActiveState=active
SubState=waiting
ActiveEnterTimestamp=Sun 2026-10-11 20:41:43 PKT
LoadState=loaded
`;
const SCHT = `Folder: \\\nTaskName:                             \\WSL-Agents-Keepalive\nNext Run Time:                       11/10/2026 9:47:34 pm\nStatus:                              Running\n`;

test('parsers: systemd blocks, times, schtasks', () => {
  const u = parseSystemdShow(SYSTEMD);
  assert.equal(u.length, 2); assert.equal(u[0].Id, 'paperclipai.service'); assert.equal(u[0].MemoryCurrent, '952020992'); assert.equal(u[1].SubState, 'waiting');
  assert.equal(new Date(parseSystemdTime('Sun 2026-10-11 20:41:48 PKT')).getHours(), 20);
  assert.equal(parseSystemdTime('n/a'), null);
  assert.deepEqual(parseSchtasks(SCHT), { exists: true, status: 'Running', nextRun: '11/10/2026 9:47:34 pm' });
});

test('probes degrade to "down", never throw', async () => {
  assert.equal((await httpProbe('http://x', { fetch: async () => { throw Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } }); } })).error, 'ECONNREFUSED');
  assert.equal((await httpProbe('http://x', { fetch: async () => ({ status: 404 }) })).ok, true);       // something answers
  assert.equal((await httpProbe('http://x', { fetch: async () => ({ status: 502 }) })).ok, false);
  assert.equal(await wslRunning('U', { exec: async () => { throw new Error('no wsl'); } }), false);
  assert.equal(await wslRunning('Ubuntu-24.04', { exec: async () => ({ stdout: 'Ubuntu-24.04\r\n' }) }), true);
  assert.equal(diskFreeGB('C:\\', { statfs: () => { throw new Error('x'); } }), null);
  assert.equal(diskFreeGB('C:\\', { statfs: () => ({ bavail: 1e9, bsize: 4096 }) }), 4096);
});

const now = new Date(2026, 9, 11, 21, 35, 0).getTime();
const up = { ActiveState: 'active', ActiveEnterTimestamp: 'Sun 2026-10-11 20:41:48 PKT', MemoryCurrent: '952020992', NRestarts: '0', LoadState: 'loaded' };
const D = Object.fromEntries(DEFS.map((d) => [d.id, d]));

test('judging a service: the whole matrix', () => {
  const ok = judge(D.paperclip, { wsl: true, units: { 'paperclipai.service': up }, http: { ok: true }, now });
  assert.equal(ok.state, 'ok'); assert.equal(ok.memMB, 908); assert.equal(ok.uptimeSec, 53 * 60 + 12);
  assert.equal(judge(D.paperclip, { wsl: true, units: { 'paperclipai.service': up }, http: { ok: false }, now }).state, 'warn');
  assert.equal(judge(D.paperclip, { wsl: true, units: { 'paperclipai.service': { ...up, ActiveState: 'inactive' } }, http: { ok: false }, now }).state, 'fail');
  assert.equal(judge(D.paperclip, { wsl: true, units: { 'paperclipai.service': { ...up, ActiveState: 'activating' } }, http: {}, now }).text, 'Starting');
  assert.equal(judge(D.paperclip, { wsl: false, units: null, http: { ok: false }, now }).state, 'unknown');
  assert.equal(judge(D.paperclip, { wsl: true, units: {}, http: {}, now }).state, 'off');
  assert.equal(judge(D.paperclip, { wsl: true, units: null, http: {}, now }).state, 'unknown');
  assert.equal(judge(D.wsl, { wsl: false }).state, 'fail');
  assert.equal(judge(D.keepalive, { task: { exists: true, status: 'Running' } }).state, 'ok');
  assert.equal(judge(D.keepalive, { task: { exists: false } }).state, 'fail');
  assert.equal(judge(D.hermes, { task: { exists: false } }).state, 'off');
  assert.equal(judge(D.watchdog, { wsl: true, units: { 'agent-watchdog.timer': { ...up, MemoryCurrent: '[not set]' } }, http: undefined, now }).state, 'ok');
});

test('readServices: one wsl.exe call for all units, none when WSL is down', async () => {
  let calls = [];
  const exec = async (cmd, args) => { calls.push(cmd + ' ' + args.join(' ')); if (cmd === 'wsl.exe' && args[0] === '-l') return { stdout: 'Ubuntu-24.04\n' }; if (cmd === 'wsl.exe') return { stdout: SYSTEMD }; return { stdout: SCHT }; };
  const fetch = async () => ({ status: 200 });
  const s = await readServices({ distro: 'Ubuntu-24.04' }, { exec, fetch, now: () => now });
  assert.equal(calls.filter((c) => c.includes('systemctl')).length, 1);
  assert.equal(s.find((x) => x.id === 'paperclip').state, 'ok');
  assert.equal(s.find((x) => x.id === 'jev').state, 'off');                        // unit missing from the (shortened) fixture
  calls = [];
  const down = await readServices({ distro: 'Ubuntu-24.04' }, { exec: async (c, a) => (a[0] === '-l' ? { stdout: '' } : { stdout: SCHT }), fetch: async () => { throw new Error('refused'); }, now: () => now });
  assert.equal(down.find((x) => x.id === 'wsl').state, 'fail');
  assert.equal(down.find((x) => x.id === 'paperclip').state, 'unknown');
});

test('crew moods match the Claude mod', () => {
  assert.deepEqual(['running', 'active', 'working', 'error', 'paused', 'idle', undefined].map(moodOf), ['working', 'working', 'working', 'error', 'paused', 'idle', 'idle']);
});

test('spend: month and today, API vs subscription, other months ignored', () => {
  const n = new Date(2026, 9, 11, 21, 0, 0);
  const runs = [
    { createdAt: '2026-10-11T10:00:00', finishedAt: '2026-10-11T10:05:00', usageJson: { costUsd: 0.25, billingType: 'subscription_included' } },
    { createdAt: '2026-10-05T10:00:00', finishedAt: '2026-10-05T10:05:00', usageJson: { costUsd: 1.5, billingType: 'api' } },
    { createdAt: '2026-09-30T10:00:00', finishedAt: '2026-09-30T10:05:00', usageJson: { costUsd: 9, billingType: 'api' } },
    { createdAt: '2026-10-02T10:00:00', usageJson: null }];
  assert.deepEqual(summariseRuns(runs, n), { monthUsd: 1.75, apiUsd: 1.5, subscriptionUsd: 0.25, runsThisMonth: 3, runsToday: 1 });
  assert.equal(projectMonth(10, new Date(2026, 9, 10)), 31);
  assert.equal(projectMonth(10, new Date(2026, 9, 2)), null);
});

const fakePaperclip = (over = {}) => async (url) => {
  const p = new URL(url).pathname.replace('/api', '');
  const data = { '/companies': [{ id: 'c1', name: 'Emergen Engineering' }], '/companies/c1/agents': [{ id: 'a1', name: 'QA', title: 'QA', status: 'running', metadata: { stack: {} } }, { id: 'a2', name: 'Docs', title: 'Docs', status: 'error' }],
    '/companies/c1/heartbeat-runs': [{ id: 'r1', agentId: 'a1', status: 'succeeded', createdAt: '2026-10-11T10:00:00', finishedAt: '2026-10-11T10:05:00', usageJson: { costUsd: 0.5, billingType: 'subscription_included' } }], '/companies/c1/approvals': [{ id: 'x' }], ...over }[p];
  return data === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => data };
};

test('readPaperclip: crew, runs, approvals; failure becomes up:false', async () => {
  const r = await readPaperclip('http://x', { fetch: fakePaperclip(), now: new Date(2026, 9, 11, 21, 0) });
  assert.equal(r.crew.find((c) => c.name === 'QA').mood, 'working'); assert.equal(r.crew.find((c) => c.name === 'QA').plan, 'managed'); assert.equal(r.crew.find((c) => c.name === 'Docs').plan, 'unmanaged');
  assert.equal(r.runs.monthUsd, 0.5); assert.equal(r.approvalsPending, 1); assert.equal(r.recent[0].agent, 'QA');
  assert.equal((await readPaperclip('http://x', { fetch: async () => { throw new Error('refused'); } })).up, false);
});

const svc = (id, state, extra = {}) => ({ id, title: id, about: id + ' about', state, ...extra });
test('needs and headline', () => {
  const healthy = [svc('wsl', 'ok'), svc('paperclip', 'ok'), svc('omniroute', 'ok'), svc('keepalive', 'ok'), svc('hermes', 'off')];
  let n = deriveNeeds({ services: healthy, paperclip: { up: true, approvalsPending: 0, crew: [] }, diskFreeGB: 80 });
  assert.deepEqual(n, []); assert.deepEqual(headline(healthy, n), { text: 'Everything is running.', level: 'ok', needCount: 0 });   // "not set up" is not a need
  const one = healthy.map((s) => (s.id === 'omniroute' ? svc('omniroute', 'fail') : s));
  n = deriveNeeds({ services: one, paperclip: { up: true, approvalsPending: 2, crew: [{ id: 'a2', name: 'Docs', mood: 'error' }] }, diskFreeGB: 3 });
  assert.deepEqual(n.map((x) => x.id), ['omniroute', 'agent-a2', 'disk', 'approvals']);   // problems first
  assert.equal(n.find((x) => x.id === 'disk').level, 'fail');
  assert.equal(headline(one, n).text, 'omniroute has stopped.');
  const wslDown = [svc('wsl', 'fail'), svc('paperclip', 'unknown'), svc('keepalive', 'ok')];
  n = deriveNeeds({ services: wslDown, paperclip: { up: false }, diskFreeGB: 80 });
  assert.deepEqual(n.map((x) => x.id), ['wsl']); assert.match(headline(wslDown, n).text, /WSL is not running/);
  const stuck = healthy.map((s) => (s.id === 'paperclip' ? svc('paperclip', 'warn') : s));
  assert.equal(headline(stuck, deriveNeeds({ services: stuck, paperclip: { up: true, crew: [] }, diskFreeGB: 80 })).text, 'paperclip is not answering.');   // never "Everything is running" with a need open
  assert.equal(deriveNeeds({ services: healthy.map((s) => (s.id === 'keepalive' ? svc('keepalive', 'fail') : s)), paperclip: { up: true, crew: [] }, diskFreeGB: 80 })[0].id, 'keepalive');
});

test('the store caches, coalesces concurrent refreshes, and builds the spend view', async () => {
  let reads = 0, t = new Date(2026, 9, 11, 21, 0, 0);
  const io = { exec: async (c, a) => { if (a[0] === '-l') { reads++; return { stdout: 'Ubuntu-24.04\n' }; } return c === 'wsl.exe' ? { stdout: SYSTEMD } : { stdout: SCHT }; }, fetch: async (u) => (String(u).includes('/api/companies') ? fakePaperclip()(u) : { status: 200 }), diskFreeGB: () => 80 };
  const s = createStore({ settings: { distro: 'Ubuntu-24.04', paperclip: 'http://x', budgetUsd: 100, alertAt: 0.8 }, io, ttlMs: 5000, now: () => t });
  const [a, b] = await Promise.all([s.get(), s.get()]); assert.equal(reads, 1); assert.equal(a, b);
  await s.get(); assert.equal(reads, 1);                                             // fresh: served from cache
  t = new Date(+t + 6000); await s.get(); assert.equal(reads, 2);                    // stale: new reading
  assert.equal(a.spend.monthUsd, 0.5); assert.equal(a.spend.pct, 0.5); assert.equal(a.spend.budgetUsd, 100); assert.equal(a.runs.today, 1);
  assert.equal(a.headline.level === 'ok' || a.headline.level === 'warn' || a.headline.level === 'fail', true);
});

// ---- server security ----
const get = (port, path, headers = {}) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port, path, headers }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej); });
test('server: token, Host, Origin, traversal, methods', async () => {
  const { server, token } = createServer({ store: { get: async () => ({ ok: 1 }) }, token: 'secret' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
  try {
    assert.equal((await get(port, '/api/state')).status, 401);
    assert.equal((await get(port, '/api/state', { 'x-stack-token': 'wrong' })).status, 401);
    assert.equal((await get(port, '/api/state', { 'x-stack-token': token })).body, '{"ok":1}');
    assert.equal((await get(port, '/api/state', { 'x-stack-token': token, host: 'evil.example' })).status, 403);
    assert.equal((await get(port, '/api/state', { 'x-stack-token': token, origin: 'http://evil.example' })).status, 403);
    assert.equal((await get(port, '/api/nope', { 'x-stack-token': token })).status, 404);
    assert.equal((await get(port, '/..%2f..%2fpackage.json')).status, 404);                    // path traversal
    assert.equal((await get(port, '/')).status, 200);                                          // the page itself needs no token; the data does
  } finally { server.close(); }
});
