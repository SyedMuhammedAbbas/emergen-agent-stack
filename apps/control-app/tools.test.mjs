import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTools, CMD } from './src/tools.mjs';

const now = Date.parse('2026-10-12T12:00:00Z');
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const policy = { schemaVersion: 1, integrations: { upwork: { id: 'upwork', toolPolicy: { '*': 'ask', searchJobs: 'allow', deleteAccount: 'off' } } } };
const ev = (o) => JSON.stringify({ server: 'upwork', ...o });
const out = (events, grants = []) => [JSON.stringify(policy), JSON.stringify({ grants }), events.join('\n')].join('\n---\n');

test('integrations, 24h numbers, last activity, and the feed with agent names', () => {
  const t = parseTools(out([
    ev({ at: iso(300), t: 'call', tool: 'mcp__upwork__searchJobs', name: 'searchJobs', decision: 'allowed', agentId: 'a1', argKeys: ['query'] }),
    ev({ at: iso(200), t: 'result', tool: 'mcp__upwork__searchJobs', name: 'searchJobs', ok: true }),
    ev({ at: iso(10), t: 'call', tool: 'mcp__upwork__submitProposal', name: 'submitProposal', decision: 'blocked', agentId: 'a1' }),
    ev({ at: iso(5), t: 'result', tool: 'mcp__upwork__searchJobs', name: 'searchJobs', ok: false }),
    ev({ at: iso(60 * 30), t: 'call', tool: 'mcp__upwork__old', name: 'old', decision: 'allowed' }), // older than 24 h
  ]), { a1: 'Lead Scout' }, now);
  const u = t.integrations[0];
  assert.equal(u.server, 'upwork'); assert.equal(u.defaultPolicy, 'ask'); assert.deepEqual(u.policy.map((p) => p.action).sort(), ['allow', 'off']);
  assert.deepEqual([u.calls24h, u.blocked24h, u.errors24h], [2, 1, 1]); assert.equal(u.lastTool, 'searchJobs');
  assert.deepEqual(t.last24h, { calls: 2, blocked: 1, errors: 1 });
  assert.equal(t.feed[0].kind, 'result'); assert.equal(t.feed.find((f) => f.name === 'submitProposal').agent, 'Lead Scout');
  assert.equal(t.logging.hasLog, true);
});

test('servers that were called but are not in the policy are surfaced; expired grants are dropped; missing files do not throw', () => {
  const t = parseTools(out([ev({ server: 'mystery', at: iso(3), t: 'call', tool: 'mcp__mystery__x', name: 'x', decision: 'blocked' })], [{ tool: 'mcp__upwork__submitProposal', until: iso(-60) }, { tool: 'mcp__upwork__old', until: iso(60) }]), {}, now);
  assert.deepEqual(t.unlisted.map((u) => u.server), ['mystery']); assert.equal(t.grants.length, 1);
  const none = parseTools('\n---\n\n---\n', {}, now);
  assert.equal(none.hasPolicy, false); assert.deepEqual(none.integrations, []); assert.equal(none.logging.hasLog, false);
  assert.equal(parseTools('garbage', {}, now).feed.length, 0);
});

test('the read command is read-only', () => { assert.ok(!/[>|]\s*\S*(rm|mv|tee)|\brm\b|\bmv\b|>>?\s*\//.test(CMD.replace(/2>\/dev\/null/g, ''))); });

test('a policy file without a trailing newline still splits from the next section (real file shape)', () => {
  const t = parseTools(JSON.stringify(policy) + '\n---\n' + JSON.stringify({ grants: [] }) + '\n---\n' + ev({ at: iso(1), t: 'call', tool: 'mcp__upwork__x', name: 'x', decision: 'allowed' }), {}, now);
  assert.equal(t.integrations.length, 1); assert.equal(t.feed.length, 1);
  assert.match(CMD, /echo; echo '---'/); // the command itself guarantees the newline
});
