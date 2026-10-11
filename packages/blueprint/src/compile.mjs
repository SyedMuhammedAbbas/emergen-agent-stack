// requirements -> blueprint (deterministic: same input, same output, same hash), plus the cost estimate and the validator.
// The blueprint is what the person reviews and approves; applying it is limited to the steps in `actions` (the wizard's
// fixed, named steps). A hash of everything that will be applied is the approval token.
import { canonical, sha256 } from '../../reconciler/src/canonical.mjs';
import { scanText } from '../../../apps/control-app/src/secretscan.mjs';
import { clean, plan as wizardPlan } from '../../../tools/setup-wizard/actions.mjs';

const ORDER = ['engineering', 'operations', 'branding', 'freelance'];
const POLICY = Object.freeze({ defaultPermission: 'ask', externalWrites: 'ask', note: 'Nothing is sent to a third party, published, or merged without your approval.' });
const round2 = (n) => Math.round(n * 100) / 100;

/** Monthly idle cost: what the scheduled routines cost when nobody gives the agents a task (API-equivalent value of subscription runs). */
export function estimateCost(req, departments, catalog) {
  const prof = catalog.profiles[req.autonomy], per = catalog.perRun, ops = departments.includes('operations');
  const parts = [
    { label: 'Manager wake-ups', usd: prof.runs.heartbeat * per.heartbeat },
    ...(ops ? [{ label: 'Stall checks', usd: prof.runs.watchdog * per.watchdog }, { label: 'Progress reports', usd: prof.runs.report * per.report }, { label: 'Timesheets', usd: catalog.timesheetRunsPerMonth * per.timesheet }] : []),
  ].filter((p) => p.usd > 0).map((p) => ({ ...p, usd: round2(p.usd) }));
  const idle = round2(parts.reduce((n, p) => n + p.usd, 0));
  const agents = departments.flatMap((d) => catalog.departments[d].agents);
  return { idleUsd: idle, idleRangeUsd: [round2(idle * 0.7), round2(idle * 1.4)], parts, capsUsd: round2(agents.reduce((n, a) => n + a.budgetUsd, 0)), agentCount: agents.length,
    note: 'Idle cost is what the scheduled routines would cost at API prices. On a Claude subscription it is covered, but it counts toward the load and the figures on the Cost screen.' };
}

/** @param {any} req validated requirements @param {any} catalog @param {{ repo:string, config?:Record<string,string> }} ctx */
export function compile(req, catalog, { repo, config = {} }) {
  const company = req.kind !== 'personal';
  let depts = company ? [...new Set(req.departments)] : [];
  const notes = [];
  if (depts.length && !depts.includes('engineering')) { depts.push('engineering'); notes.push('The Engineering department was added: its Manager heads every other department.'); }
  depts = [...ORDER.filter((d) => depts.includes(d)), ...depts.filter((d) => !ORDER.includes(d)).sort()];

  const hasUpwork = req.tools.includes('upwork-mcp'), organizer = req.tools.includes('downloads-organizer') || req.personal.organizer;
  const sel = { areas: [...(depts.length ? ['paperclip'] : []), ...(depts.includes('branding') ? ['branding'] : []), ...(depts.includes('freelance') ? ['freelance'] : []),
    ...(organizer || req.personal.categories.length ? ['personal'] : []), ...(req.tools.includes('omniroute') ? ['routing'] : []), ...(req.tools.includes('crew-mod') ? ['mods'] : [])],
    company: { name: req.name }, paperclip: { departments: depts, profile: req.autonomy }, personal: { organizer, categories: req.personal.categories, projectsRoot: req.personal.projectsRoot },
    branding: req.brand ?? {}, freelance: { upworkMcp: hasUpwork }, routing: { omniroute: req.tools.includes('omniroute') }, mods: { crew: req.tools.includes('crew-mod') } };
  const c = clean(sel);
  const { actions, manual } = wizardPlan(c, { profiles: { profiles: catalog.profiles }, config });

  const agents = depts.flatMap((d) => catalog.departments[d].agents.map((a) => ({ ...a, department: d })));
  const tools = req.tools.map((id) => { const t = catalog.tools.find((x) => x.id === id); return { id, title: t.title, kind: t.kind, external: t.external, permission: t.external ? 'ask' : 'local', note: t.note }; })
    .concat(organizer && !req.tools.includes('downloads-organizer') ? [{ id: 'downloads-organizer', title: 'Downloads organizer', kind: 'local', external: false, permission: 'local', note: 'Sorts new downloads into topic folders; every move is logged and undoable.' }] : []);
  const services = [...(depts.length ? [{ id: 'paperclip', pinned: catalog.services.paperclip ?? null }, { id: 'jev-router', pinned: null }] : []), ...(req.tools.includes('omniroute') ? [{ id: 'omniroute', pinned: null }] : [])];
  const cost = estimateCost(req, depts, catalog);

  const bp = {
    schemaVersion: 1,
    workspace: { name: req.name || 'Personal workspace', kind: req.kind },
    goals: req.goals, unknowns: req.unknowns, notes,
    departments: depts, agents, tools, services,
    schedule: { profile: req.autonomy, env: depts.length ? catalog.profiles[req.autonomy].env : {} },
    budget: { monthlyUsd: req.budgetMonthlyUsd, hardStop: true },
    paths: { projectsRoot: req.personal.projectsRoot || null, categories: req.personal.categories }, brand: req.brand,
    policy: POLICY, cost,
    actions: actions.map((a) => a.id === 'apply-org'
      ? { id: a.id, title: 'Create or update the agents in Paperclip', detail: 'wsl/40-org.sh with the reconciler', note: 'Changes only what differs from your templates, keeps edits made in Paperclip, and every write can be undone with stack rollback. WSL and Paperclip must be running.', params: null }
      : { id: a.id, title: a.title, detail: a.detail, note: a.note, params: a.params ?? null }),
    manual,
  };
  const validation = validateBlueprint(bp, catalog);
  // The approval token covers everything that will be applied (not the wording of notes or the cost text).
  const hash = sha256(canonical({ requirements: req, departments: bp.departments, tools: bp.tools.map((t) => [t.id, t.permission]), actions: bp.actions, policy: bp.policy, schedule: bp.schedule })).slice(0, 24);
  return { ...bp, validation, hash };
}

export function validateBlueprint(bp, catalog) {
  const errors = [], warnings = [];
  if (!bp.departments.length && !bp.actions.length) errors.push('Nothing is selected, so there is nothing to set up.');
  for (const t of bp.tools) if (t.external && t.permission !== 'ask') errors.push(`${t.title} writes to a third-party system, so it must stay on "ask first".`);
  const keys = bp.agents.map((a) => a.key); if (new Set(keys).size !== keys.length) errors.push('Two agents share a key; fix the department files.');
  if (scanText(JSON.stringify({ ...bp, actions: bp.actions.map((a) => ({ ...a, params: null })) }).replace(/","/g, '\n')).length) errors.push('A value looks like a secret. Remove it; secrets are typed only into each service’s own sign-in.');
  if (bp.cost.idleUsd > bp.budget.monthlyUsd) errors.push(`The idle cost (about $${bp.cost.idleUsd} a month) is more than your $${bp.budget.monthlyUsd} budget. Choose a quieter schedule or a larger budget.`);
  else if (bp.cost.idleUsd > bp.budget.monthlyUsd * 0.7) warnings.push(`Idle cost is about $${bp.cost.idleUsd} of your $${bp.budget.monthlyUsd} budget, which leaves little room for real work.`);
  if (bp.schedule.profile === 'watchful' && bp.departments.length) warnings.push('The Watchful schedule keeps agents waking up every few hours; it costs several times more while idle.');
  if (bp.departments.includes('freelance') && !bp.tools.some((t) => t.id === 'upwork-mcp')) warnings.push('The Freelance department works best with the Upwork connector; without it the Upwork Scout has no way to read jobs.');
  if (bp.departments.includes('branding')) warnings.push('Branding needs design and video tools connected in Paperclip’s Connectors page; they are not set up for you.');
  for (const s of bp.services) if (!s.pinned) warnings.push(`${s.id} is installed without a pinned version, so a fresh machine may get a newer one than yours.`);
  if (bp.paths.projectsRoot && /^[A-Za-z]:\\?$/.test(bp.paths.projectsRoot)) warnings.push('The projects folder is a whole drive; a subfolder keeps things tidier.');
  if (bp.unknowns.length) warnings.push(`${bp.unknowns.length} open question${bp.unknowns.length > 1 ? 's' : ''} below could change this proposal.`);
  return { errors, warnings, ok: !errors.length };
}
