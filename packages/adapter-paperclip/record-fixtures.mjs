// Record real Paperclip responses (from a SCRATCH instance) as test fixtures, with ids replaced by stable placeholders.
// Run again after a Paperclip upgrade, review the diff, then update services.lock.json.
//   node packages/adapter-paperclip/record-fixtures.mjs [origin]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = process.argv[2] ?? 'http://127.0.0.1:3199', api = origin + '/api';
if (/:3100$/.test(origin)) throw new Error('refusing to record from the live instance');
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures'); mkdirSync(out, { recursive: true });
const call = async (m, p, b) => { const r = await fetch(api + p, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.json(); };

const cid = (await call('POST', '/companies', { name: 'fixtures' })).id;
const mgr = await call('POST', `/companies/${cid}/agents`, { name: 'Manager', role: 'pm', title: 'Manager', icon: 'brain', adapterType: 'claude_local',
  adapterConfig: { engine: 'cli', command: '/bin/true', timeoutSec: 3600, model: 'claude-sonnet-5' }, instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': 'You manage.\n' } } });
const eng = await call('POST', `/companies/${cid}/agents`, { name: 'Eng', role: 'engineer', title: 'Engineer', icon: 'code', reportsTo: mgr.id, budgetMonthlyCents: 900, adapterType: 'claude_local',
  adapterConfig: { engine: 'cli', command: '/bin/true', timeoutSec: 3600, env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' } },
  runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 2 } }, instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': 'You build.\n' } },
  metadata: { stack: { key: 'eng', tpl: 't', desired: { title: 'x' }, live: { title: 'y' } } } });
const routine = await call('POST', `/companies/${cid}/routines`, { title: 'Daily report', description: 'd', assigneeAgentId: eng.id, priority: 'medium' });
await call('POST', `/routines/${routine.id}/triggers`, { kind: 'schedule', cronExpression: '0 9 * * 1-5', timezone: 'UTC', enabled: true });

const raw = {
  agent: await call('GET', `/agents/${eng.id}`),
  agentList: await call('GET', `/companies/${cid}/agents`),
  instructions: await call('GET', `/agents/${eng.id}/instructions-bundle/file?path=AGENTS.md`),
  agentSkills: await call('GET', `/agents/${eng.id}/skills`),
  companySkills: await call('GET', `/companies/${cid}/skills`),
  routine: await call('GET', `/routines/${routine.id}`),
};
// stable ids: replace every uuid by a label so re-recording gives small diffs
const labels = new Map([[cid, 'COMPANY'], [mgr.id, 'AGENT-MANAGER'], [eng.id, 'AGENT-ENG'], [routine.id, 'ROUTINE']]);
let text = JSON.stringify(raw, null, 2);
for (const [id, l] of labels) text = text.split(id).join(l);
let n = 0; const seen = new Map();
text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => { if (!seen.has(m)) seen.set(m, `ID-${++n}`); return seen.get(m); });
text = text.replace(/\/home\/[^"]*\/instances\/default/g, '/DATA/instances/default').replace(/"20\d\d-[^"]*Z"/g, '"2000-01-01T00:00:00.000Z"');
const parsed = JSON.parse(text);
for (const [k, v] of Object.entries(parsed)) writeFileSync(join(out, k + '.json'), JSON.stringify(v, null, 2) + '\n');
console.log('recorded', Object.keys(parsed).join(', '), 'into', out);
