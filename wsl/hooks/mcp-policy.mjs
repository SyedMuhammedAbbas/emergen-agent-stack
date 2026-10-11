// Claude Code hook for MCP tools (names like mcp__<server>__<tool>), two jobs:
//  1. PreToolUse: per-tool allow / ask / off from the owner's policy (~/.agent-stack/integrations.json)
//       allow  the call goes through
//       ask    refused unless the owner granted that exact tool for a limited time (~/.agent-stack/grants.json)
//       off    always refused
//     Servers not listed are "ask". With no policy file the hook allows everything. Nothing a server says about itself
//     (descriptions, annotations such as "readOnlyHint") is ever read, so a server cannot talk its way to "allow".
//  2. Activity: every MCP call and its result is appended to ~/.agent-stack/activity/tools.jsonl so the owner can see what
//     each tool is doing. Metadata only: tool name, decision, who (agent / run / task when Paperclip provides them), the SIZE of
//     the arguments and their key names, and whether the result was an error. Argument values and results are never written.
// Needs only node. Fails closed on policy: an unreadable call or policy file is refused for MCP tools, never allowed.
// Logging can never block or break a call.
import { readFileSync, existsSync, appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VALID = new Set(['allow', 'ask', 'off']);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_');
const LOG_MAX = 5 * 1024 * 1024;

/** @returns {{ action:'allow'|'ask'|'off', why?:string }} */
export function decide(policy, grants, toolName, now = Date.now()) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(toolName));
  if (!m || policy == null) return { action: 'allow' };
  const server = norm(m[1]), tool = m[2];
  const integrations = policy.integrations && typeof policy.integrations === 'object' ? policy.integrations : {};
  const integ = Object.hasOwn(integrations, server) ? integrations[server] : null;
  const tp = integ?.toolPolicy && typeof integ.toolPolicy === 'object' ? integ.toolPolicy : {};
  const raw = Object.hasOwn(tp, tool) ? tp[tool] : Object.hasOwn(tp, '*') ? tp['*'] : 'ask';
  const action = VALID.has(raw) ? raw : 'ask'; // anything unrecognised is "ask", never "allow"
  if (action === 'ask') {
    const g = Array.isArray(grants) ? grants.find((x) => x && x.tool === toolName && Date.parse(x.until) > now) : null;
    if (g) return { action: 'allow', why: `granted until ${g.until}`, granted: true };
  }
  return { action, why: integ ? undefined : 'this server is not in your integrations list' };
}

export const stateDir = () => process.env.AGENT_STACK_STATE ?? join(homedir(), '.agent-stack');

/** Full evaluation of a PreToolUse call. Returns null when the input is not an MCP call. Throws on input it cannot trust. */
export function inspect(raw, dir = stateDir(), now = Date.now()) {
  const input = JSON.parse(raw);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('hook input is not an object');
  const name = input.tool_name;
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null;
  const pf = join(dir, 'integrations.json');
  if (!existsSync(pf)) return { input, name, decision: { action: 'allow', why: 'no policy file' } };
  const policy = JSON.parse(readFileSync(pf, 'utf8'));
  let grants = []; const gf = join(dir, 'grants.json');
  try { if (existsSync(gf)) grants = JSON.parse(readFileSync(gf, 'utf8')).grants ?? []; } catch { grants = []; } // a broken grants file grants nothing
  return { input, name, decision: decide(policy, grants, name, now) };
}

/** null to allow, or the reason to refuse (the same contract as before; the tests rely on it). */
export function check(raw, dir = stateDir(), now = Date.now()) {
  const r = inspect(raw, dir, now); if (!r) return null;
  const { name, decision: d } = r;
  if (d.action === 'allow') return null;
  return d.action === 'off' ? `${name} is switched off by the owner` : `${name} needs the owner's approval${d.why ? ` (${d.why})` : ''}`;
}

/** What goes in the activity log for one event. Never contains argument values or result content. */
export function eventFor(input, decision, env = process.env, now = Date.now()) {
  const name = String(input.tool_name ?? ''), m = /^mcp__(.+?)__(.+)$/.exec(name);
  const post = input.hook_event_name === 'PostToolUse';
  const args = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const ev = { at: new Date(now).toISOString(), t: post ? 'result' : 'call', tool: name, server: m ? norm(m[1]) : null, name: m ? m[2] : name,
    agentId: env.PAPERCLIP_AGENT_ID ?? null, runId: env.PAPERCLIP_RUN_ID ?? null, taskId: env.PAPERCLIP_TASK_ID ?? null,
    session: typeof input.session_id === 'string' ? input.session_id.slice(0, 12) : null, cwd: typeof input.cwd === 'string' ? input.cwd.slice(-80) : null };
  if (post) { const resp = input.tool_response; ev.ok = !(resp && typeof resp === 'object' && (resp.is_error === true || resp.isError === true || resp.error)); }
  else { ev.decision = decision?.action === 'allow' ? (decision.granted ? 'granted' : 'allowed') : decision?.action === 'off' ? 'off' : 'blocked'; ev.argBytes = JSON.stringify(args).length; ev.argKeys = Object.keys(args).slice(0, 8).map((k) => k.slice(0, 30)); }
  return ev;
}

export function appendEvent(dir, ev) {
  try {
    const d = join(dir, 'activity'), f = join(d, 'tools.jsonl'); mkdirSync(d, { recursive: true });
    if (existsSync(f) && statSync(f).size > LOG_MAX) renameSync(f, join(d, 'tools.1.jsonl')); // keeps about the last 5 to 10 MB
    appendFileSync(f, JSON.stringify(ev) + '\n');
  } catch { /* logging must never break a call */ }
}

if (/mcp-policy\.mjs$/.test(process.argv[1] ?? '')) {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
    const first = JSON.parse(raw);
    if (first?.hook_event_name === 'PostToolUse') {
      if (typeof first.tool_name === 'string' && first.tool_name.startsWith('mcp__')) appendEvent(stateDir(), eventFor(first, null));
    } else {
      const r = inspect(raw);
      if (r) appendEvent(stateDir(), eventFor(r.input, r.decision));
      const why = check(raw);
      if (why) { console.error(`Blocked by the integrations policy: ${why}. Do not retry or look for a way around it. Ask the board (Question for board) to approve this tool, then stop work that depends on it.`); process.exit(2); }
    }
  } catch (e) {
    console.error(`Blocked by the integrations policy: the policy could not be checked (${e.message}), so the call was refused.`);
    process.exit(2);
  }
}
