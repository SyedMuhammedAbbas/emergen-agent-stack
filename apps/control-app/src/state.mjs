// Settings, and the cached view-model the UI polls (/api/state). One refresh at a time; results are reused for ttlMs.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readServices } from './services.mjs';
import { readPaperclip, projectMonth } from './paperclip.mjs';
import { diskFreeGB } from './probes.mjs';
import { deriveNeeds, headline } from './needs.mjs';

export const DEFAULTS = { distro: 'Ubuntu-24.04', paperclip: 'http://127.0.0.1:3100', budgetUsd: 100, alertAt: 0.8, companyName: undefined };

/** %LOCALAPPDATA%\AgentStack\settings.json overrides the defaults; WSL_DISTRO from the repo's config.env is the next fallback. */
export function loadSettings({ appDir = join(process.env.LOCALAPPDATA ?? '.', 'AgentStack'), repo } = {}) {
  let s = { ...DEFAULTS };
  const env = repo && join(repo, 'config.env');
  if (env && existsSync(env)) { const m = /^WSL_DISTRO=(.+)$/m.exec(readFileSync(env, 'utf8')); if (m) s.distro = m[1].trim().replace(/\r$/, ''); }
  const f = join(appDir, 'settings.json');
  if (existsSync(f)) try { s = { ...s, ...JSON.parse(readFileSync(f, 'utf8')) }; } catch { /* keep defaults; a bad file must not stop the app */ }
  return s;
}

export function createStore({ settings, io = {}, ttlMs = 8000, now = () => new Date() }) {
  let latest = null, inflight = null; const started = now().toISOString();
  async function build() {
    const [services, paperclip] = await Promise.all([readServices(settings, io), readPaperclip(settings.paperclip, { fetch: io.fetch, now: now(), companyName: settings.companyName })]);
    const disk = (io.diskFreeGB ?? diskFreeGB)();
    const needs = deriveNeeds({ services, paperclip, diskFreeGB: disk });
    const month = paperclip.runs?.monthUsd ?? 0;
    return {
      checkedAt: now().toISOString(), startedAt: started,
      headline: headline(services, needs), needs, services,
      paperclip: { up: paperclip.up, error: paperclip.error, company: paperclip.company?.name ?? null },
      crew: paperclip.crew ?? [], recent: paperclip.recent ?? [], approvalsPending: paperclip.approvalsPending ?? 0,
      runs: paperclip.runs ? { today: paperclip.runs.runsToday, month: paperclip.runs.runsThisMonth } : null,
      spend: paperclip.runs ? { monthUsd: month, apiUsd: paperclip.runs.apiUsd, subscriptionUsd: paperclip.runs.subscriptionUsd, budgetUsd: settings.budgetUsd, alertAt: settings.alertAt,
        pct: Math.min(100, Math.round((month / settings.budgetUsd) * 1000) / 10), projectedUsd: projectMonth(month, now()) } : null,
      disk: { cFreeGB: disk },
    };
  }
  async function refresh() { return (inflight ??= build().then((v) => (latest = v)).finally(() => { inflight = null; })); }
  return {
    refresh,
    /** Cached while fresh; otherwise waits for a new reading. */
    async get() { return latest && now() - new Date(latest.checkedAt) < ttlMs ? latest : refresh(); },
    start(everyMs = 10000) { const t = setInterval(() => refresh().catch(() => {}), everyMs); t.unref?.(); return () => clearInterval(t); },
  };
}
