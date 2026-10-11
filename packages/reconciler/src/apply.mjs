// Apply a plan to Paperclip, journalled and verified; roll back from the journal. Never deletes anything.
//
// Journal (one folder per apply): steps.jsonl, one JSON object per line, written BEFORE the change it describes:
//   { t:'before', agent, id, group, before }   the live value(s) about to be overwritten (env: key names only)
//   { t:'commit', agent, id, prevStack }       the applied-state record about to be replaced
//   { t:'created', agent, id }                 an agent we created (rollback leaves it in place)
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { equalsLive, nextApplied } from './plan.mjs';
import { rollbackRoutine } from './routines.mjs';

export class VerifyError extends Error {}

export class Journal {
  constructor(dir) { this.dir = dir; this.file = join(dir, 'steps.jsonl'); mkdirSync(dir, { recursive: true }); }
  add(rec) { appendFileSync(this.file, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n'); }
  static read(dir) {
    const f = join(dir, 'steps.jsonl');
    if (!existsSync(f)) throw new Error(`no journal at ${dir}`);
    return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
}

/** One apply at a time. A lock left by a dead process is taken over; a live one refuses. */
export function takeLock(path) {
  mkdirSync(join(path, '..'), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try { const fd = openSync(path, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd); return () => rmSync(path, { force: true }); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(readFileSync(path, 'utf8'));
      let alive = false; try { process.kill(pid, 0); alive = true; } catch { /* dead */ }
      if (alive) throw new Error(`another apply is running (pid ${pid}); lock ${path}`);
      rmSync(path, { force: true });
    }
  }
  throw new Error(`could not take the lock ${path}`);
}

const BASICS = ['name', 'role', 'title', 'icon', 'budgetMonthlyCents'];
const ADAPTER = ['model', 'env', 'command', 'timeoutSec'];

/**
 * @param {{ pc: import('../../adapter-paperclip/src/client.mjs').Paperclip, cid: string, desired: any[], live: Map<string,any>, plan: {agents:any[]},
 *   ctx: any, journal: Journal, tpl: string, log?: (s:string)=>void, dryRun?: boolean }} o
 */
export async function applyPlan({ pc, cid, desired, live, plan, ctx, journal, tpl, log = () => {} }) {
  const byKey = Object.fromEntries(desired.map((d) => [d.key, d]));
  const idOf = (k) => live.get(k)?.id ?? created.get(k);
  const created = new Map(), result = { wrote: [], created: [], skipped: [], recorded: [] };
  const verify = async (d, id, fields) => {
    const after = await pc.readOne(id, ctx);
    for (const f of fields) if (d[f] !== undefined && !equalsLive(f, d, after)) throw new VerifyError(`${d.key}.${f}: after writing, Paperclip reports a different value`);
    return after;
  };
  const skillKeys = (d) => {
    const keys = [], missing = [];
    for (const s of d.skills) (ctx.keyOf.get(s) ? keys.push(ctx.keyOf.get(s)) : missing.push(s));
    if (missing.length) log(`  ${d.key}: skills not imported yet, skipped: ${missing.join(', ')}`);
    return keys;
  };

  for (const p of plan.agents) {
    const d = byKey[p.key], l = live.get(p.key);
    if (p.action === 'noop') continue;
    if (p.action === 'needs-decision') { result.skipped.push(p.key); log(`  ${p.key}: needs a decision (skipped)`); continue; }

    if (p.action === 'create') {
      const body = {
        name: d.name, role: d.role, title: d.title, icon: d.icon, budgetMonthlyCents: d.budgetMonthlyCents,
        ...(d.reportsTo && { reportsTo: idOf(d.reportsTo) }),
        adapterType: 'claude_local',
        adapterConfig: { engine: 'cli', command: d.command, timeoutSec: d.timeoutSec, ...(d.model && { model: d.model }), env: d.env },
        ...(d.heartbeat && { runtimeConfig: { heartbeat: d.heartbeat } }),
        desiredSkills: skillKeys(d),
        instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': d.instructions } },
      };
      journal.add({ t: 'creating', agent: d.key });
      const c = await pc.createAgent(cid, body);
      created.set(d.key, c.id); ctx.remember(c.id, d.key); journal.add({ t: 'created', agent: d.key, id: c.id });
      const after = await verify(d, c.id, Object.keys(byKey[d.key]).filter((f) => f !== 'key' && f !== 'department'));
      journal.add({ t: 'commit', agent: d.key, id: c.id, prevStack: null });
      await pc.setMetadata(c.id, { stack: nextApplied(d, p, after, null, tpl) });
      result.created.push(d.key); log(`  created  ${d.name}`); continue;
    }

    const id = l.id, up = p.fields.filter((x) => x.op === 'update').map((x) => x.field), has = (g) => g.filter((f) => up.includes(f));
    const before = (group, b) => journal.add({ t: 'before', agent: d.key, id, group, before: b });
    // test seam: STACK_TEST_FAIL_AFTER=<agent key>:<group> throws right after that write (used by the failure-injection test)
    const injected = (group) => { if (process.env.STACK_TEST_FAIL_AFTER === d.key + ':' + group) throw new Error('injected failure after ' + group); };
    if (has(BASICS).length) { before('basics', Object.fromEntries(has(BASICS).map((f) => [f, l[f]])));
      await pc.patchAgent(id, Object.fromEntries(has(BASICS).map((f) => [f, d[f]]))); injected('basics'); }
    if (up.includes('reportsTo')) { before('reportsTo', { key: l.reportsTo, id: l.reportsTo ? idOf(l.reportsTo) : null });
      await pc.patchAgent(id, { reportsTo: d.reportsTo ? idOf(d.reportsTo) : null }); injected('reportsTo'); }
    if (has(ADAPTER).length) { before('adapter', { model: l.model, command: l.command, timeoutSec: l.timeoutSec, envKeys: l.env, fields: has(ADAPTER) });
      await pc.patchAgent(id, { adapterConfig: Object.fromEntries(has(ADAPTER).map((f) => [f, d[f]])) }); injected('adapter'); }
    if (up.includes('heartbeat')) { before('heartbeat', { heartbeat: l.heartbeat }); await pc.setHeartbeat(id, d.heartbeat); injected('heartbeat'); }
    if (up.includes('skills')) { before('skills', { slugs: l.skills }); await pc.syncSkills(id, 'replace', skillKeys(d)); injected('skills'); }
    if (up.includes('instructions')) { before('instructions', { text: l.instructions }); await pc.putInstructions(id, d.instructions); injected('instructions'); }

    const after = await verify(d, id, up);
    journal.add({ t: 'commit', agent: d.key, id, prevStack: l.stack });
    await pc.setMetadata(id, { stack: nextApplied(d, p, after, l.stack, tpl) });
    if (up.length) { result.wrote.push({ key: d.key, fields: up }); log(`  updated  ${d.name}: ${up.join(', ')}`); }
    else { result.recorded.push(d.key); log(`  recorded ${d.name}`); }
  }
  return { ...result, createdIds: Object.fromEntries(created) };
}

/** Undo one apply from its journal, newest change first. Created agents stay (M1 never deletes). Env values can't be restored. */
export async function rollback({ pc, cid, dir, ctx, st, log = () => {} }) {
  const steps = Journal.read(dir);
  const warnings = [];
  for (const s of steps.slice().reverse()) {
    if (s.t === 'rcreated') warnings.push('routine "' + s.routine + '" (' + s.id + ') was created by this apply and is left in place');
    if (s.t === 'rbefore' || s.t === 'rcommit') { await rollbackRoutine(pc, s, st); log('  restored routine ' + s.routine); }
    if (s.t === 'created') warnings.push(`agent "${s.agent}" (${s.id}) was created by this apply and is left in place`);
    if (s.t === 'commit') { await pc.setMetadata(s.id, { stack: s.prevStack ?? undefined }); log(`  restored applied-state of ${s.agent}`); }
    if (s.t !== 'before') continue;
    const b = s.before, id = s.id;
    if (s.group === 'basics') await pc.patchAgent(id, b);
    else if (s.group === 'reportsTo') await pc.patchAgent(id, { reportsTo: b.id });
    else if (s.group === 'adapter') {
      const ac = {}; for (const f of b.fields) if (f !== 'env') ac[f] = b[f] ?? null;
      if (Object.keys(ac).length) await pc.patchAgent(id, { adapterConfig: ac });
      if (b.fields.includes('env')) warnings.push(`${s.agent}: env values can't be read back from Paperclip, so they were not restored (keys were: ${b.envKeys.join(', ') || 'none'}); re-apply the previous template to restore them`);
    }
    else if (s.group === 'heartbeat') { if (b.heartbeat) await pc.setHeartbeat(id, b.heartbeat); }
    else if (s.group === 'skills') await pc.syncSkills(id, 'replace', b.slugs.map((x) => ctx.keyOf.get(x)).filter(Boolean));
    else if (s.group === 'instructions') await pc.putInstructions(id, b.text);
    log(`  restored ${s.agent}: ${s.group}`);
  }
  writeFileSync(join(dir, 'ROLLED_BACK'), new Date().toISOString());
  return { warnings };
}
