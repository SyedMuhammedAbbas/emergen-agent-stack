// The Team screen's data: Paperclip's agents joined with the reconciler's plan (`stack plan --json`, run inside WSL).
// Read-only: it never applies anything; for each state it tells you the exact command that would.
import { real } from './probes.mjs';
import { toWslPath } from './doctor.mjs';

export const LABEL = { name: 'Name', role: 'Role', title: 'Title', icon: 'Icon', budgetMonthlyCents: 'Budget', reportsTo: 'Reports to', model: 'Model', env: 'Router settings', command: 'Command', timeoutSec: 'Timeout',
  heartbeat: 'Schedule', skills: 'Skills', instructions: 'Instructions' };

/** Changed lines only (LCS based). Big inputs fall back to a coarse view so a huge file can never stall a refresh. */
export function lineDiff(from = '', to = '', max = 12) {
  const A = String(from).split('\n'), B = String(to).split('\n');
  if (A.length * B.length > 160000) return { lines: [{ t: '-', s: `(${A.length} lines)` }, { t: '+', s: `(${B.length} lines)` }], more: 0 };
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { i++; j++; }
    else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) out.push({ t: '-', s: A[i++] });   // on a tie, removals come before additions
    else out.push({ t: '+', s: B[j++] });
  }
  return { lines: out.slice(0, max * 2), more: Math.max(0, out.length - max * 2) };
}

const short = (v) => (v === null || v === undefined ? 'none' : typeof v === 'string' ? (v.length > 60 ? `${v.slice(0, 57)}…` : v) : JSON.stringify(v).slice(0, 80));
function describe(f) {
  const base = { field: f.field, label: LABEL[f.field] ?? f.field, op: f.op };
  if (f.field === 'instructions') return { ...base, diff: lineDiff(f.from, f.to), summary: 'The instruction text differs.' };
  if (f.field === 'skills') { const a = new Set(f.from ?? []), b = new Set(f.to ?? []); const add = [...b].filter((x) => !a.has(x)), rm = [...a].filter((x) => !b.has(x));
    const parts = [add.length && `The template adds ${add.join(', ')}`, rm.length && `the template removes ${rm.join(', ')}`].filter(Boolean);
    return { ...base, summary: parts.length ? `${parts.join('; ')}.` : 'The skill list differs.' }; }
  if (f.field === 'budgetMonthlyCents') return { ...base, summary: `Paperclip has $${((f.from ?? 0) / 100).toFixed(2)}, the template says $${((f.to ?? 0) / 100).toFixed(2)}` };
  return { ...base, summary: `Paperclip has ${short(f.from)}, the template says ${short(f.to)}` };
}

const RANK = { decision: 0, unmanaged: 1, update: 2, edit: 3, unknown: 4, 'in-step': 5 };

/**
 * @param {any[]} agents raw Paperclip agents  @param {{agents:any[], counts:any}|null} plan  @param {{ ranAt?:string, error?:string }} [meta]
 */
export function buildTeam(agents, plan, meta = {}) {
  const byId = new Map(agents.map((a) => [a.id, a])), planById = new Map((plan?.agents ?? []).filter((p) => p.id).map((p) => [p.id, p]));
  const list = agents.map((a) => {
    const p = planById.get(a.id), managed = Boolean(a.metadata?.stack), ac = a.adapterConfig ?? {};
    const diffs = (p?.fields ?? []).filter((f) => ['update', 'keep-live', 'conflict', 'adopt-diff'].includes(f.op));
    let state = !plan ? 'unknown' : !managed ? 'unmanaged' : p?.action === 'needs-decision' ? 'decision' : p?.action === 'update' ? 'update' : diffs.some((f) => f.op === 'keep-live') ? 'edit' : p ? 'in-step' : 'unknown';
    const key = p?.key ?? a.metadata?.stack?.key;
    const only = key ? `.\\stack.cmd apply --yes --only ${key}` : null;
    const command = state === 'update' ? only : state === 'edit' ? `${only} --take-template` : state === 'decision' ? `${only} --take-template   (or --keep-live to keep what is in Paperclip)` : null;
    return { id: a.id, key: key ?? null, name: a.name, title: a.title ?? '', role: a.role, status: a.status, state,
      model: ac.model ?? (Object.keys(ac.env ?? {}).includes('ANTHROPIC_BASE_URL') ? 'jev-router' : 'default'), budgetUsd: Math.round((a.budgetMonthlyCents ?? 0)) / 100,
      reportsTo: a.reportsTo ? byId.get(a.reportsTo)?.name ?? null : null, changes: diffs.map(describe), command,
      note: state === 'unmanaged' ? (key ? 'Not managed by the reconciler yet.' : 'Not managed by the reconciler.') : null };
  }).sort((x, y) => RANK[x.state] - RANK[y.state] || x.name.localeCompare(y.name));
  const counts = list.reduce((c, a) => ({ ...c, [a.state]: (c[a.state] ?? 0) + 1 }), {});
  return { available: Boolean(plan), ranAt: meta.ranAt ?? null, error: meta.error ?? null, counts, agents: list };
}

/** `stack plan --json` inside WSL. stdout is the JSON; warnings go to stderr and are ignored. */
export async function runStackPlan(settings, { exec = real.exec } = {}) {
  if (!settings.repo) throw new Error('repo path unknown');
  const cmd = `source ~/.nvm/nvm.sh >/dev/null 2>&1; cd "${toWslPath(settings.repo)}" && node apps/cli/stack.mjs plan --json 2>/dev/null`;
  const { stdout } = await exec('wsl.exe', ['-d', settings.distro, '--', 'bash', '-c', cmd], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
  const j = JSON.parse(stdout);
  if (!Array.isArray(j.agents)) throw new Error('unexpected plan output');
  return j;
}
