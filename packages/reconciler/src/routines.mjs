// Routines (scheduled issues for an agent, e.g. the Timekeeper's end-of-day proposal) reconciled like agents:
// same per-field three-way plan, applied state kept in <state>/applied-routines.json (routines have no metadata field).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { planAgent, nextApplied, equalsLive } from './plan.mjs';
import { normaliseRoutine } from '../../adapter-paperclip/src/client.mjs';

export const ROUTINE_FIELDS = ['title', 'description', 'assignee', 'cron', 'timezone', 'enabled'];
const ROUTINE_GROUP = ['title', 'description', 'assignee'], TRIGGER_GROUP = ['cron', 'timezone', 'enabled'];

/** @returns {{ routines: any[], warnings: string[] }} routine definitions come from an agent's "routine" entry in department.json */
export function desiredRoutines(org, settings) {
  const routines = [], warnings = [];
  for (const a of org.agents.filter((x) => x.routine)) {
    const cron = settings.routineCrons?.[a.routine.cronEnv];
    if (!cron) { warnings.push(`routine for ${a.key}: ${a.routine.cronEnv} is empty in config.env, skipped`); continue; }
    routines.push({ key: a.key, title: a.routine.title, description: a.routine.description ?? '', assignee: a.key, cron, timezone: settings.timezone || 'UTC', enabled: true });
  }
  return { routines, warnings };
}

export const store = (state) => {
  const f = join(state, 'applied-routines.json');
  return { read: () => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}), write: (o) => writeFileSync(f, JSON.stringify(o, null, 2)) };
};

/** Find each routine's live twin: by saved id (ids.json), then by title + assignee. */
export async function readRoutines(pc, cid, ctx, ids, desired, applied) {
  const all = await pc.routines(cid), out = new Map();
  for (const d of desired) {
    const savedId = applied[d.key]?.id ?? ids.routines?.[d.key]?.id;
    let r = savedId ? await pc.routine(savedId) : null;
    if (!r) { const m = all.find((x) => x.title === d.title && ctx.idToKey(x.assigneeAgentId) === d.assignee); r = m ? await pc.routine(m.id) : null; }
    const live = r ? normaliseRoutine(r, ctx.idToKey) : null;
    if (live) live.stack = applied[d.key] ?? null;
    out.set(d.key, live);
  }
  return out;
}

export function planRoutines(desired, liveMap, opts = {}) {
  return desired.map((d) => planAgent(d, liveMap.get(d.key), { ...opts, fields: ROUTINE_FIELDS }));
}

export async function applyRoutines({ pc, cid, desired, liveMap, plan, agentId, ctx, journal, st, tpl, log = () => {} }) {
  const applied = st.read(), res = { created: [], wrote: [], recorded: [], skipped: [] };
  const byKey = Object.fromEntries(desired.map((d) => [d.key, d]));
  const verify = async (d, id, fields) => {
    const after = normaliseRoutine(await pc.routine(id), ctx.idToKey);
    for (const f of fields) if (!equalsLive(f, d, after)) throw new Error(`routine ${d.key}.${f}: after writing, Paperclip reports a different value`);
    return after;
  };
  for (const p of plan) {
    const d = byKey[p.key], l = liveMap.get(p.key);
    if (p.action === 'noop') continue;
    if (p.action === 'needs-decision') { res.skipped.push(p.key); log(`  routine ${p.key}: needs a decision (skipped)`); continue; }
    if (!agentId(d.assignee)) throw new Error(`routine ${d.key}: its agent "${d.assignee}" does not exist in Paperclip`);
    let id = l?.id;
    if (p.action === 'create') {
      journal.add({ t: 'rcreating', routine: d.key });
      const r = await pc.createRoutine(cid, { title: d.title, description: d.description, assigneeAgentId: agentId(d.assignee), priority: 'medium' });
      id = r.id; journal.add({ t: 'rcreated', routine: d.key, id });
      await pc.createTrigger(id, { kind: 'schedule', cronExpression: d.cron, timezone: d.timezone, enabled: d.enabled });
      const after = await verify(d, id, ROUTINE_FIELDS);
      journal.add({ t: 'rcommit', routine: d.key, prev: null });
      st.write({ ...st.read(), [d.key]: { ...nextApplied(d, p, after, null, tpl, ROUTINE_FIELDS), id, trigger: after.triggerId } });
      res.created.push(d.key); log(`  routine  created ${d.title}`); continue;
    }
    const up = p.fields.filter((x) => x.op === 'update').map((x) => x.field), has = (g) => g.filter((f) => up.includes(f));
    if (has(ROUTINE_GROUP).length) {
      journal.add({ t: 'rbefore', routine: d.key, id, group: 'routine', before: Object.fromEntries(has(ROUTINE_GROUP).map((f) => [f, l[f]])), assigneeId: l.assignee ? agentId(l.assignee) : null });
      const body = {}; for (const f of has(ROUTINE_GROUP)) body[f === 'assignee' ? 'assigneeAgentId' : f] = f === 'assignee' ? agentId(d.assignee) : d[f];
      await pc.patchRoutine(id, body);
    }
    if (has(TRIGGER_GROUP).length) {
      journal.add({ t: 'rbefore', routine: d.key, id, group: 'trigger', triggerId: l.triggerId, before: Object.fromEntries(has(TRIGGER_GROUP).map((f) => [f, l[f]])) });
      const body = {}; for (const f of has(TRIGGER_GROUP)) body[f === 'cron' ? 'cronExpression' : f] = d[f];
      if (l.triggerId) await pc.patchTrigger(l.triggerId, body);
      else await pc.createTrigger(id, { kind: 'schedule', cronExpression: d.cron, timezone: d.timezone, enabled: d.enabled });
    }
    const after = await verify(d, id, up);
    journal.add({ t: 'rcommit', routine: d.key, prev: applied[d.key] ?? null });
    st.write({ ...st.read(), [d.key]: { ...nextApplied(d, p, after, applied[d.key] ?? null, tpl, ROUTINE_FIELDS), id, trigger: after.triggerId } });
    if (up.length) { res.wrote.push({ key: d.key, fields: up }); log(`  routine  updated ${d.title}: ${up.join(', ')}`); } else res.recorded.push(d.key);
  }
  return res;
}

/** Journal entries of type rbefore / rcommit, newest first (rollback calls this). */
export async function rollbackRoutine(pc, s, st) {
  if (s.t === 'rbefore' && s.group === 'routine') {
    const body = {}; for (const [f, v] of Object.entries(s.before)) { if (f === 'assignee') body.assigneeAgentId = s.assigneeId; else body[f] = v; }
    await pc.patchRoutine(s.id, body);
  } else if (s.t === 'rbefore' && s.group === 'trigger') {
    const body = {}; for (const [f, v] of Object.entries(s.before)) body[f === 'cron' ? 'cronExpression' : f] = v;
    if (s.triggerId) await pc.patchTrigger(s.triggerId, body);
  } else if (s.t === 'rcommit') {
    const all = st.read(); if (s.prev) all[s.routine] = s.prev; else delete all[s.routine]; st.write(all);
  }
}
