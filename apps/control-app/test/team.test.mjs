import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTeam, lineDiff, runStackPlan } from '../src/team.mjs';
import { deriveNeeds } from '../src/needs.mjs';
import { createStore } from '../src/state.mjs';

const agent = (id, name, over = {}) => ({ id, name, title: name + ' title', role: 'qa', status: 'idle', budgetMonthlyCents: 300, reportsTo: null, adapterConfig: { model: 'claude-sonnet-5' }, metadata: { stack: { key: name.toLowerCase() } }, ...over });
const f = (field, op, from, to) => ({ field, op, from, to });
const pl = (id, key, action, fields = []) => ({ id, key, action, fields });

test('lineDiff shows only changed lines, in order, and copes with huge input', () => {
  const d = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(d.lines, [{ t: '-', s: 'b' }, { t: '+', s: 'B' }, { t: '+', s: 'e' }]);
  assert.deepEqual(lineDiff('same\nsame', 'same\nsame').lines, []);
  assert.equal(lineDiff('x', '').lines.length > 0, true);
  const big = Array.from({ length: 900 }, (_, i) => 'l' + i).join('\n');
  assert.equal(lineDiff(big, big + '\nx').lines.length <= 2, true);                 // fallback, never a stall
  const many = lineDiff(Array.from({ length: 60 }, (_, i) => 'a' + i).join('\n'), Array.from({ length: 60 }, (_, i) => 'b' + i).join('\n'), 5);
  assert.equal(many.lines.length, 10); assert.ok(many.more > 0);
});

test('team states: in step, keeping an edit, will update, needs a decision, not managed, unknown', () => {
  const agents = [agent('1', 'Manager'), agent('2', 'Estimator'), agent('3', 'QA'), agent('4', 'Docs'), agent('5', 'Watchdog', { metadata: null }), agent('6', 'Dev', { reportsTo: '1', adapterConfig: { env: { ANTHROPIC_BASE_URL: '***' } } })];
  const plan = { agents: [
    pl('1', 'manager', 'noop'),
    pl('2', 'estimator', 'record', [f('instructions', 'keep-live', 'Emergen, Personal\nx', 'Emergen, Personal, Qualifi\nx'), f('title', 'record')]),
    pl('3', 'qa', 'update', [f('title', 'update', 'QA', 'Senior QA')]),
    pl('4', 'docs', 'needs-decision', [f('skills', 'conflict', ['a', 'b'], ['a', 'c'])]),
    pl('5', 'watchdog', 'record'), pl('6', 'dev', 'noop')] };
  const t = buildTeam(agents, plan, { ranAt: '2026-10-11T17:00:00Z' }), by = Object.fromEntries(t.agents.map((a) => [a.name, a]));
  assert.deepEqual([by.Manager.state, by.Estimator.state, by.QA.state, by.Docs.state, by.Watchdog.state, by.Dev.state], ['in-step', 'edit', 'update', 'decision', 'unmanaged', 'in-step']);
  assert.deepEqual(t.counts, { 'in-step': 2, edit: 1, update: 1, decision: 1, unmanaged: 1 });
  assert.deepEqual(t.agents.map((a) => a.state).slice(0, 3), ['decision', 'unmanaged', 'update']);   // what needs attention comes first
  assert.equal(by.Estimator.changes[0].label, 'Instructions'); assert.deepEqual(by.Estimator.changes[0].diff.lines, [{ t: '-', s: 'Emergen, Personal' }, { t: '+', s: 'Emergen, Personal, Qualifi' }]);
  assert.equal(by.Estimator.changes.length, 1);                                    // 'record' fields are not differences
  assert.match(by.Docs.changes[0].summary, /The template adds c; the template removes b./);
  assert.equal(by.QA.command, '.\\stack.cmd apply --yes --only qa');
  assert.equal(by.Estimator.command, '.\\stack.cmd apply --yes --only estimator --take-template');
  assert.match(by.Docs.command, /--only docs --take-template/); assert.match(by.Docs.command, /--keep-live/);
  assert.equal(by.Manager.command, null); assert.equal(by.Watchdog.command, null); assert.match(by.Watchdog.note, /Not managed/);
  assert.equal(by.Dev.model, 'jev-router'); assert.equal(by.Dev.reportsTo, 'Manager'); assert.equal(by.Manager.model, 'claude-sonnet-5'); assert.equal(by.QA.budgetUsd, 3);
  const none = buildTeam(agents, null, { error: 'WSL is down' }); assert.equal(none.available, false); assert.equal(none.agents.find((a) => a.name === 'Manager').state, 'unknown'); assert.equal(none.error, 'WSL is down');
});

test('budget and field wording', () => {
  const t = buildTeam([agent('1', 'A')], { agents: [pl('1', 'a', 'update', [f('budgetMonthlyCents', 'update', 300, 900), f('model', 'update', null, 'claude-opus-5-5')])] });
  assert.equal(t.agents[0].changes[0].summary, 'Paperclip has $3.00, the template says $9.00'); assert.equal(t.agents[0].changes[1].summary, 'Paperclip has none, the template says claude-opus-5-5');
});

test('skill wording: a pure re-ordering falls back to a plain sentence', () => {
  const t = buildTeam([agent('1', 'A')], { agents: [pl('1', 'a', 'update', [f('skills', 'update', ['a', 'b'], ['b', 'a'])])] });
  assert.equal(t.agents[0].changes[0].summary, 'The skill list differs.');
});

test('runStackPlan runs the CLI in WSL (read-only), parses stdout only, and fails clearly', async () => {
  let seen;
  const ok = await runStackPlan({ repo: 'C:\\Abbas\\Emergen\\agent-stack', distro: 'Ubuntu-24.04' }, { exec: async (c, a) => { seen = [c, ...a]; return { stdout: JSON.stringify({ agents: [], counts: {} }) }; } });
  assert.deepEqual(ok.agents, []); assert.equal(seen[0], 'wsl.exe'); assert.match(seen[6], /cd "\/mnt\/c\/Abbas\/Emergen\/agent-stack" && node apps\/cli\/stack.mjs plan --json/);
  assert.doesNotMatch(seen[6], /apply|adopt|rollback/);
  await assert.rejects(runStackPlan({ repo: 'C:\\x', distro: 'U' }, { exec: async () => ({ stdout: 'not json' }) }));
  await assert.rejects(runStackPlan({ repo: 'C:\\x', distro: 'U' }, { exec: async () => ({ stdout: '{"nope":1}' }) }), /unexpected/);
  await assert.rejects(runStackPlan({ distro: 'U' }, {}), /repo path/);
});

test('a decision becomes a need on Home, with the agent names', () => {
  const need = (team) => deriveNeeds({ services: [], paperclip: { up: true, crew: [] }, diskFreeGB: 80, team }).find((n) => n.id === 'plan-decisions');
  assert.equal(need({ agents: [{ name: 'QA', state: 'in-step' }] }), undefined);
  assert.match(need({ agents: [{ name: 'Docs', state: 'decision' }] }).title, /1 agent needs a decision \(Docs\)/);
  assert.match(need({ agents: ['A', 'B', 'C', 'D'].map((name) => ({ name, state: 'decision' })) }).title, /4 agents need a decision \(A, B, C, …\)/);
});

test('the store refreshes the plan in the background about once a minute and never waits for it', async () => {
  let calls = 0, release; const gate = new Promise((r) => { release = r; });
  const io = { exec: async (c, a) => (a[0] === '-l' ? { stdout: 'Ubuntu-24.04\n' } : { stdout: '' }), fetch: async (u) => { const p = new URL(u).pathname.replace('/api', ''); const d = { '/companies': [{ id: 'c', name: 'E' }], '/companies/c/agents': [agent('1', 'QA')], '/companies/c/heartbeat-runs': [], '/companies/c/approvals': [] }[p]; return d === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => d }; },
    diskFreeGB: () => 80, stackPlan: async () => { calls++; await gate; return { agents: [pl('1', 'qa', 'noop')], counts: {} }; } };
  const s = createStore({ settings: { distro: 'Ubuntu-24.04', paperclip: 'http://x', budgetUsd: 100, alertAt: 0.8, appDir: mkdtempSync(join(tmpdir(), 'tm-')) }, io, ttlMs: 0 });
  const first = await s.get();                                                       // returns even though the plan is still running
  assert.equal(first.team.available, false); assert.equal(first.team.agents[0].state, 'unknown'); assert.equal(calls, 1);
  await s.get(); assert.equal(calls, 1);                                             // still running: not started twice
  release(); await new Promise((r) => setTimeout(r, 20));
  const later = await s.get(); assert.equal(later.team.agents[0].state, 'in-step'); assert.equal(later.team.available, true); assert.equal(calls, 1);   // fresh for a minute
});
