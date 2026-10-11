// End-to-end: the real CLI against a SCRATCH Paperclip (tools/scratch-paperclip/scratch.sh start). Skipped when none is up.
//   node --test packages/reconciler/test/integration.test.mjs        (run inside WSL, with paperclipai on PATH)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = process.env.SCRATCH_API ?? 'http://127.0.0.1:3199', api = origin + '/api';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cli = join(root, 'apps', 'cli', 'stack.mjs');
const up = await fetch(api + '/health').then((r) => r.ok).catch(() => false);
const T = { skip: up ? false : 'no scratch Paperclip on :3199 (run tools/scratch-paperclip/scratch.sh start)' };

const http = async (m, p, b) => { const r = await fetch(api + p, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); return t ? JSON.parse(t) : null; };
const state = mkdtempSync(join(tmpdir(), 'stack-it-')), desired = join(state, 'desired');
const cname = 'IT-' + Date.now();
const org = () => ({ commonSkills: ['paperclip', 'skill-a'], routerEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' }, agents: [
  { key: 'manager', department: 'e', name: 'Manager', role: 'pm', title: 'Manager', icon: 'brain', model: 'claude-sonnet-5', router: false, reportsTo: null, budgetCents: 300, heartbeat: true, skills: [], maxConcurrentRuns: 1 },
  { key: 'eng', department: 'e', name: 'Eng', role: 'engineer', title: 'Engineer', icon: 'code', router: true, reportsTo: 'manager', budgetCents: 900, skills: ['skill-b'] },
  { key: 'qa', department: 'e', name: 'QA', role: 'qa', title: 'QA', icon: 'bug', model: 'claude-sonnet-5', router: false, reportsTo: 'manager', budgetCents: 300, skills: [], maxConcurrentRuns: 2 }] });
const md = { manager: 'You manage.\n', eng: 'You build.\n', qa: 'You test.\n' };
const settings = () => ({ claudeCommand: '/bin/true', tpl: 't1', companyName: cname, timezone: 'UTC', managerHeartbeatSec: 0, extraSkills: [] });
const writeDesired = (o = org(), m = md, s = settings()) => {
  mkdirSync(join(desired, 'agents'), { recursive: true });
  writeFileSync(join(desired, 'org.json'), JSON.stringify(o)); writeFileSync(join(desired, 'settings.json'), JSON.stringify(s));
  for (const [k, v] of Object.entries(m)) writeFileSync(join(desired, 'agents', k + '.md'), v);
};
const stack = (args, env = {}) => { const r = spawnSync(process.execPath, [cli, ...args, '--api', origin, '--state', state], { encoding: 'utf8', env: { ...process.env, ...env } }); return { code: r.status, out: r.stdout + r.stderr }; };
let cid; const agents = async () => Object.fromEntries((await http('GET', `/companies/${cid}/agents`)).map((a) => [a.name, a]));
const instr = async (id) => (await http('GET', `/agents/${id}/instructions-bundle/file?path=AGENTS.md`)).content;
const planJson = (extra = []) => JSON.parse(stack(['plan', '--json', ...extra]).out);
const actions = (p) => Object.fromEntries(p.agents.map((a) => [a.key, a.action]));

test('setup: a company with two real skills', T, async () => {
  cid = (await http('POST', '/companies', { name: cname })).id;
  const managed = join(process.env.SCRATCH_DIR ?? join(homedir(), '.agent-stack', 'scratch'), 'instances', 'default', 'skills', cid);
  for (const n of ['skill-a', 'skill-b']) {
    mkdirSync(join(managed, n), { recursive: true }); writeFileSync(join(managed, n, 'SKILL.md'), `---\nname: ${n}\ndescription: it ${n}\n---\nbody\n`);
    execFileSync('paperclipai', ['skills', 'import', join(managed, n), '-C', cid, '--api-base', origin, '--json'], { encoding: 'utf8' });
  }
  writeDesired();
});

test('plan on an empty company: everything is a create, nothing is written', T, async () => {
  assert.deepEqual(actions(planJson()), { manager: 'create', eng: 'create', qa: 'create' });
  assert.equal(Object.keys(await agents()).length, 0);
  assert.match(stack(['apply']).out, /Re-run with --yes/);                       // apply without --yes only prints
  assert.equal(Object.keys(await agents()).length, 0);
});

test('apply --yes creates the agents in hierarchy order, with managed settings', T, async () => {
  const r = stack(['apply', '--yes']); assert.equal(r.code, 0, r.out);
  const a = await agents();
  assert.deepEqual(Object.keys(a).sort(), ['Eng', 'Manager', 'QA']);
  assert.equal(a.Eng.reportsTo, a.Manager.id);
  assert.equal(a.Eng.adapterConfig.model, undefined);
  assert.deepEqual(Object.keys(a.Eng.adapterConfig.env), ['ANTHROPIC_BASE_URL']);
  assert.deepEqual(a.QA.runtimeConfig.heartbeat, { enabled: false, maxConcurrentRuns: 2 });
  assert.equal(await instr(a.QA.id), 'You test.\n');
  assert.equal(a.QA.metadata.stack.key, 'qa');
  const sk = await http('GET', `/agents/${a.Eng.id}/skills`); assert.ok(sk.desiredSkills.some((k) => k.endsWith('/skill-b')));
});

test('plan is now zero changes, and a second apply writes nothing', T, async () => {
  assert.deepEqual(actions(planJson()), { manager: 'noop', eng: 'noop', qa: 'noop' });
  const before = Object.values(await agents()).map((a) => a.updatedAt).sort().join();
  const r = stack(['apply', '--yes']); assert.equal(r.code, 0, r.out);
  assert.equal(Object.values(await agents()).map((a) => a.updatedAt).sort().join(), before);
});

test('three repeated applies never create duplicates', T, async () => {
  for (let i = 0; i < 3; i++) assert.equal(stack(['apply', '--yes']).code, 0);
  assert.equal(Object.keys(await agents()).length, 3);
});

test('a UI edit survives apply and is reported as kept', T, async () => {
  const a = await agents();
  await http('PATCH', `/agents/${a.QA.id}`, { title: 'Edited in the UI' });
  const f = await http('GET', `/agents/${a.QA.id}/instructions-bundle/file?path=AGENTS.md`);
  await fetch(`${api}/agents/${a.QA.id}/instructions-bundle/file`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'AGENTS.md', content: 'Edited by a person.\n', baseRevisionId: f.revision.id }) });
  const p = planJson(); assert.equal(p.agents.find((x) => x.key === 'qa').fields.filter((x) => x.op === 'keep-live').map((x) => x.field).sort().join(), 'instructions,title');
  assert.equal(stack(['apply', '--yes']).code, 0);
  const b = await agents(); assert.equal(b.QA.title, 'Edited in the UI'); assert.equal(await instr(b.QA.id), 'Edited by a person.\n');
  assert.equal(stack(['apply', '--yes']).code, 0);                                // stable on repeat
  assert.equal((await agents()).QA.title, 'Edited in the UI');
});

test('a template change updates only the agent it touches', T, async () => {
  const m2 = { ...md, eng: 'You build, carefully.\n' };
  writeDesired(org(), m2);
  const p = planJson(); assert.equal(actions(p).eng, 'update'); assert.equal(actions(p).manager, 'noop');
  const before = (await agents()).Manager.updatedAt;
  assert.equal(stack(['apply', '--yes']).code, 0);
  const a = await agents(); assert.equal(await instr(a.Eng.id), 'You build, carefully.\n'); assert.equal(a.Manager.updatedAt, before);
  assert.equal(a.QA.title, 'Edited in the UI');
});

test('both sides changed the same field: conflict, nothing written until you choose', T, async () => {
  const o = org(); o.agents[2].title = 'Template QA title';
  writeDesired(o, { ...md, eng: 'You build, carefully.\n' });
  const p = planJson(); assert.equal(actions(p).qa, 'needs-decision');
  assert.ok(p.agents.find((x) => x.key === 'qa').fields.some((x) => x.field === 'title' && x.op === 'conflict'));
  stack(['apply', '--yes']); assert.equal((await agents()).QA.title, 'Edited in the UI');
  assert.equal(stack(['apply', '--yes', '--only', 'qa', '--take-template']).code, 0);
  assert.equal((await agents()).QA.title, 'Template QA title');
});

test('failure mid-apply: stops, and rollback restores the written fields', T, async () => {
  const o = org(); o.agents[1].title = 'Engineer v2'; o.agents[1].budgetCents = 1234;
  writeDesired(o, { ...md, eng: 'You build, then rebuild.\n' });
  const a0 = await agents(); const before = { title: a0.Eng.title, budget: a0.Eng.budgetMonthlyCents, text: await instr(a0.Eng.id) };
  const r = stack(['apply', '--yes', '--only', 'eng'], { STACK_TEST_FAIL_AFTER: 'eng:basics' });
  assert.notEqual(r.code, 0); assert.match(r.out, /injected failure after basics/); assert.match(r.out, /stack rollback/);
  assert.equal((await agents()).Eng.title, 'Engineer v2');                         // the write happened
  assert.equal(await instr(a0.Eng.id), before.text);                                // later steps did not
  const rb = stack(['rollback']); assert.equal(rb.code, 0, rb.out);
  const a1 = await agents(); assert.equal(a1.Eng.title, before.title); assert.equal(a1.Eng.budgetMonthlyCents, before.budget);
  assert.equal(await instr(a1.Eng.id), before.text);
  assert.deepEqual(actions(planJson(['--only', 'eng'])), { eng: 'update' });        // still pending, nothing half-recorded
  assert.equal(stack(['apply', '--yes', '--only', 'eng']).code, 0);                 // and it applies cleanly afterwards
  assert.equal((await agents()).Eng.title, 'Engineer v2');
});

test('adoption: agents made by the old script are tagged without being rewritten', T, async () => {
  const c2 = (await http('POST', '/companies', { name: cname + '-old' })).id;
  const mk = (n, extra = {}) => http('POST', `/companies/${c2}/agents`, { name: n, role: 'qa', title: 'T', icon: 'bug', adapterType: 'claude_local', adapterConfig: { engine: 'cli', command: '/bin/true' }, ...extra });
  const old = await mk('QA', { title: 'Hand-edited title' });
  const o = org(); o.agents = [o.agents[2]]; o.agents[0].reportsTo = null;
  const s2 = { ...settings(), companyName: cname + '-old' };
  const st2 = mkdtempSync(join(tmpdir(), 'stack-it2-')); mkdirSync(join(st2, 'desired', 'agents'), { recursive: true });
  writeFileSync(join(st2, 'desired', 'org.json'), JSON.stringify(o)); writeFileSync(join(st2, 'desired', 'settings.json'), JSON.stringify(s2)); writeFileSync(join(st2, 'desired', 'agents', 'qa.md'), 'You test.\n');
  const run = (args) => spawnSync(process.execPath, [cli, ...args, '--api', origin, '--state', st2], { encoding: 'utf8' });
  const p = JSON.parse(run(['plan', '--json']).stdout); assert.equal(p.agents[0].action, 'needs-decision');
  const r = run(['adopt', '--yes']); assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = await http('GET', `/agents/${old.id}`); assert.equal(after.title, 'Hand-edited title');   // live value kept
  assert.equal(after.metadata.stack.key, 'qa');
  const p2 = JSON.parse(run(['plan', '--json']).stdout); assert.notEqual(p2.agents[0].action, 'needs-decision');
  assert.equal(run(['apply', '--yes']).status, 0); assert.equal((await http('GET', `/agents/${old.id}`)).title, 'Hand-edited title');
});

test('no delete path exists in the adapter or the CLI', () => {
  for (const f of ['packages/adapter-paperclip/src/client.mjs', 'packages/reconciler/src/apply.mjs', 'apps/cli/stack.mjs']) {
    assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /['"`]DELETE['"`]/, `${f} must not issue DELETE`);
  }
});

test('routines: created with their schedule, edits kept, template changes applied and rolled back', T, async () => {
  const co = (await http('POST', '/companies', { name: cname + '-routine' })).id;
  const st = mkdtempSync(join(tmpdir(), 'stack-it3-')); mkdirSync(join(st, 'desired', 'agents'), { recursive: true });
  const o = org(); o.agents = [{ ...o.agents[0], routine: { title: 'Daily report', cronEnv: 'CRON1', description: 'Write the report.' } }];
  const put = (cron, tz = 'UTC') => {
    writeFileSync(join(st, 'desired', 'org.json'), JSON.stringify(o));
    writeFileSync(join(st, 'desired', 'settings.json'), JSON.stringify({ ...settings(), companyName: cname + '-routine', timezone: tz, routineCrons: { CRON1: cron } }));
    writeFileSync(join(st, 'desired', 'agents', 'manager.md'), 'You manage.\n');
  };
  const run = (args, env = {}) => { const r = spawnSync(process.execPath, [cli, ...args, '--api', origin, '--state', st], { encoding: 'utf8', env: { ...process.env, ...env } }); return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout }; };
  const routineOf = async () => { const l = (await http('GET', `/companies/${co}/routines`)); const r = (Array.isArray(l) ? l : l.items).find((x) => x.title === 'Daily report'); return r ? http('GET', `/routines/${r.id}`) : null; };

  put('0 9 * * 1-5');
  const first = run(['apply', '--yes']); assert.equal(first.code, 0, first.out);
  let r = await routineOf(); assert.equal(r.triggers[0].cronExpression, '0 9 * * 1-5'); assert.equal(r.triggers[0].timezone, 'UTC');
  assert.equal(r.assigneeAgentId, (await http('GET', `/companies/${co}/agents`))[0].id);

  const p = JSON.parse(run(['plan', '--json']).stdout); assert.deepEqual(p.routines.map((x) => x.action), ['noop']);
  const stamp = (await routineOf()).updatedAt; assert.equal(run(['apply', '--yes']).code, 0); assert.equal((await routineOf()).updatedAt, stamp);   // idempotent

  await http('PATCH', `/routine-triggers/${r.triggers[0].id}`, { cronExpression: '0 7 * * *' });                // a person changes the schedule in the UI
  assert.equal(run(['apply', '--yes']).code, 0); assert.equal((await routineOf()).triggers[0].cronExpression, '0 7 * * *');   // kept

  await http('PATCH', `/routine-triggers/${r.triggers[0].id}`, { cronExpression: '0 9 * * 1-5' });             // back to what we wrote
  put('0 18 * * 1-5');                                                                                         // the template moves
  assert.equal(run(['apply', '--yes']).code, 0); assert.equal((await routineOf()).triggers[0].cronExpression, '0 18 * * 1-5');
  assert.equal(run(['rollback']).code, 0); assert.equal((await routineOf()).triggers[0].cronExpression, '0 9 * * 1-5');   // undone
});
