import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRouterOutput, readModels, pathsOf, tiersOf, cmdFor } from '../src/models.mjs';
import { createStore } from '../src/state.mjs';

const CFG = { tiers: ['fast', 'balanced', 'frontier'], defaultTier: 'balanced', baselineModel: 'opus', modelPins: { fable: 'frontier', opus: 'frontier', sonnet: 'balanced', haiku: 'fast' }, policy: { mode: 'ratchet', accept: { fast: 0.85, balanced: 0.6, frontier: 0.3 }, maxProvisional: 3, idleResetMinutes: 10 } };
const NOW = Date.parse('2026-10-11T18:00:00Z');
const ev = (mins, tier, model, reason = 'routine edit') => JSON.stringify({ ts: new Date(NOW - mins * 60000).toISOString(), event: 'route', tier, model, reason, session: 's' });
const out = (events) => `${JSON.stringify(CFG)}\n---\n${events.join('\n')}\n`;

test('tiers are the pins reversed, with the confidence each tier needs', () => {
  const t = tiersOf(CFG);
  assert.deepEqual(t.map((x) => [x.tier, x.models, x.confidence, x.isDefault]), [['fast', ['haiku'], 0.85, false], ['balanced', ['sonnet'], 0.6, true], ['frontier', ['fable', 'opus'], 0.3, false]]);
});

test('router output: config, 24 h tally by tier and model, recent decisions newest first', () => {
  const r = parseRouterOutput(out([ev(2000, 'fast', 'haiku'), ev(300, 'balanced', 'sonnet'), ev(60, 'balanced', 'sonnet'), ev(10, 'frontier', 'opus', 'refactor across modules')]), NOW);
  assert.equal(r.config.policy.mode, 'ratchet'); assert.equal(r.config.tiers[0].tier, 'fast');
  assert.deepEqual(r.last24h, { total: 3, byTier: { balanced: 2, frontier: 1 }, byModel: { sonnet: 2, opus: 1 } });      // the 2000-minute-old event is outside 24 h
  assert.equal(r.recent.length, 4); assert.equal(r.recent[0].tier, 'frontier'); assert.equal(r.recent[0].reason, 'refactor across modules');
});

test('router output: bad or missing pieces degrade, and secrets in a reason are masked and capped', () => {
  assert.equal(parseRouterOutput('garbage', NOW).config, null);
  assert.deepEqual(parseRouterOutput('', NOW).last24h, { total: 0, byTier: {}, byModel: {} });
  const r = parseRouterOutput(out([ev(5, 'fast', 'haiku', 'use key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv ' + 'x'.repeat(200)), '{not json', JSON.stringify({ event: 'done' })]), NOW);
  assert.equal(r.recent.length, 1); assert.doesNotMatch(r.recent[0].reason, /sk-ant/); assert.ok(r.recent[0].reason.length <= 70);
});

test('the WSL command reads only a filtered slice of the config and never the env file', () => {
  const c = cmdFor();
  assert.match(c, /config\.json/); assert.match(c, /router\.log/); assert.doesNotMatch(c, /\benv\b['"]?\s*$|jev-router\/env|setup\.json/);
  assert.doesNotMatch(c, /keyEnv|apiKey|channels/);
});

test('readModels combines healthz, the WSL slice and the OmniRoute probe; failures become "down"', async () => {
  const fetch = async (u) => { if (String(u).includes('4000/healthz')) return { json: async () => ({ ok: true, version: '1.6.0', uptime_s: 6500, sessions: 2, active: 1, jev: { configured: true, channels: { openrouter: { calls: 40, errors: 2, lastError: 'HTTP 429 token=abcdef123456', open: false } } } }) }; return { status: 200 }; };
  const exec = async () => ({ stdout: out([ev(5, 'balanced', 'sonnet')]) });
  const m = await readModels({ distro: 'Ubuntu-24.04' }, { exec, fetch });
  assert.equal(m.router.up, true); assert.equal(m.router.sessions, 2); assert.equal(m.router.jev.channels[0].calls, 40); assert.doesNotMatch(m.router.jev.channels[0].lastError, /abcdef123456/);
  assert.equal(m.omniroute.up, true); assert.equal(m.router.config.defaultTier, 'balanced');
  const down = await readModels({ distro: 'U' }, { exec: async () => { throw new Error('wsl down'); }, fetch: async () => { throw new Error('refused'); } });
  assert.equal(down.router.up, false); assert.equal(down.omniroute.up, false); assert.equal(down.router.config, null); assert.deepEqual(down.router.recent, []);
});

test('agents by path: jev-router, direct Claude, other models', () => {
  const p = pathsOf([{ name: 'A', model: 'jev-router' }, { name: 'B', model: 'claude-sonnet-5' }, { name: 'C', model: 'default' }, { name: 'D', model: 'openrouter/qwen' }, { name: 'E', model: 'jev-router' }]);
  assert.deepEqual([p.jev.length, p.direct.length, p.omni.length], [2, 2, 1]); assert.equal(p.omni[0].name, 'D');
});

test('the store refreshes models in the background and exposes them with the agent paths', async () => {
  let calls = 0;
  const io = { exec: async (c, a) => (a[0] === '-l' ? { stdout: 'Ubuntu-24.04\n' } : { stdout: '' }), diskFreeGB: () => 80, stackPlan: async () => ({ agents: [], counts: {} }),
    fetch: async (u) => { const p = new URL(u).pathname.replace('/api', ''); const d = { '/companies': [{ id: 'c', name: 'E' }], '/companies/c/agents': [{ id: '1', name: 'Dev', title: 'Dev', status: 'idle', adapterConfig: { env: { ANTHROPIC_BASE_URL: '*' } }, metadata: null }], '/companies/c/heartbeat-runs': [], '/companies/c/approvals': [] }[p]; return d === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => d }; },
    readModels: async () => { calls++; return { router: { up: true }, omniroute: { up: false } }; } };
  const s = createStore({ settings: { distro: 'U', paperclip: 'http://x', budgetUsd: 100, alertAt: 0.8, appDir: mkdtempSync(join(tmpdir(), 'md-')) }, io, ttlMs: 0 });
  const first = await s.get(); assert.equal(first.models, null);                                // not waited for
  await new Promise((r) => setTimeout(r, 20)); const next = await s.get();
  assert.equal(next.models.router.up, true); assert.equal(next.models.paths.jev[0].name, 'Dev'); assert.equal(calls, 1);   // not asked again within 30 s
});
