// Settings, and the cached view-model the UI polls (/api/state). One refresh at a time; results are reused for ttlMs.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readServices } from './services.mjs';
import { readPaperclip, projectMonth } from './paperclip.mjs';
import { diskFreeGB } from './probes.mjs';
import { deriveNeeds, headline } from './needs.mjs';
import { CONTROL } from './actions.mjs';
import { LOG_UNITS } from './logs.mjs';
import { appDirOf } from './audit.mjs';
import { buildTeam, runStackPlan } from './team.mjs';
import { readModels, pathsOf } from './models.mjs';
import { readTools } from './tools.mjs';
import { readInventory, listBackups, lastScan } from './safety.mjs';
import { loadCache, saveCache, mergeRuns, buildCost, buildActivity } from './costs.mjs';

export const DEFAULTS = { distro: 'Ubuntu-24.04', paperclip: 'http://127.0.0.1:3100', budgetUsd: 100, alertAt: 0.8, companyName: undefined };

/** %LOCALAPPDATA%\AgentStack\settings.json overrides the defaults; WSL_DISTRO from the repo's config.env is the next fallback. */
export function loadSettings({ appDir = join(process.env.LOCALAPPDATA ?? '.', 'AgentStack'), repo } = {}) {
  let s = { ...DEFAULTS };
  const env = repo && join(repo, 'config.env');
  if (env && existsSync(env)) { const m = /^WSL_DISTRO=(.+)$/m.exec(readFileSync(env, 'utf8')); if (m) s.distro = m[1].trim().replace(/\r$/, ''); }
  const f = join(appDir, 'settings.json');
  if (existsSync(f)) try { s = { ...s, ...JSON.parse(readFileSync(f, 'utf8')) }; } catch { /* keep defaults; a bad file must not stop the app */ }
  if (repo) s.repo = repo;   // where the reconciler lives (the Team screen runs its read-only plan)
  return s;
}

export function createStore({ settings, io = {}, ttlMs = 8000, now = () => new Date() }) {
  let latest = null, inflight = null; const started = now().toISOString();
  const cacheFile = join(settings.appDir ?? appDirOf(settings), 'cost-cache.json'), cache = loadCache(cacheFile); cache.agents ??= {}; let sig = '';
  const titling = new Set();
  // the reconciler's read-only plan for the Team screen: refreshed in the background about once a minute, never awaited
  const plan = { at: 0, data: null, error: null, running: false };
  // how Claude agents are routed and whether OmniRoute is up: refreshed in the background about every 30 s
  const safety = { at: 0, data: null, running: false };
  const appDir = settings.appDir ?? appDirOf(settings);
  // secret inventory and database backups: refreshed in the background about once a minute (the leak scan only runs when you ask)
  async function refreshSafety() {
    if (safety.running) return; safety.running = true;
    try { const [inventory, backups] = await Promise.all([(io.readInventory ?? ((st) => readInventory(st, { exec: io.exec })))(settings), (io.listBackups ?? ((st) => listBackups(st, { exec: io.exec })))(settings)]); safety.data = { inventory, backups }; }
    catch { /* keep the last reading */ } finally { safety.running = false; safety.at = Date.now(); }
  }
  const models = { at: 0, data: null, running: false };
  async function refreshModels() {
    if (models.running) return; models.running = true;
    try { models.data = await (io.readModels ?? ((st) => readModels(st, { exec: io.exec, fetch: io.fetch })))(settings); } catch { /* keep the last reading */ }
    finally { models.running = false; models.at = Date.now(); }
  }
  // tool activity (the MCP hook's log) and the integrations policy: refreshed in the background about every 15 s
  const tools = { at: 0, data: null, running: false };
  async function refreshTools() {
    if (tools.running) return; tools.running = true;
    try { tools.data = await (io.readTools ?? ((st) => readTools(st, { exec: io.exec, agentNames: cache.agents })))(settings); } catch { /* keep the last reading */ }
    finally { tools.running = false; tools.at = Date.now(); }
  }
  async function refreshPlan() {
    if (plan.running) return; plan.running = true;
    try { plan.data = await (io.stackPlan ?? ((st) => runStackPlan(st, { exec: io.exec })))(settings); plan.error = null; } catch (e) { plan.error = String(e.message).slice(0, 160); }
    finally { plan.running = false; plan.at = Date.now(); }
  }
  // task titles for finished runs, fetched a few at a time in the background (never delays a reading)
  async function fillTitles(fetch) {
    const todo = Object.values(cache.runs).filter((r) => cache.titles[r.id] === undefined && r.status !== 'running' && r.status !== 'queued' && !titling.has(r.id)).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12);
    await Promise.all(todo.map(async (r) => { titling.add(r.id); try { const res = await fetch(`${settings.paperclip}/api/heartbeat-runs/${r.id}/issues`, { signal: AbortSignal.timeout(3000) }); if (res.ok) { const l = await res.json(); const i = Array.isArray(l) ? l[0] : null; cache.titles[r.id] = i ? [i.identifier, i.title].filter(Boolean).join(' ') : ''; } } catch { /* try again next time */ } finally { titling.delete(r.id); } }));
    saveCache(cacheFile, cache);
  }
  async function build() {
    const [rawServices, paperclip] = await Promise.all([readServices(settings, io), readPaperclip(settings.paperclip, { fetch: io.fetch, now: now(), companyName: settings.companyName })]);
    // what the UI may offer for each service (the server enforces the same list)
    const services = rawServices.map((x) => ({ ...x, actions: CONTROL[x.id]?.actions ?? [], hasLogs: Boolean(LOG_UNITS[x.id]) || ['keepalive', 'hermes'].includes(x.id) }));
    const disk = (io.diskFreeGB ?? diskFreeGB)();
    // spend and activity from the persistent run ledger (Paperclip's list is merged into it; history survives if the list is trimmed)
    const nowD = now();
    if (paperclip.raw) { for (const a of paperclip.raw.agents) cache.agents[a.id] = a.name; mergeRuns(cache, paperclip.raw.runs); }
    const nsig = Object.values(cache.runs).map((r) => r.id + r.status + r.usd).join('|') + JSON.stringify(cache.agents);
    if (nsig !== sig) { sig = nsig; saveCache(cacheFile, cache); }
    if (paperclip.up) fillTitles(io.fetch ?? fetch).catch(() => {});
    const byId = new Map(Object.entries(cache.agents).map(([id, name]) => [id, { name }]));
    const cost = buildCost(cache, byId, nowD, { budgetUsd: settings.budgetUsd, alertAt: settings.alertAt });
    const activity = buildActivity(cache, byId, paperclip.raw?.approvals ?? [], 40);
    const spend = { monthUsd: cost.totalUsd, apiUsd: cost.apiUsd, subscriptionUsd: cost.subscriptionUsd, budgetUsd: settings.budgetUsd, alertAt: settings.alertAt, pct: cost.budget.pct, level: cost.budget.level, projectedUsd: cost.projectedUsd };
    if (paperclip.up && !plan.running && Date.now() - plan.at > (io.planEveryMs ?? 60000)) refreshPlan();
    const team = buildTeam(paperclip.raw?.agents ?? [], plan.data, { ranAt: plan.at ? new Date(plan.at).toISOString() : null, error: plan.error });
    if (!models.running && Date.now() - models.at > (io.modelsEveryMs ?? 30000)) refreshModels();
    if (!tools.running && Date.now() - tools.at > (io.toolsEveryMs ?? 15000)) refreshTools();
    if (!safety.running && Date.now() - safety.at > (io.safetyEveryMs ?? 60000)) refreshSafety();
    const safetyView = safety.data ? { ...safety.data, lastScan: lastScan(appDir) } : null;
    const needs = deriveNeeds({ services, paperclip, diskFreeGB: disk, spend, team, safety: safetyView, now: nowD });
    return {
      checkedAt: now().toISOString(), startedAt: started,
      headline: headline(services, needs), needs, services,
      paperclip: { up: paperclip.up, error: paperclip.error, company: paperclip.company?.name ?? null },
      crew: paperclip.crew ?? [], recent: paperclip.recent ?? [], approvalsPending: paperclip.approvalsPending ?? 0,
      runs: { today: cost.days.at(-1)?.runs ?? 0, month: cost.month.runs },
      spend, cost, activity, team, tools: tools.data, safety: safetyView, models: models.data ? { ...models.data, paths: pathsOf(team.agents) } : null,
      disk: { cFreeGB: disk },
    };
  }
  async function refresh() { return (inflight ??= build().then((v) => (latest = v)).finally(() => { inflight = null; })); }
  return {
    refresh, refreshSafety,
    /** Cached while fresh; otherwise waits for a new reading. */
    async get() { return latest && now() - new Date(latest.checkedAt) < ttlMs ? latest : refresh(); },
    start(everyMs = 10000) { const t = setInterval(() => refresh().catch(() => {}), everyMs); t.unref?.(); return () => clearInterval(t); },
  };
}
