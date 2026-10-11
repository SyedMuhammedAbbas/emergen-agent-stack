import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argsFor, createPermissions } from './src/permissions.mjs';

const repo = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cli = join(repo, 'apps', 'cli', 'stack.mjs');

test('only plain names and known choices become CLI arguments', () => {
  assert.deepEqual(argsFor({ server: 'upwork', tool: 'searchJobs', action: 'allow' }).args, ['integrations', 'set', 'upwork', 'searchJobs', 'allow']);
  assert.deepEqual(argsFor({ server: 'upwork', tool: '*', action: 'off' }).args, ['integrations', 'set', 'upwork', '*', 'off']);
  assert.deepEqual(argsFor({ server: 'upwork', tool: 'x', action: 'default' }).args.slice(0, 2), ['integrations', 'unset']);
  assert.deepEqual(argsFor({ server: 'upwork', tool: 'submitProposal', action: 'allow-for', minutes: 60 }).args, ['integrations', 'grant', 'upwork', 'submitProposal', '--minutes', '60']);
  for (const bad of [
    { server: 'up work; id', tool: 'x', action: 'allow' }, { server: 'upwork', tool: 'a b', action: 'allow' }, { server: 'upwork', tool: '$(id)', action: 'allow' }, { server: 'upwork', tool: '../x', action: 'allow' },
    { server: 'upwork', tool: 'x', action: 'yes' }, { server: 'upwork', tool: 'x', action: 'allow-for', minutes: 0 }, { server: 'upwork', tool: 'x', action: 'allow-for', minutes: 99999 },
    { server: 'upwork', tool: 'x', action: 'allow-for', minutes: 'ten' }, { server: 'upwork', tool: '*', action: 'allow-for', minutes: 5 }, { server: '', tool: 'x', action: 'ask' }, { server: 'upwork', tool: 'x', action: undefined },
  ]) assert.equal(argsFor(bad).ok, false, JSON.stringify(bad));
});

test('the change runs as separate arguments after the repo path, and is audited', async () => {
  const calls = [], audit = [];
  const p = createPermissions({ repo, settings: { distro: 'Ubuntu-24.04' }, audit: { add: (r) => audit.push(r) }, exec: async (c, a) => { calls.push(a); return {}; } });
  assert.equal((await p.run({ server: 'upwork', tool: 'searchJobs', action: 'allow' })).status, 200);
  const a = calls[0], i = a.indexOf('_'); assert.deepEqual(a.slice(i + 2), ['integrations', 'set', 'upwork', 'searchJobs', 'allow']); assert.match(a[i - 1], /exec node apps\/cli\/stack\.mjs "\$@"/);
  assert.equal((await p.run({ server: 'bad name', tool: 'x', action: 'allow' })).status, 400); assert.equal(calls.length, 1);
  assert.equal(audit.length, 1); assert.equal(audit[0].ok, true);
  const failing = createPermissions({ repo, settings: { distro: 'x' }, exec: async () => { throw new Error('wsl down'); } });
  assert.equal((await failing.run({ server: 'upwork', tool: 'x', action: 'ask' })).status, 502);
});

test('stack integrations set / unset layers the owner\'s choice over the connector file and survives a re-sync', () => {
  const state = mkdtempSync(join(tmpdir(), 'perm-')), run = (...a) => spawnSync(process.execPath, [cli, 'integrations', ...a], { encoding: 'utf8', env: { ...process.env, AGENT_STACK_STATE: state } });
  const pol = () => JSON.parse(readFileSync(join(state, 'integrations.json'), 'utf8')).integrations.upwork.toolPolicy;
  assert.equal(run('sync').status, 0); assert.deepEqual(pol(), { '*': 'ask' });
  assert.equal(run('set', 'upwork', 'searchJobs', 'allow').status, 0); assert.deepEqual(pol(), { '*': 'ask', searchJobs: 'allow' });
  assert.equal(run('set', 'upwork', 'deleteAccount', 'off').status, 0); assert.equal(pol().deleteAccount, 'off');
  assert.equal(run('sync').status, 0); assert.equal(pol().searchJobs, 'allow'); // re-sync keeps the owner's choices
  assert.equal(run('unset', 'upwork', 'searchJobs').status, 0); assert.equal(pol().searchJobs, undefined);
  assert.notEqual(run('set', 'upwork', 'x', 'maybe').status, 0); assert.notEqual(run('set', 'up work', 'x', 'allow').status, 0);
  assert.equal(run('set', 'upwork', 'submitProposal', 'allow').status, 0); // allow is possible; a grant for an "off" tool is not
  assert.notEqual(run('grant', 'upwork', 'deleteAccount').status, 0);
});
