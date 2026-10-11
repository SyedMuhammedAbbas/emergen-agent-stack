// The Models screen: how Claude agents are routed (jev-router) and whether the gateway for other models (OmniRoute) is up.
// Read-only and secret-free: jev-router's /healthz, a jq-filtered slice of its config (tiers, pins, thresholds; the filter
// leaves out keys and key names), and the `route` events of its log (tier, model, a short reason). OmniRoute exposes only
// /api/health without a login, so its providers and combos are not shown (they need OmniRoute's own sign-in).
import { real, httpProbe } from './probes.mjs';
import { redact } from './redact.mjs';

const CONFIG_JQ = '{tiers,defaultTier,baselineModel,modelPins,policy:{mode:.policy.mode,accept:.policy.accept,maxProvisional:.policy.maxProvisional,idleResetMinutes:.policy.idleResetMinutes}}';
export const cmdFor = () => `jq -c '${CONFIG_JQ}' "$HOME/.config/jev-router/config.json" 2>/dev/null; echo '---'; tail -n 4000 "$HOME/.local/state/jev-router/router.log" 2>/dev/null | grep '"event":"route"' | tail -n 500`;

/** Reverse the pins ("haiku" -> fast) into tier -> client model names. */
export function tiersOf(cfg) {
  const names = cfg.tiers ?? ['fast', 'balanced', 'frontier'], pins = cfg.modelPins ?? {};
  return names.map((tier) => ({ tier, models: Object.entries(pins).filter(([, t]) => t === tier).map(([m]) => m), confidence: cfg.policy?.accept?.[tier] ?? null, isDefault: tier === cfg.defaultTier }));
}

/** @param {string} stdout output of cmdFor() */
export function parseRouterOutput(stdout, now = Date.now()) {
  const [head, ...rest] = String(stdout).split(/^---$/m);
  let cfg = null; try { cfg = JSON.parse(head.trim().split('\n')[0]); } catch { /* config unreadable */ }
  const events = rest.join('\n').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.event === 'route' && e.ts);
  const day = events.filter((e) => now - new Date(e.ts) < 24 * 3600 * 1000);
  const tally = {}, models = {};
  for (const e of day) { tally[e.tier] = (tally[e.tier] ?? 0) + 1; if (e.model) models[e.model] = (models[e.model] ?? 0) + 1; }
  const recent = events.slice(-6).reverse().map((e) => ({ at: e.ts, tier: e.tier, model: e.model ?? null, reason: redact(String(e.reason ?? '')).slice(0, 70) }));
  return { config: cfg ? { ...cfg, tiers: tiersOf(cfg) } : null, last24h: { total: day.length, byTier: tally, byModel: models }, recent };
}

export async function readModels(settings, { exec = real.exec, fetch = real.fetch } = {}) {
  const [health, omni, router] = await Promise.all([
    fetch('http://127.0.0.1:4000/healthz', { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).catch(() => null),
    httpProbe('http://127.0.0.1:20128/api/health', { fetch }),
    exec('wsl.exe', ['-d', settings.distro, '--', 'bash', '-c', cmdFor()], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }).then((r) => parseRouterOutput(r.stdout), () => null),
  ]);
  const ch = health?.jev?.channels ?? {};
  return {
    router: { up: Boolean(health?.ok), version: health?.version ?? null, uptimeSec: health?.uptime_s ?? null, sessions: health?.sessions ?? 0, active: health?.active ?? 0,
      jev: health?.jev ? { configured: Boolean(health.jev.configured), channels: Object.entries(ch).map(([name, c]) => ({ name, calls: c.calls ?? 0, errors: c.errors ?? 0, open: Boolean(c.open), lastError: c.lastError ? redact(String(c.lastError)).slice(0, 120) : null })) } : null,
      ...(router ?? { config: null, last24h: { total: 0, byTier: {}, byModel: {} }, recent: [] }) },
    omniroute: { up: omni.ok },
  };
}

/** Which path each agent's model setting sends it down (from the Team data). */
export function pathsOf(agents) {
  const via = { jev: [], direct: [], omni: [] };
  for (const a of agents) (a.model === 'jev-router' ? via.jev : /^(openrouter|omniroute)\b|\//i.test(a.model) ? via.omni : via.direct).push({ name: a.name, model: a.model });
  return via;
}
