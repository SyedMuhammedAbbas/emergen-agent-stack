// What the Home screen needs from Paperclip: the crew (agent moods), runs, spend this month, approvals waiting.
// Read-only. Shapes verified in spikes/m2-step0.mjs; the cost figure is summed from each run's usageJson.costUsd
// (value at API prices) because Paperclip's own summary shows $0 for subscription runs.
import { real } from './probes.mjs';

const WORKING = new Set(['running', 'active', 'working']);
/** Same mapping as the Claude mod (mods/paperclip-crew/hooks/crew.ts) so both show the same thing. */
export const moodOf = (status) => {
  const s = String(status ?? '').toLowerCase();
  return WORKING.has(s) ? 'working' : s === 'error' ? 'error' : s === 'paused' ? 'paused' : 'idle';
};

/** @returns {{ monthUsd:number, apiUsd:number, subscriptionUsd:number, runsThisMonth:number, runsToday:number }} */
export function summariseRuns(runs, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  let api = 0, sub = 0, month = 0, today = 0;
  for (const r of runs) {
    const t = new Date(r.finishedAt ?? r.createdAt);
    if (Number.isNaN(+t) || t.getFullYear() !== y || t.getMonth() !== m) continue;
    month++; if (t.getDate() === d) today++;
    const cost = Number(r.usageJson?.costUsd) || 0;
    if (r.usageJson?.billingType === 'subscription_included') sub += cost; else api += cost;
  }
  return { monthUsd: round2(api + sub), apiUsd: round2(api), subscriptionUsd: round2(sub), runsThisMonth: month, runsToday: today };
}
const round2 = (n) => Math.round(n * 100) / 100;

/** Straight-line projection to the end of the month; null in the first two days (too little data). */
export function projectMonth(monthUsd, now = new Date()) {
  const day = now.getDate(); if (day < 3) return null;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((monthUsd / day) * days);
}

export function recentRuns(runs, agentsById, n = 6) {
  return [...runs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, n).map((r) => ({
    id: r.id, agent: agentsById.get(r.agentId)?.name ?? 'Unknown agent', status: r.status, at: r.finishedAt ?? r.startedAt ?? r.createdAt,
    costUsd: r.usageJson?.costUsd ? round2(Number(r.usageJson.costUsd)) : null, subscription: r.usageJson?.billingType === 'subscription_included' }));
}

/**
 * @param {string} origin e.g. http://127.0.0.1:3100
 * @param {{ fetch?: Function, now?: Date, companyName?: string }} [io]
 */
export async function readPaperclip(origin, { fetch = real.fetch, now = new Date(), companyName } = {}) {
  const get = async (p) => { const r = await fetch(`${origin}/api${p}`, { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw new Error(`${p} -> ${r.status}`); return r.json(); };
  try {
    const companies = await get('/companies');
    const company = companies.find((c) => c.name === companyName) ?? companies[0];
    if (!company) return { up: true, company: null };
    const base = `/companies/${company.id}`;
    const [agents, runs, approvals] = await Promise.all([get(`${base}/agents`), get(`${base}/heartbeat-runs`), get(`${base}/approvals?status=pending`).catch(() => [])]);
    const byId = new Map(agents.map((a) => [a.id, a]));
    const crew = agents.map((a) => ({ id: a.id, name: a.name, title: a.title ?? '', mood: moodOf(a.status), status: a.status, plan: a.metadata?.stack ? 'managed' : 'unmanaged' }))
      .sort((p, q) => p.name.localeCompare(q.name));
    return { up: true, company: { id: company.id, name: company.name }, crew, runs: summariseRuns(runs, now), recent: recentRuns(runs, byId), approvalsPending: Array.isArray(approvals) ? approvals.length : 0 };
  } catch (e) { return { up: false, error: String(e.message).slice(0, 120) }; }
}
