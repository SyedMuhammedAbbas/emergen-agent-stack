// The Tools screen: which tools (MCP integrations) are connected, what policy each one has, and what they have been doing.
// Reads the owner's policy file, active grants and the activity log written by the MCP hook (wsl/hooks/mcp-policy.mjs).
// Metadata only: the log never contains argument values or results, so neither does this view.
import { real } from './probes.mjs';

const DIR = '$HOME/.agent-stack';
export const CMD = `cat ${DIR}/integrations.json 2>/dev/null; echo; echo '---'; cat ${DIR}/grants.json 2>/dev/null; echo; echo '---'; tail -n 1500 ${DIR}/activity/tools.jsonl 2>/dev/null`;
const DAY = 24 * 3600 * 1000;

const json = (s) => { try { return JSON.parse(s.trim()); } catch { return null; } };

/** @param {string} stdout output of CMD  @param {Record<string,string>} agentNames agent id -> name */
export function parseTools(stdout, agentNames = {}, now = Date.now()) {
  const [pol, gr, log = ''] = String(stdout).split(/^---$/m);
  const policy = json(pol ?? ''), grants = (json(gr ?? '')?.grants ?? []).filter((g) => Date.parse(g.until) > now);
  const events = log.split('\n').map((l) => json(l)).filter((e) => e && e.at && e.tool);
  const day = events.filter((e) => now - Date.parse(e.at) < DAY);
  const by = new Map();
  const slot = (server) => { if (!by.has(server)) by.set(server, { calls: 0, blocked: 0, errors: 0, lastAt: null, lastTool: null, tools: new Set() }); return by.get(server); };
  for (const e of day) {
    const s = slot(e.server ?? 'unknown');
    if (e.t === 'call') { s.calls++; if (e.decision === 'blocked' || e.decision === 'off') s.blocked++; s.tools.add(e.name); } else if (e.t === 'result' && e.ok === false) s.errors++;
    if (!s.lastAt || e.at > s.lastAt) { s.lastAt = e.at; s.lastTool = e.name; }
  }
  const listed = Object.entries(policy?.integrations ?? {}).map(([server, v]) => {
    const tp = v.toolPolicy ?? {}, s = by.get(server) ?? { calls: 0, blocked: 0, errors: 0, lastAt: null, lastTool: null, tools: new Set() };
    return { server, id: v.id ?? server, defaultPolicy: tp['*'] ?? 'ask', policy: Object.entries(tp).filter(([k]) => k !== '*').map(([tool, action]) => ({ tool, action })),
      calls24h: s.calls, blocked24h: s.blocked, errors24h: s.errors, lastAt: s.lastAt, lastTool: s.lastTool, toolsUsed: [...s.tools].sort() };
  });
  const known = new Set(listed.map((l) => l.server));
  const unlisted = [...by.entries()].filter(([server]) => !known.has(server)).map(([server, s]) => ({ server, calls24h: s.calls, blocked24h: s.blocked, lastAt: s.lastAt, lastTool: s.lastTool }));
  const feed = [...events].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40).map((e) => ({ at: e.at, kind: e.t, server: e.server, name: e.name, decision: e.decision ?? null, ok: e.ok ?? null,
    agent: e.agentId ? (agentNames[e.agentId] ?? `agent ${String(e.agentId).slice(0, 8)}`) : null, argKeys: e.argKeys ?? [] }));
  return { hasPolicy: Boolean(policy), integrations: listed, unlisted, grants: grants.map((g) => ({ tool: g.tool, until: g.until })), feed, last24h: { calls: day.filter((e) => e.t === 'call').length, blocked: day.filter((e) => e.t === 'call' && (e.decision === 'blocked' || e.decision === 'off')).length, errors: day.filter((e) => e.t === 'result' && e.ok === false).length },
    logging: { hasLog: events.length > 0, lastEventAt: events.reduce((m, e) => (e.at > m ? e.at : m), '') || null } };
}

export async function readTools(settings, { exec = real.exec, agentNames = {} } = {}) {
  const out = await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', CMD], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  return parseTools(out.stdout, agentNames);
}
