// Desired state: turn the rendered org (wsl/lib.sh build_org) + role markdown + settings into agent projections.
// Mirrors what wsl/40-org.sh used to build inline, so behaviour stays the same.
import { normText } from './canonical.mjs';

/** Fields the reconciler owns on an agent. Everything else on a Paperclip agent is never touched. */
export const FIELDS = ['name', 'role', 'title', 'icon', 'budgetMonthlyCents', 'reportsTo', 'model', 'env', 'command', 'timeoutSec', 'heartbeat', 'skills', 'instructions'];

/** The built-in skill every Paperclip agent always has; it can't be removed, so it is never compared. */
export const BUILTIN_SKILL = 'paperclip';

/**
 * @typedef {{ name:string, role:string, title:string, icon:string, budgetMonthlyCents:number, reportsTo:string|null,
 *   model:string|null, env:Record<string,string>, command:string, timeoutSec:number,
 *   heartbeat:{enabled:boolean,intervalSec?:number,maxConcurrentRuns:number}|undefined, skills:string[], instructions:string }} Projection
 * @typedef {{ key:string, department:string } & Projection} DesiredAgent
 */

/**
 * @param {{ agents: any[], commonSkills: string[], routerEnv: Record<string,string> }} org  rendered org (org.rendered.json)
 * @param {Record<string,string>} instructionsByKey  rendered role markdown per agent key
 * @param {{ claudeCommand:string, managerHeartbeatSec:number, extraSkills:string[] }} settings
 * @returns {DesiredAgent[]}
 */
export function desiredAgents(org, instructionsByKey, settings) {
  return org.agents.map((a) => {
    if (instructionsByKey[a.key] === undefined) throw new Error(`no rendered instructions for agent "${a.key}"`);
    return {
      key: a.key, department: a.department,
      name: a.name, role: a.role, title: a.title, icon: a.icon, budgetMonthlyCents: a.budgetCents,
      reportsTo: a.reportsTo ?? null,
      model: a.model ?? null,
      env: a.router ? { ...org.routerEnv } : {},
      command: settings.claudeCommand, timeoutSec: 3600,
      heartbeat: heartbeatFor(a, settings.managerHeartbeatSec),
      skills: [...new Set([...org.commonSkills, ...settings.extraSkills, ...(a.skills ?? [])])].filter((s) => s && s !== BUILTIN_SKILL).sort(),
      instructions: normText(instructionsByKey[a.key]),
    };
  });
}

/** Same three cases as 40-org.sh: timer on, timer off (still wakes on assignments), or just a run cap. */
export function heartbeatFor(a, managerHeartbeatSec) {
  if (a.heartbeat === true && managerHeartbeatSec > 0) return { enabled: true, intervalSec: managerHeartbeatSec, maxConcurrentRuns: 1 };
  if (a.heartbeat === true) return { enabled: false, maxConcurrentRuns: 1 };
  if (a.maxConcurrentRuns !== undefined && a.maxConcurrentRuns !== null) return { enabled: false, maxConcurrentRuns: a.maxConcurrentRuns };
  return undefined; // not managed: leave Paperclip's value alone
}
