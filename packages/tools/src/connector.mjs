// A connector file (connectors/<id>.json) describes one tool the system can connect to: what it is, how it connects, what
// agents may do with it by default, and (optionally) its setup walkthrough. Adding a new tool is adding one such file.
// Everything is typed data. A file cannot carry a command: setup steps and checks come from a small fixed set that the
// control app implements, using values from the `connect` block only after they pass the patterns below.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { scanText } from '../../../apps/control-app/src/secretscan.mjs';

export const CATEGORIES = ['freelance', 'design', 'code', 'communication', 'automation', 'storage', 'data', 'ai-models', 'browser', 'other'];
const KEYS = new Set(['schemaVersion', 'id', 'name', 'category', 'summary', 'website', 'roles', 'connect', 'policy', 'steps']);
const ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, SERVER = /^[a-z0-9][a-z0-9_-]{1,38}$/;
const HTTPS = /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/i;
const PINNED = /^(@[a-z0-9-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+$/, ENVNAME = /^[A-Z][A-Z0-9_]{1,40}$/, BINARY = /^[a-z0-9][a-z0-9._-]{0,30}$/, HEALTH = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/[A-Za-z0-9._\/-]*$/;
const POLICY = new Set(['allow', 'ask', 'off']), STEP_KINDS = new Set(['info', 'action', 'manual', 'check']);
const ACTIONS = new Set(['register-mcp', 'sync-policy']), CHECKS = new Set(['mcp-status', 'binary', 'secret-file', 'gh-auth', 'health', 'policy-synced']);
const TYPES = new Set(['mcp-http', 'mcp-stdio', 'cli', 'local-service']);

/** @returns {{ok:true, value:any} | {ok:false, errors:string[]}} */
export function validateConnector(c) {
  const errors = [], e = (s) => errors.push(s);
  const text = (v, label, max, optional = false) => { if (v === undefined || v === '') { if (!optional) e(`${label} is required.`); return; } if (typeof v !== 'string' || v.length > max || /[<>\u0000]/.test(v)) e(`${label}: plain text, at most ${max} characters.`); };
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return { ok: false, errors: ['A connector must be an object.'] };
  for (const k of Object.keys(c)) if (!KEYS.has(k)) e(`Unknown field "${k}".`);
  if (c.schemaVersion !== 1) e('schemaVersion must be 1.');
  if (typeof c.id !== 'string' || !ID.test(c.id)) e('id: lowercase letters, numbers and dashes.');
  text(c.name, 'name', 60); text(c.summary, 'summary', 240);
  if (!CATEGORIES.includes(c.category)) e(`category must be one of ${CATEGORIES.join(', ')}.`);
  if (c.website !== undefined && !(typeof c.website === 'string' && HTTPS.test(c.website))) e('website must be an https address.');
  if (c.roles !== undefined && !(Array.isArray(c.roles) && c.roles.length <= 20 && c.roles.every((r) => typeof r === 'string' && /^[a-z][a-z0-9-]{1,38}$/.test(r)))) e('roles must be a list of agent keys (lowercase letters, numbers, dashes).');

  const k = c.connect;
  if (!k || typeof k !== 'object' || !TYPES.has(k.type)) e(`connect.type must be one of ${[...TYPES].join(', ')}.`);
  else {
    const allowed = { 'mcp-http': ['type', 'server', 'url'], 'mcp-stdio': ['type', 'server', 'package', 'args', 'env'], cli: ['type', 'binary', 'authCheck'], 'local-service': ['type', 'health'] }[k.type];
    for (const key of Object.keys(k)) if (!allowed.includes(key)) e(`Unknown field "connect.${key}" for ${k.type}.`);
    if (k.type.startsWith('mcp-') && !(typeof k.server === 'string' && SERVER.test(k.server))) e('connect.server: lowercase letters, numbers, dashes or underscores.');
    if (k.type === 'mcp-http' && !(typeof k.url === 'string' && HTTPS.test(k.url))) e('connect.url must be an https address without a query string or credentials.');
    if (k.type === 'mcp-stdio') {
      if (!(typeof k.package === 'string' && PINNED.test(k.package))) e('connect.package must be an npm package pinned to an exact version (name@1.2.3), so a new release cannot change what runs.');
      if (k.args !== undefined && !(Array.isArray(k.args) && k.args.length <= 6 && k.args.every((a) => typeof a === 'string' && /^--?[a-z][a-z0-9-]*$/.test(a)))) e('connect.args: up to 6 flags such as --headless.');
      if (k.env !== undefined && !(Array.isArray(k.env) && k.env.length <= 6 && k.env.every((n) => typeof n === 'string' && ENVNAME.test(n)))) e('connect.env: names of environment variables (values are never stored here).');
    }
    if (k.type === 'cli') { if (!(typeof k.binary === 'string' && BINARY.test(k.binary))) e('connect.binary: a plain program name.'); if (k.authCheck !== undefined && k.authCheck !== 'gh-auth') e('connect.authCheck: only "gh-auth" exists.'); }
    if (k.type === 'local-service' && !(typeof k.health === 'string' && HEALTH.test(k.health))) e('connect.health must be a local address (127.0.0.1 or localhost).');
  }
  if (c.policy !== undefined) {
    if (!c.policy || typeof c.policy !== 'object' || Array.isArray(c.policy) || Object.keys(c.policy).length > 60) e('policy must be a map of tool name to allow, ask or off.');
    else for (const [t, v] of Object.entries(c.policy)) { if (!/^(\*|[A-Za-z0-9_.-]{1,60})$/.test(t)) e(`policy: "${t.slice(0, 30)}" is not a tool name.`); if (!POLICY.has(v)) e(`policy.${t.slice(0, 30)} must be allow, ask or off.`); }
    if (c.policy && k && !String(k.type).startsWith('mcp-')) e('policy applies to MCP tools only.');
  }
  if (c.steps !== undefined) {
    if (!Array.isArray(c.steps) || c.steps.length > 12) e('steps: at most 12.');
    else c.steps.forEach((s, i) => {
      const w = `step ${i + 1}`;
      if (!s || typeof s !== 'object' || !STEP_KINDS.has(s.kind)) return e(`${w}: kind must be info, action, manual or check.`);
      const ok = { info: ['kind', 'id', 'title', 'text'], manual: ['kind', 'id', 'title', 'text', 'link', 'confirm'], action: ['kind', 'id', 'title', 'text', 'do'], check: ['kind', 'id', 'title', 'text', 'check', 'secret'] }[s.kind];
      for (const key of Object.keys(s)) if (!ok.includes(key)) e(`${w}: unknown field "${key}" (a step cannot carry commands).`);
      if (typeof s.id !== 'string' || !ID.test(s.id)) e(`${w}: id is required (lowercase letters, numbers, dashes).`);
      text(s.title, `${w} title`, 80); text(s.text, `${w} text`, 600, true);
      if (s.link !== undefined && !(typeof s.link === 'string' && HTTPS.test(s.link))) e(`${w}: link must be an https address.`);
      if (s.kind === 'action' && !ACTIONS.has(s.do)) e(`${w}: do must be one of ${[...ACTIONS].join(', ')}.`);
      if (s.kind === 'check' && !CHECKS.has(s.check)) e(`${w}: check must be one of ${[...CHECKS].join(', ')}.`);
      if (s.secret !== undefined && !(s.check === 'secret-file' && typeof s.secret === 'string' && ENVNAME.test(s.secret))) e(`${w}: secret is only for secret-file checks and must be an UPPER_CASE name.`);
      if (s.kind === 'check' && s.check === 'secret-file' && !s.secret) e(`${w}: a secret-file check needs "secret".`);
    });
  }
  if (scanText(JSON.stringify(c).replace(/","/g, '\n')).length) e('Something looks like a password or key. Connector files never contain secrets.');
  return errors.length ? { ok: false, errors } : { ok: true, value: c };
}

/** The standard walkthrough for a connector type, used when the file has no steps of its own. */
export function defaultSteps(c) {
  const t = c.connect.type, nm = c.name;
  if (t === 'mcp-http') return [
    { kind: 'action', id: 'register', title: `Add ${nm} to your agents' toolbox`, do: 'register-mcp', text: `Registers ${nm} with Claude Code on this computer. Nothing is sent to ${nm} yet.` },
    { kind: 'manual', id: 'sign-in', title: `Sign in to ${nm}`, text: `You do this yourself, so your password never passes through this app. In Ubuntu run "claude", type /mcp, choose "${c.connect.server}" and finish the sign-in in your browser.` },
    { kind: 'check', id: 'verify', title: 'Check the connection', check: 'mcp-status', text: `Confirms ${nm} answers and your sign-in worked.` },
    { kind: 'action', id: 'permissions', title: 'Apply your permissions', do: 'sync-policy', text: 'Agents must ask you before using any tool that is not marked allowed. You can see every call on this screen.' },
  ];
  if (t === 'mcp-stdio') return [
    { kind: 'info', id: 'about', title: 'This runs a program from npm', text: `${nm} runs ${c.connect.package} on this computer when an agent uses it. The version is fixed, so a new release cannot change what runs.` },
    ...(c.connect.env?.length ? c.connect.env.map((n) => ({ kind: 'check', id: `key-${n.toLowerCase().replace(/_/g, '-')}`, title: `Put your ${n} in place`, check: 'secret-file', secret: n, text: `Create the file ~/.agent-stack/secrets/${n} in Ubuntu and paste the value into it yourself. This app only checks that the file exists and never reads it.` })) : []),
    { kind: 'action', id: 'register', title: `Add ${nm} to your agents' toolbox`, do: 'register-mcp', text: 'You will be asked to confirm that this downloads and runs code from npm.' },
    { kind: 'check', id: 'verify', title: 'Check the connection', check: 'mcp-status' },
    { kind: 'action', id: 'permissions', title: 'Apply your permissions', do: 'sync-policy', text: 'Agents must ask you before using any tool that is not marked allowed.' },
  ];
  if (t === 'cli') return [
    { kind: 'check', id: 'installed', title: `${c.connect.binary} is installed`, check: 'binary', text: `Looks for "${c.connect.binary}" in Ubuntu.` },
    ...(c.connect.authCheck ? [{ kind: 'check', id: 'signed-in', title: 'Signed in', check: 'gh-auth', text: 'In Ubuntu run "gh auth login" and follow the prompts. You type nothing secret into this app.' }] : []),
  ];
  return [{ kind: 'check', id: 'running', title: `${nm} is running`, check: 'health', text: 'Start it from the Services screen if it is stopped.' }];
}

export function loadConnectors(repo) {
  const dir = join(repo, 'connectors'), out = [], problems = [];
  if (!existsSync(dir)) return { connectors: out, problems };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const v = validateConnector(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      if (!v.ok) problems.push({ file: f, errors: v.errors }); else if (v.value.id !== f.slice(0, -5)) problems.push({ file: f, errors: ['id must match the file name.'] }); else out.push({ ...v.value, steps: v.value.steps ?? defaultSteps(v.value) });
    } catch (err) { problems.push({ file: f, errors: [`not valid JSON: ${err.message}`.slice(0, 120)] }); }
  }
  return { connectors: out, problems };
}
