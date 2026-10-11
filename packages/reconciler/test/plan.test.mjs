import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hash, sha256, normText } from '../src/canonical.mjs';
import { desiredAgents, heartbeatFor } from '../src/desired.mjs';
import { planAgent, planAll, matchLive, orderByHierarchy, nextApplied, desiredHash, liveHash } from '../src/plan.mjs';

const base = () => ({
  key: 'qa', department: 'engineering', name: 'QA', role: 'qa', title: 'QA Engineer', icon: 'bug', budgetMonthlyCents: 300,
  reportsTo: 'manager', model: 'claude-sonnet-5', env: {}, command: '/c/claude', timeoutSec: 3600,
  heartbeat: { enabled: false, maxConcurrentRuns: 2 }, skills: ['a', 'b'], instructions: 'hello\n',
});
const liveOf = (d, extra = {}) => ({ id: 'id-qa', ...d, env: Object.keys(d.env).sort(), ...extra });
/** the applied record a previous successful apply would have left */
const appliedFor = (d, l) => ({ key: d.key, tpl: 't0',
  desired: Object.fromEntries(Object.keys(d).filter((f) => d[f] !== undefined && f !== 'key' && f !== 'department').map((f) => [f, desiredHash(f, d)])),
  live: Object.fromEntries(Object.keys(d).filter((f) => d[f] !== undefined && f !== 'key' && f !== 'department').map((f) => [f, liveHash(f, l)])) });
const ops = (p) => Object.fromEntries(p.fields.filter((x) => x.op !== 'noop' && x.op !== 'record').map((x) => [x.field, x.op]));
const only = (p, op) => p.fields.filter((x) => x.op === op).map((x) => x.field);

test('hashing is canonical: key order does not matter, arrays do', () => {
  assert.equal(canonical({ b: 1, a: [2, 1] }), canonical({ a: [2, 1], b: 1 }));
  assert.notEqual(hash({ a: [1, 2] }), hash({ a: [2, 1] }));
  assert.equal(canonical({ a: undefined, b: 1 }), canonical({ b: 1 }));
  assert.equal(sha256('v1'), '3bfc269594ef649228e9a74bab00f042efc91d5acc6fbee31a382e80d42388fe'); // matches Paperclip's contentHash
  assert.equal(normText('a\r\nb  \n\n'), 'a\nb\n');
});

test('no live agent -> create', () => {
  assert.equal(planAgent(base(), null).action, 'create');
});

test('never applied and identical -> record (adoption writes metadata only)', () => {
  const d = base(), p = planAgent(d, liveOf(d));
  assert.equal(p.action, 'record');
  assert.deepEqual(new Set(p.fields.map((x) => x.op)), new Set(['record']));
});

test('never applied and different -> needs a decision, per field', () => {
  const d = base(), p = planAgent(d, liveOf(d, { title: 'Edited in the UI' }));
  assert.equal(p.action, 'needs-decision');
  assert.deepEqual(ops(p), { title: 'adopt-diff' });
});

test('adoption can be resolved either way', () => {
  const d = base(), l = liveOf(d, { title: 'Edited' });
  assert.deepEqual(ops(planAgent(d, l, { resolve: 'take-template' })), { title: 'update' });
  assert.deepEqual(ops(planAgent(d, l, { resolve: 'keep-live' })), { title: 'keep-live' });
});

test('applied, nothing changed -> noop', () => {
  const d = base(), l = liveOf(d); l.stack = appliedFor(d, l);
  assert.equal(planAgent(d, l).action, 'noop');
});

test('template changed, live untouched -> update only that field', () => {
  const d0 = base(), l = liveOf(d0); l.stack = appliedFor(d0, l);
  const d = { ...d0, title: 'Senior QA' };
  const p = planAgent(d, l);
  assert.equal(p.action, 'update');
  assert.deepEqual(ops(p), { title: 'update' });
});

test('a person edited it, template unchanged -> keep-live, nothing to write', () => {
  const d = base(), l0 = liveOf(d), applied = appliedFor(d, l0);
  const l = { ...l0, title: 'Mine', stack: applied };
  const p = planAgent(d, l);
  assert.equal(p.action, 'record');
  assert.deepEqual(ops(p), { title: 'keep-live' });
});

test('both changed -> conflict, never silently overwritten', () => {
  const d0 = base(), l0 = liveOf(d0), applied = appliedFor(d0, l0);
  const d = { ...d0, title: 'Template title' }, l = { ...l0, title: 'My title', stack: applied };
  const p = planAgent(d, l);
  assert.equal(p.action, 'needs-decision');
  assert.deepEqual(ops(p), { title: 'conflict' });
  assert.equal(p.fields.find((x) => x.field === 'title').from, 'My title');
  assert.equal(p.fields.find((x) => x.field === 'title').to, 'Template title');
});

test('both changed to the same value -> converged, just record', () => {
  const d0 = base(), l0 = liveOf(d0), applied = appliedFor(d0, l0);
  const d = { ...d0, title: 'Same' }, l = { ...l0, title: 'Same', stack: applied };
  assert.deepEqual(only(planAgent(d, l), 'record').includes('title'), true);
  assert.deepEqual(ops(planAgent(d, l)), {});
});

test('keep-live is stable, and a later template change on that field becomes a conflict', () => {
  const d0 = base(), l0 = liveOf(d0), applied = appliedFor(d0, l0);
  const l1 = { ...l0, title: 'Mine', stack: applied };
  const p1 = planAgent(d0, l1);
  const rec = nextApplied(d0, p1, l1, applied, 't1');
  const l2 = { ...l1, stack: rec };
  assert.deepEqual(ops(planAgent(d0, l2)), { title: 'keep-live' });              // repeatable, writes nothing
  const d3 = { ...d0, title: 'Template v2' };
  assert.deepEqual(ops(planAgent(d3, l2)), { title: 'conflict' });
});

test('env is compared by key names (values are redacted by the API), but a changed value is a template change', () => {
  const d0 = { ...base(), env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' } }, l0 = liveOf(d0), applied = appliedFor(d0, l0);
  const l = { ...l0, stack: applied };
  assert.equal(planAgent(d0, l).action, 'noop');
  const d = { ...d0, env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4001' } };      // same key, new value
  assert.deepEqual(ops(planAgent(d, l)), { env: 'update' });                      // values are unreadable, so a changed template value is always written
  const d2 = { ...d0, env: { ANTHROPIC_BASE_URL: 'x', OTHER: 'y' } };              // key set changed
  assert.deepEqual(ops(planAgent(d2, l)), { env: 'update' });
});

test('unmanaged fields (undefined) are skipped entirely', () => {
  const d = { ...base(), heartbeat: undefined }, l = liveOf(d, { heartbeat: { enabled: true, intervalSec: 5, maxConcurrentRuns: 9 } });
  assert.ok(!planAgent(d, l).fields.some((x) => x.field === 'heartbeat'));
});

test('matching: stack key beats saved id beats name; duplicates are refused', () => {
  const d = [base()];
  const a = { id: 'A', name: 'QA', stack: { key: 'qa' } }, b = { id: 'B', name: 'QA' }, c = { id: 'C', name: 'Other' };
  assert.equal(matchLive(d, [b, a, c], { qa: 'C' }).get('qa').id, 'A');
  assert.equal(matchLive(d, [b, c], { qa: 'C' }).get('qa').id, 'C');
  assert.equal(matchLive(d, [b, c]).get('qa').id, 'B');
  assert.equal(matchLive(d, [c]).get('qa'), null);
  assert.throws(() => matchLive([base(), { ...base(), key: 'qa2' }], [b]), /two template agents/);
});

test('hierarchy: managers first; cycles and unknown managers are errors', () => {
  const m = { ...base(), key: 'manager', reportsTo: null }, q = base(), x = { ...base(), key: 'x', reportsTo: 'qa' };
  assert.deepEqual(orderByHierarchy([x, q, m]).map((d) => d.key), ['manager', 'qa', 'x']);
  assert.throws(() => orderByHierarchy([{ ...m, reportsTo: 'qa' }, q]), /cycle/);
  assert.throws(() => orderByHierarchy([q]), /unknown agent/);
});

test('planAll counts actions', () => {
  const m = { ...base(), key: 'manager', name: 'Manager', reportsTo: null }, q = base();
  const lm = liveOf(m, { id: 'id-m' }); lm.stack = appliedFor(m, lm);
  const r = planAll([q, m], [lm], {});
  assert.deepEqual(r.counts, { noop: 1, create: 1 });
});

test('desiredAgents mirrors 40-org.sh: router env, skills merged without the built-in, heartbeat modes', () => {
  const org = { commonSkills: ['paperclip', 'no-slop'], routerEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' },
    agents: [{ key: 'm', department: 'e', name: 'M', role: 'pm', title: 'T', icon: 'brain', model: 'claude-sonnet-5', router: false, reportsTo: null, budgetCents: 300, heartbeat: true, skills: ['x'], maxConcurrentRuns: 1 },
             { key: 'b', department: 'e', name: 'B', role: 'engineer', title: 'T', icon: 'code', router: true, reportsTo: 'm', budgetCents: 900, skills: ['y'] }] };
  const r = desiredAgents(org, { m: 'one\r\n', b: 'two' }, { claudeCommand: '/c', managerHeartbeatSec: 0, extraSkills: ['z'] });
  assert.deepEqual(r[0].skills, ['no-slop', 'x', 'z']);
  assert.deepEqual(r[0].heartbeat, { enabled: false, maxConcurrentRuns: 1 });
  assert.deepEqual(r[0].env, {});
  assert.equal(r[1].model, null);
  assert.deepEqual(r[1].env, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' });
  assert.equal(r[1].heartbeat, undefined);
  assert.equal(r[0].instructions, 'one\n');
  assert.deepEqual(heartbeatFor({ heartbeat: true }, 1800), { enabled: true, intervalSec: 1800, maxConcurrentRuns: 1 });
  assert.throws(() => desiredAgents(org, { m: 'x' }, { claudeCommand: '/c', managerHeartbeatSec: 0, extraSkills: [] }), /no rendered instructions/);
});
