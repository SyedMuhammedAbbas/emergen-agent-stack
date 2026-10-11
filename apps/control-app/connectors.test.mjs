import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMcpList, buildView, createConnectors, STATUS_SCRIPT } from './src/connectors.mjs';

const repo = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SAMPLE = `Checking MCP server health…

claude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected
claude.ai n8n: https://aliqualifi.app.n8n.cloud/mcp-server/http - ! Needs authentication
plugin:operations:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication
plugin:operations:google calendar:  (HTTP) - - Not configured
upwork: https://mcp.upwork.com/mcp (HTTP) - ✔ Connected
broken: https://x.test/mcp (HTTP) - ✗ Failed to connect
`;

test('claude mcp list is parsed into name, address and a plain status', () => {
  const l = parseMcpList(SAMPLE), by = Object.fromEntries(l.map((x) => [x.name, x.status]));
  assert.equal(l.length, 6);
  assert.deepEqual([by['claude.ai Notion'], by['claude.ai n8n'], by['plugin:operations:google calendar'], by.upwork, by.broken], ['connected', 'needs-auth', 'not-configured', 'connected', 'failed']);
  assert.equal(l.find((x) => x.name === 'upwork').url, 'https://mcp.upwork.com/mcp');
});

const conn = (o) => ({ schemaVersion: 1, id: 'upwork', name: 'Upwork', category: 'freelance', summary: 's', roles: ['lead-scout'], connect: { type: 'mcp-http', server: 'upwork', url: 'https://mcp.upwork.com/mcp' }, steps: [
  { kind: 'action', id: 'register', title: 'r', do: 'register-mcp' }, { kind: 'manual', id: 'sign-in', title: 's' }, { kind: 'check', id: 'verify', title: 'v', check: 'mcp-status' }, { kind: 'action', id: 'permissions', title: 'p', do: 'sync-policy' }], ...o });
const view = (c, obs) => buildView([c], obs)[0];

test('status and step states follow what was observed', () => {
  const none = view(conn(), { mcp: [] });
  assert.equal(none.status, 'not-set-up'); assert.deepEqual(none.steps.map((s) => s.state), ['todo', 'todo', 'todo', 'todo']); assert.equal(none.currentStep, 'register');
  const reg = view(conn(), { mcp: [{ name: 'upwork', status: 'needs-auth' }] });
  assert.equal(reg.status, 'needs-sign-in'); assert.deepEqual(reg.steps.map((s) => s.state), ['done', 'todo', 'todo', 'todo']); assert.equal(reg.currentStep, 'sign-in');
  const live = view(conn(), { mcp: [{ name: 'upwork', status: 'connected' }], policyServers: ['upwork'] });
  assert.equal(live.status, 'connected'); assert.ok(live.steps.every((s) => s.state === 'done')); assert.equal(live.currentStep, null);
  assert.equal(view(conn(), { mcp: [{ name: 'upwork', status: 'connected' }], activity: [{ server: 'upwork', calls24h: 3 }] }).status, 'active');
  assert.equal(view(conn(), { mcp: [{ name: 'upwork', status: 'failed' }] }).status, 'failed');
});

test('cli, local service and secret-file steps are checked, not trusted', () => {
  const gh = { ...conn(), id: 'github', connect: { type: 'cli', binary: 'gh', authCheck: 'gh-auth' }, steps: [{ kind: 'check', id: 'installed', title: 'i', check: 'binary' }, { kind: 'check', id: 'signed-in', title: 's', check: 'gh-auth' }] };
  assert.equal(view(gh, { bins: { gh: false } }).status, 'not-set-up'); assert.equal(view(gh, { bins: { gh: true }, ghAuth: false }).status, 'needs-sign-in'); assert.equal(view(gh, { bins: { gh: true }, ghAuth: true }).status, 'connected');
  const svc = { ...conn(), id: 'omni', connect: { type: 'local-service', health: 'http://127.0.0.1:20128/api/health' }, steps: [{ kind: 'check', id: 'running', title: 'r', check: 'health' }] };
  assert.equal(view(svc, { health: { omni: true } }).status, 'connected'); assert.equal(view(svc, { health: { omni: false } }).status, 'failed');
  const sk = { ...conn(), connect: { type: 'mcp-stdio', server: 'p', package: 'p@1.0.0', env: ['P_KEY'] }, steps: [{ kind: 'check', id: 'key', title: 'k', check: 'secret-file', secret: 'P_KEY' }] };
  assert.equal(view(sk, { mcp: [], secrets: { P_KEY: true } }).steps[0].state, 'done'); assert.equal(view(sk, { mcp: [], secrets: {} }).steps[0].state, 'todo');
});

test('the status script only reads: no writes, no secret contents', () => { assert.ok(!/\bcat\b|>\s*[^&\s]|rm |tee/.test(STATUS_SCRIPT.replace(/>\/dev\/null 2>&1|2>\/dev\/null|2>&1/g, ''))); assert.match(STATUS_SCRIPT, /-f "\$HOME\/\.agent-stack\/secrets\/\$s"/); });

// ---- running steps ----
function harness(extra = {}) {
  const calls = [], audit = [], appDir = mkdtempSync(join(tmpdir(), 'conn-'));
  const exec = async (cmd, args) => { calls.push({ cmd, args }); if (extra.fail) { const e = new Error('boom'); e.stderr = 'claude: MCP server upwork already exists'; throw e; } return { stdout: '', stderr: '' }; };
  const api = createConnectors({ repo, settings: { distro: 'Ubuntu-24.04' }, appDir, exec, fetch: async () => ({ ok: true }), audit: { add: (r) => audit.push(r) } });
  return { api, calls, audit, appDir };
}
const tail = (c) => c.args.slice(c.args.indexOf('_') + 1);

test('registering an http server passes the name and address as arguments, and is audited', async () => {
  const { api, calls, audit } = harness();
  const r = await api.run({ id: 'upwork', step: 'register', op: 'run' });
  assert.equal(r.status, 200); assert.equal(calls.length, 1);
  assert.deepEqual(tail(calls[0]), ['upwork', 'https://mcp.upwork.com/mcp']); assert.match(calls[0].args.join(' '), /claude mcp add --transport http --scope user "\$@"/);
  assert.equal(audit[0].action, 'register-mcp:upwork'); assert.equal(audit[0].ok, true);
});

test('an npm-run tool needs an explicit confirmation, then runs with the pinned package', async () => {
  const { api, calls } = harness();
  const refused = await api.run({ id: 'playwright', step: 'register', op: 'run' });
  assert.equal(refused.status, 409); assert.equal(refused.needsConfirm, true); assert.equal(calls.length, 0);
  const ok = await api.run({ id: 'playwright', step: 'register', op: 'run', confirmThirdParty: true });
  assert.equal(ok.status, 200); assert.deepEqual(tail(calls[0]), ['playwright', '@playwright/mcp@0.0.83', '--']);
});

test('only action steps run; manual steps are ticked off, and only manual ones; unknown things are refused', async () => {
  const { api, calls, appDir } = harness();
  assert.equal((await api.run({ id: 'upwork', step: 'sign-in', op: 'run' })).status, 400); // a manual step cannot be "run"
  assert.equal((await api.run({ id: 'upwork', step: 'register', op: 'confirm' })).status, 400); // an action cannot be ticked off
  assert.equal((await api.run({ id: 'upwork', step: 'verify', op: 'run' })).status, 400); // a check does not run anything
  assert.equal((await api.run({ id: 'nope', step: 'x', op: 'run' })).status, 404); assert.equal((await api.run({ id: 'upwork', step: 'nope', op: 'run' })).status, 404);
  assert.equal((await api.run({ id: '../upwork', step: 'register', op: 'run' })).status, 404);
  assert.equal(calls.length, 0);
  assert.equal((await api.run({ id: 'upwork', step: 'sign-in', op: 'confirm' })).status, 200);
  assert.ok(existsSync(join(appDir, 'connector-progress.json'))); assert.ok(JSON.parse(readFileSync(join(appDir, 'connector-progress.json'), 'utf8'))['sign-in']);
});

test('a failing step reports the reason without leaking, and is audited as failed', async () => {
  const { api, audit } = harness({ fail: true });
  const r = await api.run({ id: 'upwork', step: 'register', op: 'run' });
  assert.equal(r.status, 502); assert.match(r.error, /already exists/); assert.equal(audit[0].ok, false);
});

// ---- OmniRoute walkthrough ----
test('OmniRoute: the wiring step follows what is observed, and the key file is only checked for existence', () => {
  const omni = { schemaVersion: 1, id: 'omniroute', name: 'OmniRoute', category: 'ai-models', summary: 's', connect: { type: 'local-service', health: 'http://127.0.0.1:20128/api/health' }, steps: [
    { kind: 'check', id: 'key-file', title: 'k', check: 'secret-file', secret: 'OMNIROUTE_API_KEY' }, { kind: 'action', id: 'wire', title: 'w', do: 'wire-omniroute' }, { kind: 'check', id: 'wired', title: 'c', check: 'omniroute-wired' }] };
  const v0 = buildView([omni], { health: { omniroute: true }, secrets: {}, omniWired: false })[0];
  assert.deepEqual(v0.steps.map((s) => s.state), ['todo', 'todo', 'todo']); assert.equal(v0.currentStep, 'key-file'); assert.equal(v0.status, 'connected');
  const v1 = buildView([omni], { health: { omniroute: true }, secrets: { OMNIROUTE_API_KEY: true }, omniWired: true })[0];
  assert.deepEqual(v1.steps.map((s) => s.state), ['done', 'done', 'done']); assert.equal(v1.currentStep, null);
  assert.match(STATUS_SCRIPT, /20128/); assert.ok(!/OMNIROUTE_API_KEY=/.test(STATUS_SCRIPT));
});

test('wiring runs the repo script in WSL; a refusal comes back as the script\'s own explanation', async () => {
  const calls = [];
  const mk = (out, fail) => createConnectors({ repo, settings: { distro: 'Ubuntu-24.04' }, appDir: mkdtempSync(join(tmpdir(), 'conn-')), fetch: async () => ({ ok: true }),
    exec: async (c, a) => { calls.push(a); if (fail) { const e = new Error('exit 1'); e.stdout = out; throw e; } return { stdout: out }; } });
  const ok = await mk('live test passed\nDONE.', false).run({ id: 'omniroute', step: 'wire', op: 'run' });
  assert.equal(ok.status, 200); assert.match(ok.output, /DONE/); assert.match(calls[0].join(' '), /wsl\/46-omniroute-wire\.sh/); assert.equal(calls[0][calls[0].indexOf('_') + 1].includes('agent-stack'), true);
  const refused = await mk('  MISSING  no OmniRoute API key: create the file\nNothing was changed.', true).run({ id: 'omniroute', step: 'wire', op: 'run' });
  assert.equal(refused.status, 502); assert.match(refused.error, /MISSING\s+no OmniRoute API key/); assert.match(refused.error, /Nothing was changed/);
});
