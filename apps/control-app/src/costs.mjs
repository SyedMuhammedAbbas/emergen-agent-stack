// Spend and activity from Paperclip's runs. Pure calculations plus a small persistent cache of runs, so a month's history
// survives if Paperclip ever trims its run list (⚠️ its list endpoint documents no paging; only 7 runs existed when written).
// The dollar figure is each run's usageJson.costUsd: what the run would cost at API prices. Subscription runs are
// "covered" (billingType subscription_included); only the rest is billed. Paperclip's own spend summary shows $0 for the former.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const VERSION = 1, round2 = (n) => Math.round(n * 100) / 100;

export function loadCache(file) {
  try { if (existsSync(file)) { const j = JSON.parse(readFileSync(file, 'utf8')); if (j.version === VERSION && j.runs) return j; } } catch { /* a bad cache is rebuilt from Paperclip */ }
  return { version: VERSION, runs: {}, titles: {} };
}
export function saveCache(file, cache) {
  try { mkdirSync(dirname(file), { recursive: true }); const tmp = file + '.tmp'; writeFileSync(tmp, JSON.stringify(cache)); renameSync(tmp, file); return true; } catch { return false; }
}

/** Fold fetched runs into the cache (by id). A run Paperclip no longer lists stays counted. */
export function mergeRuns(cache, runs) {
  for (const r of runs) {
    const u = r.usageJson ?? {};
    cache.runs[r.id] = { id: r.id, agentId: r.agentId, status: r.status, at: r.finishedAt ?? r.startedAt ?? r.createdAt, createdAt: r.createdAt,
      usd: Number(u.costUsd) || 0, billing: u.billingType === 'subscription_included' ? 'subscription' : (u.billingType ? 'api' : (u.costUsd ? 'api' : 'none')), model: u.model ?? null,
      tokensIn: u.inputTokens ?? 0, tokensOut: u.outputTokens ?? 0, tokensCached: u.cachedInputTokens ?? 0, wake: r.contextSnapshot?.wakeReason ?? null };
  }
  return cache;
}

/**
 * @param {{ runs: Record<string, any> }} cache
 * @param {Map<string, {name:string}>} agentsById
 * @param {Date} now
 * @param {{ budgetUsd:number, alertAt:number }} budget
 */
export function buildCost(cache, agentsById, now, { budgetUsd, alertAt }) {
  const y = now.getFullYear(), m = now.getMonth(), today = now.getDate(), daysInMonth = new Date(y, m + 1, 0).getDate();
  const days = Array.from({ length: today }, (_, i) => ({ day: i + 1, apiUsd: 0, subscriptionUsd: 0, runs: 0 }));
  const agents = new Map(), models = new Map(); let api = 0, sub = 0, runs = 0; const tok = { in: 0, out: 0, cached: 0 };
  for (const r of Object.values(cache.runs)) {
    const t = new Date(r.at); if (Number.isNaN(+t) || t.getFullYear() !== y || t.getMonth() !== m) continue;
    runs++; const d = days[t.getDate() - 1]; if (d) d.runs++;
    const a = agents.get(r.agentId) ?? { id: r.agentId, name: agentsById.get(r.agentId)?.name ?? 'Unknown agent', usd: 0, apiUsd: 0, subscriptionUsd: 0, runs: 0 };
    a.runs++; agents.set(r.agentId, a);
    if (r.usd) {
      const into = r.billing === 'subscription' ? 'subscriptionUsd' : 'apiUsd';
      if (into === 'subscriptionUsd') sub += r.usd; else api += r.usd;
      if (d) d[into] += r.usd; a[into] += r.usd; a.usd += r.usd;
      const mo = models.get(r.model ?? 'unknown') ?? { model: r.model ?? 'unknown', usd: 0, runs: 0 }; mo.usd += r.usd; mo.runs++; models.set(mo.model, mo);
    }
    tok.in += r.tokensIn; tok.out += r.tokensOut; tok.cached += r.tokensCached;
  }
  const total = api + sub, pct = Math.round((total / budgetUsd) * 1000) / 10;
  const level = pct >= 100 ? 'fail' : pct >= alertAt * 100 ? 'warn' : 'ok';
  const fix = (o) => ({ ...o, usd: round2(o.usd ?? 0), apiUsd: round2(o.apiUsd ?? 0), subscriptionUsd: round2(o.subscriptionUsd ?? 0) });
  return {
    month: { label: now.toLocaleString('en', { month: 'long', year: 'numeric' }), day: today, daysInMonth, runs },
    totalUsd: round2(total), apiUsd: round2(api), subscriptionUsd: round2(sub),
    budget: { usd: budgetUsd, alertAt, pct: Math.min(pct, 999), level },
    projectedUsd: today < 3 ? null : Math.round((total / today) * daysInMonth),
    days: days.map((d) => ({ ...d, apiUsd: round2(d.apiUsd), subscriptionUsd: round2(d.subscriptionUsd) })),
    byAgent: [...agents.values()].map(fix).sort((p, q) => q.usd - p.usd || q.runs - p.runs),
    byModel: [...models.values()].map(fix).sort((p, q) => q.usd - p.usd),
    tokens: tok,
  };
}

/** Newest first: runs (with the task title when known) and approvals. */
export function buildActivity(cache, agentsById, approvals = [], limit = 40) {
  const items = Object.values(cache.runs).map((r) => ({ kind: 'run', id: r.id, agentId: r.agentId, agent: agentsById.get(r.agentId)?.name ?? 'Unknown agent', status: r.status, at: r.at,
    usd: r.usd ? round2(r.usd) : null, billing: r.billing, title: cache.titles[r.id] ?? null, wake: r.wake }));
  for (const a of approvals) items.push({ kind: 'approval', id: a.id, status: a.status ?? 'pending', at: a.updatedAt ?? a.createdAt, title: a.title ?? a.type ?? 'Approval', agent: agentsById.get(a.requestedByAgentId)?.name ?? null });
  return items.filter((i) => i.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}
