// Dev only: serves the real UI with synthetic readings, to look at problem states without stopping anything.
//   node apps/control-app/dev/fixture-server.mjs [--port 4791]      then open the printed link
//   scenarios: ok | svc (OmniRoute stopped, an agent in error, approvals) | wsl (WSL down) | paperclip (Paperclip unreachable)
//   switch with:  http://127.0.0.1:4792/set/<scenario>
// The readings go through the same deriveNeeds/headline code as the real app.
import http from 'node:http';
import { createServer } from '../server.mjs';
import { deriveNeeds, headline } from '../src/needs.mjs';
import { loadCache, mergeRuns, buildCost, buildActivity } from '../src/costs.mjs';
import { buildTeam } from '../src/team.mjs';
import { pathsOf, tiersOf } from '../src/models.mjs';

const svc = (id, title, about, kind, state, extra = {}) => ({ id, title, about, kind, port: null, state, text: { ok: 'Running', fail: 'Stopped', unknown: 'Unknown (WSL is down)', off: 'Not set up', warn: 'Running but not answering' }[state], ...extra });
const crew = (down) => ['Manager|Engineering Manager', 'CTO|CTO', 'Frontend Engineer|Frontend', 'Backend Engineer|Backend', 'DevOps Engineer|DevOps', 'SecOps Engineer|SecOps', 'QA|QA', 'UX Reviewer|UX', 'Docs|Docs', 'Estimator|Estimator', 'Chief of Staff|CoS', 'Timekeeper|TK', 'Watchdog|WD', 'Brand Lead|BL', 'Designer|D', 'Video Generator|VG', 'Orrisian Content|OC', 'Upwork Scout|US']
  .map((x, i) => { const [name, title] = x.split('|'); return { id: 'a' + i, name, title, mood: down === 'wsl' ? 'paused' : name === 'Docs' && down === 'svc' ? 'error' : [2, 3, 17].includes(i) ? 'working' : 'idle', plan: 'managed' }; });

// synthetic runs for the whole month so the cost and activity screens have something awkward to lay out
const TITLES = ['EME-45 Fix the login layout on very small screens and improve the error message wording', 'EME-44 Add pagination to /orders', 'EME-43 Review the whole onboarding flow end to end', null, 'Stall sweep'];
function ledger(budgetUsd) {
  const names = crew('ok'), now = new Date(), runs = []; let k = 0;
  for (let d = 1; d <= now.getDate(); d++) for (let i = 0; i < 4; i++, k++) { const a = names[(k * 7) % names.length];
    runs.push({ id: 'r' + k, agentId: a.id, status: k % 11 === 0 ? 'failed' : 'succeeded', createdAt: new Date(now.getFullYear(), now.getMonth(), d, 9 + i).toISOString(), finishedAt: new Date(now.getFullYear(), now.getMonth(), d, 9 + i, 5).toISOString(),
      usageJson: { costUsd: 0.12 + ((k * 37) % 90) / 100, billingType: k % 5 === 0 ? 'api' : 'subscription_included', model: k % 3 ? 'claude-sonnet-5' : 'claude-opus-5-5', inputTokens: 40000, outputTokens: 900, cachedInputTokens: 300000 } }); }
  const cache = mergeRuns(loadCache('/nonexistent'), runs); runs.forEach((r, i) => { cache.titles[r.id] = TITLES[i % TITLES.length] ?? ''; });
  const byId = new Map(names.map((a) => [a.id, a]));
  return { cache, byId, cost: buildCost(cache, byId, now, { budgetUsd, alertAt: 0.8 }) };
}

// Team states for the audit: keeping an edit, will update, a decision (long diff), not managed
function teamFor(c, name) {
  const long = Array.from({ length: 40 }, (_, i) => 'A fairly long instruction line number ' + i + ' that the template and the live copy disagree about, to check wrapping').join('\n');
  const raw = c.map((x, i) => ({ id: x.id, name: x.name, title: x.title, role: 'qa', status: 'idle', budgetMonthlyCents: 300 + i * 100, reportsTo: i ? c[0].id : null, adapterConfig: { model: i % 3 ? 'claude-sonnet-5' : undefined, env: i % 3 ? {} : { ANTHROPIC_BASE_URL: '*' } }, metadata: x.name === 'Watchdog' ? null : { stack: { key: x.name.toLowerCase().replace(/ /g, '-') } } }));
  const key = (n) => n.toLowerCase().replace(/ /g, '-'), id = (n) => c.find((x) => x.name === n).id;
  const plan = { agents: c.map((x) => ({ id: x.id, key: key(x.name), action: 'noop', fields: [] })) };
  const set = (n, action, fields) => { const a = plan.agents.find((x) => x.id === id(n)); a.action = action; a.fields = fields; };
  set('Estimator', 'record', [{ field: 'instructions', op: 'keep-live', from: long, to: long.replace(/line number 1/, 'line number ONE').replace('number 7', 'number SEVEN') }]);
  set('QA', 'update', [{ field: 'title', op: 'update', from: 'QA', to: 'Senior QA engineer for the whole delivery pipeline' }]);
  if (name === 'svc') set('Docs', 'needs-decision', [{ field: 'skills', op: 'conflict', from: ['a', 'b'], to: ['a', 'c'] }, { field: 'instructions', op: 'conflict', from: long, to: long.split('\n').reverse().join('\n') }]);
  return buildTeam(raw, name === 'wsl' || name === 'paperclip' ? null : plan, { ranAt: new Date().toISOString(), error: name === 'wsl' ? 'WSL is down' : null });
}

function modelsFor(name, team) {
  const down = name === 'wsl' || name === 'paperclip' && false;
  const cfg = { tiers: ['fast', 'balanced', 'frontier'], defaultTier: 'balanced', baselineModel: { anthropic: 'claude-opus-5-5' }, modelPins: { fable: 'frontier', opus: 'frontier', sonnet: 'balanced', haiku: 'fast' }, policy: { mode: 'ratchet', accept: { fast: 0.85, balanced: 0.6, frontier: 0.3 } } };
  const now = Date.now(), rec = (m, tier, model, reason) => ({ at: new Date(now - m * 60000).toISOString(), tier, model, reason });
  return { router: { up: !down, version: '1.6.0', uptimeSec: 6574, sessions: 3, active: 1,
      jev: { configured: true, channels: [{ name: 'openrouter', calls: 412, errors: name === 'svc' ? 300 : 3, open: name === 'svc', lastError: 'HTTP 429 from the provider, retry after a long and detailed explanation that goes on and on' }] },
      config: down ? null : { ...cfg, tiers: tiersOf(cfg) }, last24h: down ? { total: 0, byTier: {}, byModel: {} } : { total: 412, byTier: { fast: 120, balanced: 250, frontier: 42 }, byModel: {} },
      recent: down ? [] : [rec(2, 'balanced', 'claude-sonnet-5', 'Routine edit within one file, with a deliberately long explanation to test wrapping on narrow screens'), rec(9, 'frontier', 'claude-opus-5-5', 'Cross-module refactor'), rec(15, 'fast', 'claude-haiku-4-5', 'Find a file path')] },
    omniroute: { up: name !== 'svc' && !down }, paths: pathsOf(team.agents) };
}

function safetyFor(name) {
  const now = Date.now(), leak = name === 'svc', stale = name === 'paperclip';
  const inv = [
    { id: 'a', where: 'WSL', path: '~/.config/jev-router/env', what: 'OpenRouter key for jev-router', state: 'ok', note: 'Private to you (mode 600).' },
    { id: 'b', where: 'WSL', path: '~/.paperclip/instances/default/.env', what: 'Paperclip signing secrets', state: leak ? 'warn' : 'ok', note: leak ? 'Readable by other users (mode 644). Run: chmod 600 ~/.paperclip/instances/default/.env' : 'Private to you (mode 600).' },
    { id: 'c', where: 'Windows', path: 'C:\\Users\\Administrator\\Downloads\\_Credentials\\a-very-long-folder-name-for-wrapping-tests', what: 'A folder named like it holds credentials', state: 'warn', note: 'Its contents were not read. Keep real passwords in a password manager, and rotate anything saved in plain text here.' },
    { id: 'd', where: 'Windows', path: 'C:\\Abbas\\Emergen\\agent-stack\\config.env', what: 'Your personal settings', state: 'ok', note: 'Excluded from git.' },
    { id: 'e', where: 'WSL', path: '~/.config/gh/hosts.yml', what: 'GitHub login', state: 'absent', note: 'Not present.' }];
  const bk = (h, n) => ({ name: 'paperclip-20261011-' + String(n).padStart(6, '0') + '.sql.gz', bytes: 481534 + n, at: new Date(now - h * 3600000).toISOString() });
  const list = stale ? [bk(30, 1), bk(31, 2)] : [bk(0.7, 1), bk(1.7, 2), bk(2.7, 3), bk(3.7, 4), bk(4.7, 5), bk(5.7, 6), bk(6.7, 7)];
  const findings = leak ? [{ scope: 'Repository (tracked files)', file: 'docs/notes/a-fairly-long-path/that-keeps-going/deploy-notes-with-a-long-name.md', line: 41, kind: 'API key' }, { scope: 'Repository (tracked files)', file: 'tools/x/config.local.json', line: 7, kind: 'Secret assignment' }, { scope: 'Service logs (WSL journal)', file: 'service logs', line: 1203, kind: 'Bearer token' }] : [];
  return { inventory: inv, backups: { available: true, dir: '/home/u/.paperclip/x', automatic: true, everyMinutes: 60, keepDays: 30, backups: list, count: list.length, totalBytes: list.reduce((n, x) => n + x.bytes, 0), copyDir: name === 'wsl' ? 'D:\\Backups\\agent-stack' : null },
    lastScan: { ranAt: new Date(now - 300000).toISOString(), total: findings.length, findings, scopes: [{ name: 'Repository (tracked files)', scanned: 430 }, { name: 'App data on Windows', scanned: 2 }, { name: 'Reconciler state and router log (WSL)', scanned: 807 }, { name: 'Service logs (WSL journal)', scanned: 1, error: name === 'wsl' ? 'wsl down' : undefined }] } };
}

function scenario(name) {
  const w = name === 'wsl', s = name === 'svc', p = name === 'paperclip';
  const wslState = w ? 'fail' : 'ok', inWsl = (st) => (w ? 'unknown' : st);
  const services = [
    { ...svc('paperclip', 'Paperclip', 'Runs the company: tasks, agents, approvals', 'WSL service', inWsl(p ? 'warn' : 'ok'), { uptimeSec: 4880, memMB: 927 }), port: 3100 },
    { ...svc('jev', 'jev-router', 'Picks a Claude model for each message', 'WSL service', inWsl('ok'), { uptimeSec: 4880, memMB: 20 }), port: 4000 },
    { ...svc('omniroute', 'OmniRoute', 'Gateway for non-Claude models', 'WSL service', inWsl(s ? 'fail' : 'ok'), { uptimeSec: 4880, memMB: 519 }), port: 20128 },
    svc('hermes', 'Hermes bridge', 'Odoo tickets and Discord approvals', 'Windows task', 'off'),
    svc('wsl', 'WSL', 'Where the services run', 'Windows', wslState, { text: w ? 'Not running' : 'Running' }),
    svc('keepalive', 'Keepalive', 'Keeps WSL awake while you are away', 'Windows task', 'ok'),
    svc('watchdog', 'Watchdog timer', 'Restarts stalled tasks every 10 minutes', 'WSL timer', inWsl('ok'), { uptimeSec: 4880 }),
  ];
  const c = crew(name), pcl = { up: !w && !p, error: p ? 'ECONNREFUSED' : undefined, approvalsPending: s ? 2 : 0, crew: c };
  const total = ledger(100).cost.totalUsd, L = ledger(s ? Math.round(total / 0.86) : 100), cost = L.cost;
  const spend = { monthUsd: cost.totalUsd, apiUsd: cost.apiUsd, subscriptionUsd: cost.subscriptionUsd, budgetUsd: cost.budget.usd, alertAt: 0.8, pct: cost.budget.pct, level: cost.budget.level, projectedUsd: cost.projectedUsd };
  const team = teamFor(c, name), safety = safetyFor(name);
  const needs = deriveNeeds({ services, paperclip: pcl, diskFreeGB: s ? 11 : 86, spend, team, safety });
  const up = pcl.up;
  return { checkedAt: new Date().toISOString(), startedAt: new Date().toISOString(), headline: headline(services, needs), needs, services, paperclip: { up, company: 'Emergen Engineering', error: pcl.error },
    crew: up ? c : c, recent: up ? [{ id: 'r1', agent: 'Frontend Engineer', status: 'running', at: new Date(Date.now() - 60e3).toISOString(), costUsd: null }, { id: 'r2', agent: 'QA', status: 'succeeded', at: new Date(Date.now() - 300e3).toISOString(), costUsd: 0.012, subscription: true }, { id: 'r3', agent: 'Docs', status: 'failed', at: new Date(Date.now() - 3600e3).toISOString(), costUsd: 0.041, subscription: true }] : [],
    approvalsPending: pcl.approvalsPending, runs: up ? { today: 3, month: 41 } : null,
    safety, models: modelsFor(name, team), team, spend, cost, activity: buildActivity(L.cache, L.byId, [{ id: 'p1', status: 'pending', createdAt: new Date().toISOString(), title: 'Approve merging EME-42 to staging and deploying to the client demo environment', requestedByAgentId: 'a6' }], 40), disk: { cFreeGB: s ? 11 : 86 } };
}

let current = 'ok';
const { server, token } = createServer({ store: { get: async () => scenario(current) } });
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4791;
server.listen(port, '127.0.0.1', () => console.log(`fixture UI: http://127.0.0.1:${port}/?t=${token}\nswitch scenario: http://127.0.0.1:${port + 1}/set/ok|svc|wsl|paperclip`));
http.createServer((q, r) => { const m = /^\/set\/(ok|svc|wsl|paperclip)$/.exec(q.url); if (m) current = m[1]; r.writeHead(m ? 200 : 404); r.end(m ? `scenario: ${current}\n` : 'unknown\n'); }).listen(port + 1, '127.0.0.1');
