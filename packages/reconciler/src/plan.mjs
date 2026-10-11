// Three-way planning, per field: desired (the template) vs live (Paperclip now) vs applied (what we last wrote).
// "applied" lives in the agent's Paperclip metadata as { key, tpl, desired:{field:hash}, live:{field:hash} }.
//
//   live changed since we wrote? | template changed? | result
//   no                           | no               | noop
//   no                           | yes              | update            (the template moved)
//   yes                          | no               | keep-live         (a person edited it)
//   yes                          | yes              | conflict          (needs a decision; nothing is written)
//   never applied (adoption)     |                  | record if equal, otherwise adopt-diff (needs a decision)
import { canonical, hash } from './canonical.mjs';
import { FIELDS } from './desired.mjs';

/** The live API redacts env values, so env is compared by key names only (see docs/architecture/13-m1-api-findings.md). */
export function equalsLive(f, d, l) {
  if (f === 'env') return canonical(Object.keys(d.env).sort()) === canonical(l.env);
  return canonical(d[f]) === canonical(l[f]);
}
export const desiredHash = (f, d) => hash(d[f]);   // env: full map, so a changed value is a template change
export const liveHash = (f, l) => hash(l[f]);      // env: sorted key names

/**
 * @param {import('./desired.mjs').DesiredAgent} d
 * @param {(Record<string,any> & { stack?: any }) | null} live  normalised live projection (env = sorted key names)
 * @param {{ resolve?: 'ask'|'keep-live'|'take-template' }} [opts]
 */
export function planAgent(d, live, { resolve = 'ask', fields: FL = FIELDS } = {}) {
  if (!live) return { key: d.key, action: 'create', fields: [] };
  const applied = live.stack ?? null;
  const fields = [];
  for (const f of FL) {
    if (d[f] === undefined) continue;                    // not managed for this agent
    const dh = desiredHash(f, d), lh = liveHash(f, live);
    // env values can't be read back, so equal key names don't prove equal values: once applied, a changed
    // template value must be written even though live "looks the same". (At adoption we can only trust the keys.)
    const same = equalsLive(f, d, live) && !(f === 'env' && applied && applied.desired?.env !== dh);
    let op;
    if (!applied) op = same ? 'record' : 'adopt-diff';
    else {
      const aD = applied.desired?.[f], aL = applied.live?.[f];
      const tChanged = aD !== dh;
      const lChanged = aL === undefined ? !same : aL !== lh;
      if (same) op = aD === dh && aL === lh ? 'noop' : 'record';
      else if (!tChanged && !lChanged) op = 'noop';
      else if (tChanged && !lChanged) op = 'update';
      else if (!tChanged && lChanged) op = 'keep-live';
      else op = 'conflict';
    }
    let decided = false;
    if (op === 'adopt-diff' || op === 'conflict') {
      if (resolve === 'take-template') { op = 'update'; decided = true; }
      else if (resolve === 'keep-live') { op = 'keep-live'; decided = true; }
    }
    fields.push({ field: f, op, ...(decided && { decided }),
      ...(op !== 'noop' && op !== 'record' && { from: live[f], to: f === 'env' ? Object.keys(d.env).sort() : d[f] }) });
  }
  const ops = fields.map((x) => x.op);
  const action = ops.some((o) => o === 'adopt-diff' || o === 'conflict') ? 'needs-decision'
    : ops.includes('update') ? 'update' : ops.some((o) => o === 'record' || o === 'keep-live') ? 'record' : 'noop';
  return { key: d.key, id: live.id, action, fields };
}

/** Link each desired agent to its live Paperclip agent: by stored stack key, then saved id (ids.json), then name. */
export function matchLive(desired, liveAgents, ids = {}) {
  const byKey = new Map(), byId = new Map(), byName = new Map();
  for (const l of liveAgents) {
    if (l.stack?.key) byKey.set(l.stack.key, l);
    byId.set(l.id, l); if (!byName.has(l.name)) byName.set(l.name, l);
  }
  const used = new Set(), out = new Map();
  for (const d of desired) {
    const l = byKey.get(d.key) ?? (ids[d.key] && byId.get(ids[d.key])) ?? byName.get(d.name) ?? null;
    if (l && used.has(l.id)) throw new Error(`two template agents match the same Paperclip agent "${l.name}" (${l.id}); fix the keys`);
    if (l) used.add(l.id);
    out.set(d.key, l);
  }
  return out;
}

/** Managers before the people who report to them (needed to resolve reportsTo ids on create). */
export function orderByHierarchy(desired) {
  const byKey = new Map(desired.map((d) => [d.key, d])), done = new Set(), out = [];
  const visit = (d, trail = []) => {
    if (done.has(d.key)) return;
    if (trail.includes(d.key)) throw new Error(`reporting cycle: ${[...trail, d.key].join(' -> ')}`);
    if (d.reportsTo) { const m = byKey.get(d.reportsTo); if (!m) throw new Error(`"${d.key}" reports to unknown agent "${d.reportsTo}"`); visit(m, [...trail, d.key]); }
    done.add(d.key); out.push(d);
  };
  desired.forEach((d) => visit(d));
  return out;
}

/** @returns {{ agents: any[], counts: Record<string,number> }} */
export function planAll(desired, liveAgents, ids, opts) {
  const ordered = orderByHierarchy(desired), match = matchLive(ordered, liveAgents, ids);
  const agents = ordered.map((d) => planAgent(d, match.get(d.key), opts));
  const counts = {}; for (const a of agents) counts[a.action] = (counts[a.action] ?? 0) + 1;
  return { agents, counts };
}

/** The applied-state record to store after a successful apply, given the plan and the live projection read back. */
export function nextApplied(d, planAgentResult, liveAfter, prior, tpl, FL = FIELDS) {
  const desired = { ...(prior?.desired ?? {}) }, live = { ...(prior?.live ?? {}) };
  const opOf = Object.fromEntries((planAgentResult.fields ?? []).map((x) => [x.field, x.op]));
  for (const f of FL) {
    if (d[f] === undefined) continue;
    const op = planAgentResult.action === 'create' ? 'update' : opOf[f];
    if (op === 'update' || op === 'record' || op === 'noop') { desired[f] = desiredHash(f, d); live[f] = liveHash(f, liveAfter); }
    // keep-live changes nothing once we have a baseline: if the person reverts to what we wrote, the field is back in
    // step; if the template then moves, it is a conflict. Without a baseline (adoption) only the template hash is noted.
    else if (op === 'keep-live') { if (desired[f] === undefined) desired[f] = desiredHash(f, d); }
    // unresolved conflict / adopt-diff: leave whatever was recorded before
  }
  return { key: d.key, tpl, desired, live };
}
