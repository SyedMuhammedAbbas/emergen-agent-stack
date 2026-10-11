// Dev only: serves the real UI with synthetic readings, to look at problem states without stopping anything.
//   node apps/control-app/dev/fixture-server.mjs [--port 4791]      then open the printed link
//   scenarios: ok | svc (OmniRoute stopped, an agent in error, approvals) | wsl (WSL down) | paperclip (Paperclip unreachable)
//   switch with:  http://127.0.0.1:4792/set/<scenario>
// The readings go through the same deriveNeeds/headline code as the real app.
import http from 'node:http';
import { createServer } from '../server.mjs';
import { deriveNeeds, headline } from '../src/needs.mjs';

const svc = (id, title, about, kind, state, extra = {}) => ({ id, title, about, kind, port: null, state, text: { ok: 'Running', fail: 'Stopped', unknown: 'Unknown (WSL is down)', off: 'Not set up', warn: 'Running but not answering' }[state], ...extra });
const crew = (down) => ['Manager|Engineering Manager', 'CTO|CTO', 'Frontend Engineer|Frontend', 'Backend Engineer|Backend', 'DevOps Engineer|DevOps', 'SecOps Engineer|SecOps', 'QA|QA', 'UX Reviewer|UX', 'Docs|Docs', 'Estimator|Estimator', 'Chief of Staff|CoS', 'Timekeeper|TK', 'Watchdog|WD', 'Brand Lead|BL', 'Designer|D', 'Video Generator|VG', 'Orrisian Content|OC', 'Upwork Scout|US']
  .map((x, i) => { const [name, title] = x.split('|'); return { id: 'a' + i, name, title, mood: down === 'wsl' ? 'paused' : name === 'Docs' && down === 'svc' ? 'error' : [2, 3, 17].includes(i) ? 'working' : 'idle', plan: 'managed' }; });

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
  const needs = deriveNeeds({ services, paperclip: pcl, diskFreeGB: s ? 11 : 86 });
  const up = pcl.up;
  return { checkedAt: new Date().toISOString(), startedAt: new Date().toISOString(), headline: headline(services, needs), needs, services, paperclip: { up, company: 'Emergen Engineering', error: pcl.error },
    crew: up ? c : c, recent: up ? [{ id: 'r1', agent: 'Frontend Engineer', status: 'running', at: new Date(Date.now() - 60e3).toISOString(), costUsd: null }, { id: 'r2', agent: 'QA', status: 'succeeded', at: new Date(Date.now() - 300e3).toISOString(), costUsd: 0.012, subscription: true }, { id: 'r3', agent: 'Docs', status: 'failed', at: new Date(Date.now() - 3600e3).toISOString(), costUsd: 0.041, subscription: true }] : [],
    approvalsPending: pcl.approvalsPending, runs: up ? { today: 3, month: 41 } : null,
    spend: up ? { monthUsd: 14.82, apiUsd: 2.1, subscriptionUsd: 12.72, budgetUsd: 100, alertAt: 0.8, pct: 14.8, projectedUsd: 41 } : null, disk: { cFreeGB: s ? 11 : 86 } };
}

let current = 'ok';
const { server, token } = createServer({ store: { get: async () => scenario(current) } });
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4791;
server.listen(port, '127.0.0.1', () => console.log(`fixture UI: http://127.0.0.1:${port}/?t=${token}\nswitch scenario: http://127.0.0.1:${port + 1}/set/ok|svc|wsl|paperclip`));
http.createServer((q, r) => { const m = /^\/set\/(ok|svc|wsl|paperclip)$/.exec(q.url); if (m) current = m[1]; r.writeHead(m ? 200 : 404); r.end(m ? `scenario: ${current}\n` : 'unknown\n'); }).listen(port + 1, '127.0.0.1');
