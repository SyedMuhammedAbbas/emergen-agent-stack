import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCache, saveCache, mergeRuns, buildCost, buildActivity } from '../src/costs.mjs';
import { deriveNeeds } from '../src/needs.mjs';

const run = (id, agentId, at, usd, billing = 'subscription_included', over = {}) => ({ id, agentId, status: 'succeeded', createdAt: at, finishedAt: at, contextSnapshot: { wakeReason: 'm0b' },
  usageJson: usd == null ? undefined : { costUsd: usd, billingType: billing, model: 'claude-sonnet-5', inputTokens: 100, outputTokens: 10, cachedInputTokens: 1000 }, ...over });
const agents = new Map([['a1', { name: 'QA' }], ['a2', { name: 'Backend Engineer' }]]);
const NOW = new Date(2026, 9, 11, 21, 0, 0);                    // 11 Oct 2026, local time
const at = (d, h = 10) => new Date(2026, 9, d, h).toISOString();
const B = { budgetUsd: 100, alertAt: 0.8 };

test('month totals split API-billed from subscription-covered; other months and no-cost runs are handled', () => {
  const c = mergeRuns(loadCache('/nonexistent'), [
    run('r1', 'a1', at(1), 0.25), run('r2', 'a1', at(5), 1.5, 'api'), run('r3', 'a2', at(11), 0.4),
    run('r4', 'a2', new Date(2026, 8, 30, 10).toISOString(), 9, 'api'),   // September: ignored
    run('r5', 'a2', at(11, 12), null, undefined, { status: 'cancelled' }),  // no usage: counted as a run, adds no money
  ]);
  const r = buildCost(c, agents, NOW, B);
  assert.equal(r.totalUsd, 2.15); assert.equal(r.apiUsd, 1.5); assert.equal(r.subscriptionUsd, 0.65);
  assert.equal(r.month.runs, 4); assert.equal(r.days.length, 11); assert.equal(r.days[10].runs, 2);
  assert.equal(r.days[0].subscriptionUsd, 0.25); assert.equal(r.days[4].apiUsd, 1.5);
  assert.deepEqual(r.byAgent.map((a) => [a.name, a.usd]), [['QA', 1.75], ['Backend Engineer', 0.4]]);
  assert.equal(r.byModel[0].model, 'claude-sonnet-5'); assert.equal(r.tokens.in, 300);
  assert.equal(r.projectedUsd, 6); assert.equal(buildCost(c, agents, new Date(2026, 9, 2), B).projectedUsd, null);
});

test('budget level: ok, alert at 80%, fail at 100%', () => {
  const at$ = (usd) => buildCost(mergeRuns(loadCache('/nonexistent'), [run('x', 'a1', at(3), usd, 'api')]), agents, NOW, B).budget;
  assert.deepEqual([at$(10).level, at$(80).level, at$(99.9).level, at$(100).level, at$(250).level], ['ok', 'warn', 'warn', 'fail', 'fail']);
  assert.equal(at$(14.82).pct, 14.8);
});

test('the cache keeps history that Paperclip stops listing, and re-merging is idempotent', () => {
  let c = mergeRuns(loadCache('/nonexistent'), [run('r1', 'a1', at(1), 1), run('r2', 'a1', at(2), 2)]);
  c = mergeRuns(c, [run('r2', 'a1', at(2), 2), run('r3', 'a1', at(3), 3)]);                 // r1 no longer in the list
  assert.equal(Object.keys(c.runs).length, 3); assert.equal(buildCost(c, agents, NOW, B).totalUsd, 6);
  c = mergeRuns(c, [run('r3', 'a1', at(3), 3)]); assert.equal(buildCost(c, agents, NOW, B).totalUsd, 6);
});

test('cache file: round trip, atomic write, corrupt or foreign files are ignored', () => {
  const d = mkdtempSync(join(tmpdir(), 'cc-')), f = join(d, 'sub', 'cost-cache.json');
  const c = mergeRuns(loadCache(f), [run('r1', 'a1', at(1), 1)]); assert.equal(saveCache(f, c), true);
  assert.equal(existsSync(f + '.tmp'), false); assert.equal(Object.keys(loadCache(f).runs).length, 1);
  writeFileSync(f, '{not json'); assert.deepEqual(loadCache(f).runs, {});
  writeFileSync(f, JSON.stringify({ version: 99, runs: { x: {} } })); assert.deepEqual(loadCache(f).runs, {});
  assert.equal(saveCache('Z:\\no\\such\\drive\\x.json', c), false);                              // failure to save never throws
});

test('activity: newest first, titles and approvals merged', () => {
  const c = mergeRuns(loadCache('/nonexistent'), [run('r1', 'a1', at(5), 0.1), run('r2', 'a2', at(9), 0.2, 'api')]); c.titles.r2 = 'EME-44 Add pagination';
  const a = buildActivity(c, agents, [{ id: 'p1', status: 'pending', createdAt: at(10), title: 'Merge EME-42 to staging', requestedByAgentId: 'a1' }], 10);
  assert.deepEqual(a.map((x) => x.id), ['p1', 'r2', 'r1']); assert.equal(a[1].title, 'EME-44 Add pagination'); assert.equal(a[1].billing, 'api');
  assert.equal(a[0].kind, 'approval'); assert.equal(a[0].agent, 'QA'); assert.equal(buildActivity(c, agents, [], 1).length, 1);
  assert.equal(buildActivity(c, new Map(), [], 5)[0].agent, 'Unknown agent');
});

test('a budget alert becomes a need, and not before the alert line', () => {
  const svc = [{ id: 'wsl', title: 'WSL', about: '', state: 'ok' }];
  const need = (spend) => deriveNeeds({ services: svc, paperclip: { up: true, crew: [] }, diskFreeGB: 80, spend }).find((n) => n.id === 'budget');
  assert.equal(need({ level: 'ok', pct: 14, budgetUsd: 100, monthUsd: 14 }), undefined);
  const w = need({ level: 'warn', pct: 82.4, budgetUsd: 100, monthUsd: 82.4, projectedUsd: 120 });
  assert.equal(w.level, 'warn'); assert.match(w.title, /82.4%/); assert.match(w.why, /on pace for about \$120/);
  assert.equal(need({ level: 'fail', pct: 101, budgetUsd: 100, monthUsd: 101 }).level, 'fail');
});
