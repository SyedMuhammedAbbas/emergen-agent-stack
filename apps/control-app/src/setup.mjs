// Onboarding (M3) behind the control app: describe -> requirements -> blueprint -> preview -> approve (hash) -> apply.
// Apply re-derives the blueprint from the requirements and refuses unless it matches the approved hash and validates,
// so nothing runs that the person was not shown. It runs only the wizard's fixed, named steps; the org step goes
// through the reconciler (keeps edits made in Paperclip, journals writes) instead of the old overwriting install.
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadCatalog } from '../../../packages/blueprint/src/catalog.mjs';
import { validateRequirements } from '../../../packages/blueprint/src/requirements.mjs';
import { ruleInterpret, claudeInterpret } from '../../../packages/blueprint/src/interpret.mjs';
import { compile } from '../../../packages/blueprint/src/compile.mjs';
import { EXECUTORS, readConfig, DRY } from '../../../tools/setup-wizard/actions.mjs';

const wslPath = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replaceAll('\\', '/');

function reconcilerOrg(job, _a, repo) {
  const distro = readConfig(repo).WSL_DISTRO || 'Ubuntu-24.04';
  const args = ['-d', distro, '--exec', 'bash', '-c', 'cd "$1" && RECONCILER=1 bash wsl/40-org.sh', '_', wslPath(repo)];
  job.log(`$ wsl.exe ${args.slice(0, 5).join(' ')} … (reconciler)`);
  if (DRY()) { job.log('(preview: not run)'); return Promise.resolve(0); }
  return new Promise((resolve) => {
    const p = spawn('wsl.exe', args, { windowsHide: true });
    const feed = (d) => String(d).replace(/\0/g, '').split(/\r?\n/).filter(Boolean).forEach((l) => job.log(l));
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', (e) => { job.log(`could not start wsl.exe: ${e.message}`); resolve(1); });
    p.on('close', (c) => resolve(c ?? 1));
  });
}

export function createSetup({ repo, audit, executors = { ...EXECUTORS, 'apply-org': reconcilerOrg }, interpretClaude = claudeInterpret }) {
  const jobs = new Map();
  let running = null;
  const catalog = () => loadCatalog(repo);
  const build = (requirements) => {
    const cat = catalog(), v = validateRequirements(requirements, cat);
    if (!v.ok) return { ok: false, errors: v.errors };
    return { ok: true, blueprint: compile(v.value, cat, { repo, config: readConfig(repo) }), requirements: v.value };
  };
  return {
    options() { const c = catalog(); return { presets: c.presets, tools: c.tools, profiles: Object.fromEntries(Object.entries(c.profiles).map(([k, p]) => [k, { label: p.label, blurb: p.blurb }])), departments: Object.values(c.departments).map((d) => ({ key: d.key, name: d.name, description: d.description, agents: d.agents.length })) }; },
    async interpret({ text, useModel = true }) {
      const t = String(text ?? '').trim();
      if (!t) return { status: 400, error: 'Describe what you want first.' };
      const r = useModel ? await interpretClaude(t, catalog()) : ruleInterpret(t, catalog());
      audit?.add({ action: 'setup.interpret', via: r.via, ok: !!r.ok });
      return { status: 200, ...r };
    },
    preview({ requirements }) { const b = build(requirements); return b.ok ? { status: 200, ok: true, blueprint: b.blueprint } : { status: 200, ok: false, errors: b.errors }; },
    apply({ requirements, hash }) {
      if (running) return { status: 409, error: 'A setup is already running.' };
      const b = build(requirements);
      if (!b.ok) return { status: 400, error: b.errors.join(' ') };
      if (!b.blueprint.validation.ok) return { status: 400, error: b.blueprint.validation.errors.join(' ') };
      if (typeof hash !== 'string' || hash !== b.blueprint.hash) return { status: 409, error: 'What you approved no longer matches the plan. Review it again.' };
      const job = { id: crypto.randomBytes(6).toString('hex'), steps: b.blueprint.actions.map((a) => ({ id: a.id, title: a.title, status: 'waiting' })), lines: [], done: false, dry: DRY() };
      job.log = (l) => job.lines.push(String(l).slice(0, 500));
      jobs.set(job.id, job); running = job.id;
      audit?.add({ action: 'setup.apply', hash, steps: job.steps.map((s) => s.id), dry: job.dry });
      (async () => {
        for (let i = 0; i < b.blueprint.actions.length; i++) {
          const a = b.blueprint.actions[i], step = job.steps[i]; step.status = 'running'; job.log(`\n== ${a.title}`);
          try { step.status = (await executors[a.id](job, a, repo)) === 0 ? 'done' : 'failed'; } catch (e) { job.log(`error: ${e.message}`); step.status = 'failed'; }
          if (step.status === 'failed') job.log('This step did not finish. Later steps still run; fix it and apply again.');
        }
        job.manual = b.blueprint.manual; job.done = true; running = null;
        audit?.add({ action: 'setup.done', hash, failed: job.steps.filter((s) => s.status === 'failed').map((s) => s.id) });
      })();
      return { status: 200, job: job.id };
    },
    job(id, from = 0) { const j = jobs.get(id); if (!j) return { status: 404, error: 'unknown job' }; return { status: 200, steps: j.steps, lines: j.lines.slice(from), next: j.lines.length, done: j.done, manual: j.manual ?? [], dry: j.dry }; },
  };
}
