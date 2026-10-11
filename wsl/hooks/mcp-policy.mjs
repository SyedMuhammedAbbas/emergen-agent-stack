// Claude Code PreToolUse hook: per-tool allow / ask / off for MCP tools (names like mcp__<server>__<tool>).
// The policy is the owner's file (~/.agent-stack/integrations.json). Nothing a server says about itself (its tool
// descriptions, annotations such as "readOnlyHint") is ever read here, so a server cannot talk its way to "allow".
//   allow  the call goes through
//   ask    refused unless the owner granted that exact tool for a limited time (~/.agent-stack/grants.json)
//   off    always refused
// Servers not listed are "ask". With no policy file at all the hook does nothing, so setups without integrations are unchanged.
// Needs only node. Fails closed: an unreadable call or policy file is refused for MCP tools, never allowed.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VALID = new Set(['allow', 'ask', 'off']);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_');

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
    if (g) return { action: 'allow', why: `granted until ${g.until}` };
  }
  return { action, why: integ ? undefined : 'this server is not in your integrations list' };
}

export const stateDir = () => process.env.AGENT_STACK_STATE ?? join(homedir(), '.agent-stack');

/** Returns null to allow, or the reason to refuse. Throws on input it cannot trust (the caller refuses). */
export function check(raw, dir = stateDir(), now = Date.now()) {
  const input = JSON.parse(raw);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('hook input is not an object');
  const name = input.tool_name;
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null;
  const pf = join(dir, 'integrations.json');
  if (!existsSync(pf)) return null;
  const policy = JSON.parse(readFileSync(pf, 'utf8'));
  let grants = []; const gf = join(dir, 'grants.json');
  try { if (existsSync(gf)) grants = JSON.parse(readFileSync(gf, 'utf8')).grants ?? []; } catch { grants = []; } // a broken grants file grants nothing
  const d = decide(policy, grants, name, now);
  if (d.action === 'allow') return null;
  return d.action === 'off' ? `${name} is switched off by the owner` : `${name} needs the owner's approval${d.why ? ` (${d.why})` : ''}`;
}

if (/mcp-policy\.mjs$/.test(process.argv[1] ?? '')) {
  try {
    const why = check(readFileSync(0, 'utf8'));
    if (why) { console.error(`Blocked by the integrations policy: ${why}. Do not retry or look for a way around it. Ask the board (Question for board) to approve this tool, then stop work that depends on it.`); process.exit(2); }
  } catch (e) {
    console.error(`Blocked by the integrations policy: the policy could not be checked (${e.message}), so the call was refused.`);
    process.exit(2);
  }
}
