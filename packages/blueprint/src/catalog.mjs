// What can be set up: departments (read from org/*/department.json, so a new department appears automatically),
// tools, schedule profiles (tools/setup-wizard/profiles.json) and starting-point presets. Nothing here is user input.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Tools the onboarding may offer. `external` = writes to a third-party system, so it can never be pre-approved. */
export const TOOLS = [
  { id: 'upwork-mcp', title: "Upwork's official connector", kind: 'mcp', external: true, requires: ['freelance'], note: 'Registered only. You sign in to Upwork yourself; agents draft, you submit.' },
  { id: 'downloads-organizer', title: 'Downloads organizer', kind: 'local', external: false, note: 'Sorts new downloads into topic folders; every move is logged and undoable.' },
  { id: 'omniroute', title: 'OmniRoute gateway', kind: 'service', external: false, note: 'Routes non-Claude models. Providers and keys are added in its own dashboard.' },
  { id: 'crew-mod', title: 'Claude crew mod', kind: 'mod', external: false, note: 'Pixel crabs for every agent inside Claude Code.' },
];

/** Starting points: a preset only fills the form; the person still reviews every choice. */
export const PRESETS = [
  { id: 'software-company', title: 'Software company', kind: 'company', departments: ['engineering', 'operations'], tools: ['crew-mod'], blurb: 'Manager, CTO, engineers, QA, docs, plus a chief of staff, timekeeper and watchdog.' },
  { id: 'brand-and-content', title: 'Brand and content', kind: 'company', departments: ['engineering', 'operations', 'branding'], tools: ['crew-mod'], blurb: 'Adds a brand lead, designer, video generator and content writer.' },
  { id: 'freelancer', title: 'Freelancer', kind: 'company', departments: ['engineering', 'operations', 'freelance'], tools: ['upwork-mcp', 'crew-mod'], blurb: 'Adds an Upwork scout that finds jobs and drafts proposals.' },
  { id: 'personal-assistant', title: 'Personal organiser', kind: 'personal', departments: [], tools: ['downloads-organizer'], blurb: 'No agent company: tidies downloads and creates your project folders.' },
];

export function loadCatalog(repo) {
  const departments = {};
  const orgDir = join(repo, 'org');
  for (const d of existsSync(orgDir) ? readdirSync(orgDir) : []) {
    const f = join(orgDir, d, 'department.json');
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    departments[j.key] = { key: j.key, name: j.name, description: j.description, head: j.head, enabledByDefault: j.enabled !== false,
      agents: j.agents.map((a) => ({ key: a.key, name: a.name, title: a.title, model: a.model ?? (a.router ? 'jev-router' : 'default'), budgetUsd: (a.budgetCents ?? 0) / 100, routine: a.routine?.title ?? null })) };
  }
  const prof = JSON.parse(readFileSync(join(repo, 'tools', 'setup-wizard', 'profiles.json'), 'utf8'));
  const lockFile = join(repo, 'services.lock.json');
  return { departments, profiles: prof.profiles, perRun: prof.perRun, timesheetRunsPerMonth: prof.timesheetRunsPerMonth, tools: TOOLS, presets: PRESETS, services: existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : {} };
}
