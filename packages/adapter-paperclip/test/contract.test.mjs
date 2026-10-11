// Contract test: the adapter's read model against REAL responses recorded from Paperclip 2026.1005.0
// (packages/adapter-paperclip/fixtures, made by record-fixtures.mjs). If Paperclip changes a field the reconciler
// depends on, re-record, and this test (plus `stack doctor`) shows exactly what moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normaliseAgent, normaliseRoutine } from '../src/client.mjs';

const fx = (n) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/${n}.json`, import.meta.url)), 'utf8'));
const agent = fx('agent'), instr = fx('instructions'), skills = fx('agentSkills'), company = fx('companySkills'), routine = fx('routine');

test('the agent fields the reconciler reads still exist', () => {
  for (const k of ['id', 'name', 'role', 'title', 'icon', 'budgetMonthlyCents', 'reportsTo', 'adapterConfig', 'runtimeConfig', 'metadata', 'updatedAt']) assert.ok(k in agent, `agent.${k}`);
  for (const k of ['model', 'command', 'timeoutSec', 'env']) assert.ok(k in { ...agent.adapterConfig, model: 0 }, `adapterConfig.${k}`);
  assert.ok(Array.isArray(skills.desiredSkills), 'agentSkills.desiredSkills');
  for (const k of ['content', 'contentHash', 'revision']) assert.ok(k in instr, `instructions.${k}`);
  assert.ok(instr.revision.id, 'instructions.revision.id');
  assert.ok(Array.isArray(routine.triggers) && routine.triggers[0].cronExpression, 'routine.triggers[].cronExpression');
});

test('env values are redacted by the API, which is why env is compared by key names', () => {
  assert.equal(Object.values(agent.adapterConfig.env)[0].value, '***REDACTED***');
});

test('normaliseAgent: the projection the planner compares', () => {
  const slugOf = new Map(company.map?.((s) => [s.key, s.slug]) ?? []);
  const n = normaliseAgent(agent, { instructions: { content: instr.content, revisionId: instr.revision.id }, skillKeys: skills.desiredSkills, slugOf, idToKey: (id) => `key:${id}` });
  assert.deepEqual(n.env, ['ANTHROPIC_BASE_URL']);
  assert.deepEqual(n.heartbeat, { enabled: false, maxConcurrentRuns: 2 });
  assert.equal(n.reportsTo, `key:${agent.reportsTo}`);
  assert.equal(n.model, null);
  assert.equal(n.instructions, 'You build.\n');
  assert.equal(n.stack.key, 'eng');
  assert.ok(!n.skills.includes('paperclip'), 'the built-in skill is never compared');
});

test('normaliseRoutine: schedule trigger flattened', () => {
  const n = normaliseRoutine(routine, (id) => `key:${id}`);
  assert.equal(n.cron, '0 9 * * 1-5'); assert.equal(n.timezone, 'UTC'); assert.equal(n.enabled, true);
  assert.equal(n.assignee, `key:${routine.assigneeAgentId}`); assert.ok(n.triggerId);
});
