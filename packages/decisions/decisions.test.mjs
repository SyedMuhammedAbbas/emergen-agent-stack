import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDefinition } from './src/definition.mjs';
import { createDecisionService } from './src/service.mjs';
import { evaluate } from './src/eval.mjs';
import { functionProvider, openrouterProvider, parseJsonAnswer } from './src/providers.mjs';
import { loadBuiltins, movedCsv } from './src/builtin.mjs';

const repo = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const def = (o = {}) => ({ schemaVersion: 1, id: 'pick-color', title: 'Pick', kind: 'choice', options: [{ id: 'red' }, { id: 'blue' }, { id: 'none' }], threshold: 0.7, fallback: { kind: 'rule' }, dataClass: 'none', timeoutMs: 500,
  eval: { loader: 'x', minAnswerAccuracy: 0.9, minMarginOverBaseline: 0.03, minCoverage: 0.1, minLabelled: 20 }, enabled: true, ...o });
const h = (s) => parseInt(createHash('sha256').update(String(s)).digest('hex').slice(0, 6), 16) / 0xffffff;

test('definitions need a way out, a fallback, a data class and a bar to clear', () => {
  assert.ok(validateDefinition(def()).ok);
  assert.equal(validateDefinition(def({ options: [{ id: 'red' }, { id: 'blue' }] })).ok, false); // no "none"
  assert.equal(validateDefinition(def({ threshold: 0.1 })).ok, false);
  assert.equal(validateDefinition(def({ fallback: { kind: 'safe-default', default: 'green' } })).ok, false);
  assert.equal(validateDefinition(def({ dataClass: 'everything' })).ok, false);
  assert.equal(validateDefinition(def({ eval: undefined })).ok, false);
  assert.equal(validateDefinition(def({ extra: 1 })).ok, false);
});

const svc = (over = {}, provider = functionProvider(() => 'blue'), d = def()) => createDecisionService({ definitions: [d], providers: { jev: provider }, baselines: { 'pick-color': () => 'red' }, evalPassed: () => true, ...over });

test('confident answer is used; low confidence, none, bad choice, error and timeout all fall back and never throw', async () => {
  const conf = (c, choice = 'blue') => ({ remote: false, decide: async () => ({ choice, confidence: c }) });
  assert.deepEqual(pick(await svc({}, conf(0.9)).decide('pick-color', {})), ['blue', 'jev']);
  assert.deepEqual(pick(await svc({}, conf(0.5)).decide('pick-color', {})), ['red', 'rule']);
  assert.deepEqual(pick(await svc({}, conf(0.99, 'none')).decide('pick-color', {})), ['red', 'rule']);
  assert.deepEqual(pick(await svc({}, conf(0.99, 'purple')).decide('pick-color', {})), ['red', 'rule']); // outside the closed list
  assert.deepEqual(pick(await svc({}, conf(7)).decide('pick-color', {})), ['red', 'rule']);
  assert.deepEqual(pick(await svc({}, { remote: false, decide: async () => { throw new Error('down'); } }).decide('pick-color', {})), ['red', 'rule']);
  const slow = await svc({}, { remote: false, decide: () => new Promise(() => {}) }, def({ timeoutMs: 100 })).decide('pick-color', {});
  assert.deepEqual(pick(slow), ['red', 'rule']); assert.match(slow.reason, /timeout/);
});
const pick = (r) => [r.choice, r.source];

test('disabled, unproven, no provider and unapproved data class never reach the provider', async () => {
  let calls = 0; const p = { remote: true, decide: async () => { calls++; return { choice: 'blue', confidence: 1 }; } };
  assert.equal((await svc({}, p, def({ enabled: false })).decide('pick-color', {})).source, 'rule');
  assert.equal((await svc({ evalPassed: () => false }, p).decide('pick-color', {})).source, 'rule');
  assert.equal((await svc({ providers: {} }, p).decide('pick-color', {})).source, 'rule');
  assert.match((await svc({}, p, def({ dataClass: 'filenames' })).decide('pick-color', {})).reason, /not approved/);
  assert.equal(calls, 0);
  assert.equal((await svc({ allowedDataClasses: ['filenames'] }, p, def({ dataClass: 'filenames' })).decide('pick-color', {})).source, 'jev');
});

test('ask-human and safe-default fallbacks; private inputs are logged as a hash only', async () => {
  const bad = { remote: false, decide: async () => { throw new Error('x'); } };
  const human = await svc({}, bad, def({ fallback: { kind: 'ask-human' } })).decide('pick-color', {}); assert.equal(human.needsHuman, true); assert.equal(human.choice, 'none');
  assert.equal((await svc({}, bad, def({ fallback: { kind: 'safe-default', default: 'blue' } })).decide('pick-color', {})).choice, 'blue');
  const { mkdtempSync, readFileSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'dec-')); await svc({ logDir: dir }, functionProvider(() => 'blue'), def({ dataClass: 'private' })).decide('pick-color', { content: 'hunter2' });
  const line = readFileSync(join(dir, 'calls.jsonl'), 'utf8'); assert.ok(!line.includes('hunter2')); assert.match(line, /sha256/);
});

// ---- harness ----
const items = Array.from({ length: 300 }, (_, i) => ({ input: { n: i }, label: h(i) < 0.5 ? 'red' : 'blue' }));
const baseline = (input) => (h('b' + input.n) < 0.7 ? (h(input.n) < 0.5 ? 'red' : 'blue') : (h(input.n) < 0.5 ? 'blue' : 'red')); // ~70% right
const model = (acc, confGood = 0.9, confBad = 0.55) => ({ decide: async ({ input }) => { const truth = h(input.n) < 0.5 ? 'red' : 'blue', right = h('m' + input.n) < acc; return { choice: right ? truth : truth === 'red' ? 'blue' : 'red', confidence: right ? confGood : confBad }; } });

test('harness: a good model passes on the held-out half, with buckets and a tuned threshold', async () => {
  const r = await evaluate({ definition: def(), items, provider: model(0.95), baseline });
  assert.equal(r.halves.tune + r.halves.report, 300); assert.ok(r.halves.report > 100);
  assert.equal(r.passes, true, r.why.join(' '));
  assert.ok(r.provider.tunedThreshold >= 0.5); assert.ok(r.provider.held_out.endToEnd > r.baseline.accuracyReport);
  assert.ok(r.provider.buckets.some((b) => b.n > 0));
});

test('harness: a model that is wrong when confident fails, as does one that is no better than the rules', async () => {
  const wrong = await evaluate({ definition: def(), items, provider: model(0.6, 0.95, 0.95), baseline });
  assert.equal(wrong.passes, false); assert.ok(wrong.why.length);
  const meh = await evaluate({ definition: def({ eval: { ...def().eval, minMarginOverBaseline: 0.2 } }), items, provider: model(0.95), baseline });
  assert.equal(meh.passes, false); assert.match(meh.why.join(' '), /margin/);
});

test('harness: failures and unknown labels are counted; too little data does not pass; no provider reports the baseline and the headroom', async () => {
  const broken = await evaluate({ definition: def(), items, provider: { decide: async () => { throw new Error('down'); } }, baseline });
  assert.equal(broken.passes, false); assert.equal(broken.provider.errorRate, 100);
  const few = await evaluate({ definition: def(), items: items.slice(0, 10), provider: model(1), baseline }); assert.equal(few.passes, false);
  const odd = await evaluate({ definition: def(), items: [...items, { input: { n: 999 }, label: 'green' }], baseline }); assert.equal(odd.droppedUnknownLabels, 1);
  assert.equal(odd.provider, null); assert.match(odd.headroom, /at most/);
  const a = await evaluate({ definition: def(), items, baseline }), b = await evaluate({ definition: def(), items: [...items].reverse(), baseline });
  assert.deepEqual(a.halves, b.halves); // the split depends on the example, not its position
});

test('OpenRouter provider: fails safe on anything unexpected and never needs the network in tests', async () => {
  const ok = (content) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const mk = (f) => openrouterProvider({ key: 'test-key-not-real', fetchImpl: f });
  assert.deepEqual(await mk(ok('{"choice":"red","confidence":0.8}')).decide({ definition: def(), input: { a: 1 } }), { choice: 'red', confidence: 0.8 });
  assert.deepEqual(parseJsonAnswer({ choices: [{ message: { content: '```json\n{"choice":"blue","confidence":1}\n```' } }] }), { choice: 'blue', confidence: 1 });
  await assert.rejects(mk(ok('I think red')).decide({ definition: def(), input: {} }));
  await assert.rejects(mk(async () => ({ ok: false, status: 401 })).decide({ definition: def(), input: {} }), /401/);
  await assert.rejects(openrouterProvider({ key: null }).decide({ definition: def(), input: {} }), /no OpenRouter key/);
  // and through the service it falls back instead of failing
  const s = createDecisionService({ definitions: [def()], providers: { jev: mk(ok('garbage')) }, baselines: { 'pick-color': () => 'red' }, evalPassed: () => true });
  assert.equal((await s.decide('pick-color', {})).source, 'rule');
});

test('downloads-folder: definition is valid, every rules.js folder is an option, labels parse, baseline runs', async () => {
  const b = await loadBuiltins(repo), d = b.definitions[0];
  assert.ok(validateDefinition(d).ok); assert.equal(d.enabled, false);
  const opts = new Set(d.options.map((o) => o.id)); for (const [folder] of b.rules.RULES) assert.ok(opts.has(folder), folder); assert.ok(opts.has('Misc'));
  assert.deepEqual(movedCsv('﻿"result","bucket","name"\n"moved","Finance","a ""b"".pdf"\n"skipped","X","y"\n'), [{ input: { name: 'a "b".pdf' }, label: 'Finance' }]);
  assert.equal(b.baselines['downloads-folder']({ name: 'invoice.pdf' }), 'Finance');
});
