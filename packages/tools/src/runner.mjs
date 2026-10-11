// The runner: a tool only PLANS (returns operations as data); the runner validates every operation against the
// manifest and the sandbox, shows nothing is changed until the exact plan is confirmed by its hash, executes with a
// journal, and can undo from that journal. The vocabulary is two operations, mkdir and move: there is no delete,
// no overwrite, no network, so a tool cannot do more than that however it is written.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, renameSync, rmdirSync, statSync, createReadStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { canonical, sha256 } from '../../reconciler/src/canonical.mjs';
import { validateManifest } from './manifest.mjs';
import { makeSandbox, SandboxError } from './sandbox.mjs';

const MAX_OPS = 5000, HASH_LIMIT = 64 * 1024 * 1024;
const ID = /^[a-f0-9]{12}$/;
export class RunnerError extends Error { constructor(msg, extra = {}) { super(msg); this.name = 'RunnerError'; Object.assign(this, extra); } }

const fileHash = (p) => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

/** Throws unless every operation is allowed. Called when planning AND again just before executing (files may have changed). */
export function checkOps(ops, manifest, sandbox) {
  if (!Array.isArray(ops)) throw new RunnerError('A planner must return a list of operations.');
  if (ops.length > MAX_OPS) throw new RunnerError(`A plan may have at most ${MAX_OPS} operations.`);
  if (ops.length && !manifest.effects.writes) throw new RunnerError(`${manifest.id} declares no writes, so it cannot propose changes.`);
  const targets = new Set();
  for (const o of ops) {
    if (o === null || typeof o !== 'object') throw new RunnerError('Bad operation.');
    if (o.op === 'mkdir') { if (Object.keys(o).length !== 2) throw new RunnerError('Bad mkdir operation.'); sandbox.check(o.path); }
    else if (o.op === 'move') {
      if (Object.keys(o).length !== 3) throw new RunnerError('Bad move operation.');
      const from = sandbox.checkSourceFile(o.from), to = sandbox.check(o.to);
      if (existsSync(path.resolve(o.to))) throw new RunnerError(`${o.to} already exists; nothing is ever overwritten.`);
      const k = to.toLowerCase(); if (targets.has(k)) throw new RunnerError(`Two files would be moved to ${o.to}.`); targets.add(k);
      if (from.toLowerCase() === k) throw new RunnerError('A move must change the location.');
    } else throw new RunnerError(`Operation "${String(o.op).slice(0, 20)}" is not allowed. Only mkdir and move exist.`);
  }
}

export function createRunner({ dir, toolsDir, onEvent = () => {} }) {
  const plans = path.join(dir, 'plans'), runs = path.join(dir, 'runs');
  const manifestOf = (id) => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new RunnerError('Unknown tool.');
    const file = path.join(toolsDir, id, 'tool.json');
    if (!existsSync(file)) throw new RunnerError(`No tool "${id}".`);
    const v = validateManifest(JSON.parse(readFileSync(file, 'utf8')));
    if (!v.ok) throw new RunnerError(`The manifest of ${id} is not valid: ${v.errors.join(' ')}`);
    if (v.value.id !== id) throw new RunnerError('The manifest id does not match its folder.');
    return v.value;
  };
  const loadPlan = (id) => { if (!ID.test(id)) throw new RunnerError('Bad plan id.'); const f = path.join(plans, `${id}.json`); if (!existsSync(f)) throw new RunnerError('Unknown plan.'); return JSON.parse(readFileSync(f, 'utf8')); };

  return {
    manifestOf,
    async plan({ tool, roots, input = {} }) {
      const manifest = manifestOf(tool), sandbox = makeSandbox(roots);
      const mod = await import(pathToFileURL(path.join(toolsDir, tool, manifest.planner)).href);
      if (typeof mod.plan !== 'function') throw new RunnerError(`${tool} has no plan() function.`);
      const ops = await mod.plan({ roots: sandbox.roots, input: structuredClone(input) });
      checkOps(ops, manifest, sandbox);
      const body = { tool, version: manifest.version, roots: sandbox.roots, ops };
      const plan = { id: randomBytes(6).toString('hex'), ...body, createdAt: new Date().toISOString(), hash: sha256(canonical(body)).slice(0, 24) };
      mkdirSync(plans, { recursive: true }); writeFileSync(path.join(plans, `${plan.id}.json`), JSON.stringify(plan, null, 1));
      onEvent({ type: 'plan', tool, id: plan.id, ops: ops.length });
      return plan;
    },
    /** Executes a saved plan only if `confirm` is the hash of exactly that plan. */
    async execute({ planId, confirm }) {
      const plan = loadPlan(planId), manifest = manifestOf(plan.tool);
      if (typeof confirm !== 'string' || confirm !== plan.hash) throw new RunnerError('Not confirmed: the confirmation does not match this plan.');
      if (sha256(canonical({ tool: plan.tool, version: plan.version, roots: plan.roots, ops: plan.ops })).slice(0, 24) !== plan.hash) throw new RunnerError('The saved plan was altered after it was shown.');
      const journal = path.join(runs, `${plan.id}.jsonl`);
      if (existsSync(journal)) throw new RunnerError('This plan was already run.');
      const sandbox = makeSandbox(plan.roots);
      checkOps(plan.ops, manifest, sandbox); // files may have changed since the plan was shown
      mkdirSync(runs, { recursive: true });
      appendFileSync(journal, JSON.stringify({ header: true, tool: plan.tool, planHash: plan.hash, roots: plan.roots, at: new Date().toISOString() }) + '\n');
      let i = 0;
      try {
        for (; i < plan.ops.length; i++) {
          const o = plan.ops[i], rec = { i, op: o.op };
          if (o.op === 'mkdir') { const made = !existsSync(o.path); mkdirSync(o.path, { recursive: true }); Object.assign(rec, { path: o.path, created: made }); }
          else {
            const st = statSync(o.from); mkdirSync(path.dirname(o.to), { recursive: true });
            const sum = st.size <= HASH_LIMIT ? await fileHash(o.from) : null;
            if (existsSync(o.to)) throw new RunnerError(`${o.to} appeared; stopped.`);
            renameSync(o.from, o.to);
            Object.assign(rec, { from: o.from, to: o.to, bytes: st.size, sha256: sum });
          }
          appendFileSync(journal, JSON.stringify(rec) + '\n');
        }
      } catch (e) {
        onEvent({ type: 'failed', id: plan.id, at: i, error: e.message });
        return { ok: false, id: plan.id, done: i, total: plan.ops.length, error: e.message, hint: `Undo what was done with: undo ${plan.id}` };
      }
      onEvent({ type: 'executed', tool: plan.tool, id: plan.id, ops: plan.ops.length });
      return { ok: true, id: plan.id, done: plan.ops.length, total: plan.ops.length };
    },
    /** Puts every moved file back, newest first; refuses a file that changed since it was moved. */
    async undo({ id }) {
      if (!ID.test(id)) throw new RunnerError('Bad run id.');
      const journal = path.join(runs, `${id}.jsonl`), mark = path.join(runs, `${id}.undone`);
      if (!existsSync(journal)) throw new RunnerError('Unknown run.');
      if (existsSync(mark)) throw new RunnerError('This run was already undone.');
      const lines = readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), head = lines.shift();
      const sandbox = makeSandbox(head.roots), restored = [], skipped = [];
      for (const r of lines.reverse()) {
        try {
          if (r.op === 'move') {
            sandbox.check(r.from); sandbox.check(r.to);
            if (!existsSync(r.to)) { skipped.push({ path: r.to, reason: 'no longer there' }); continue; }
            if (existsSync(r.from)) { skipped.push({ path: r.from, reason: 'something else is at the original place' }); continue; }
            if (statSync(r.to).size !== r.bytes || (r.sha256 && (await fileHash(r.to)) !== r.sha256)) { skipped.push({ path: r.to, reason: 'changed since it was moved' }); continue; }
            renameSync(r.to, r.from); restored.push(r.from);
          } else if (r.op === 'mkdir' && r.created) { try { rmdirSync(r.path); } catch { /* not empty: leave it */ } }
        } catch (e) { skipped.push({ path: r.to ?? r.path, reason: e instanceof SandboxError ? e.message : e.code ?? e.message }); }
      }
      writeFileSync(mark, new Date().toISOString());
      onEvent({ type: 'undone', id, restored: restored.length, skipped: skipped.length });
      return { ok: skipped.length === 0, restored: restored.length, skipped };
    },
  };
}
