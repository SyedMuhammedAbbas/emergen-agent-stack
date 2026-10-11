// The services behind the agents, read-only in M2.1 (start/stop arrives in M2.3). Declarative: one record each.
import { real, httpProbe, wslRunning, systemdUnits, parseSystemdTime, taskStatus } from './probes.mjs';

/** state: ok | warn | fail | off (not set up) | unknown (cannot tell, e.g. WSL is down) */
export const DEFS = [
  { id: 'paperclip', title: 'Paperclip', about: 'Runs the company: tasks, agents, approvals', kind: 'WSL service', unit: 'paperclipai.service', port: 3100, url: 'http://127.0.0.1:3100/api/health' },
  { id: 'jev', title: 'jev-router', about: 'Picks a Claude model for each message', kind: 'WSL service', unit: 'jev-router.service', port: 4000, url: 'http://127.0.0.1:4100/' },
  { id: 'omniroute', title: 'OmniRoute', about: 'Gateway for non-Claude models', kind: 'WSL service', unit: 'omniroute.service', port: 20128, url: 'http://127.0.0.1:20128/' },
  { id: 'hermes', title: 'Hermes bridge', about: 'Odoo tickets and Discord approvals', kind: 'Windows task', task: 'Hermes_Gateway', optional: true },
  { id: 'wsl', title: 'WSL', about: 'Where the services run', kind: 'Windows' },
  { id: 'keepalive', title: 'Keepalive', about: 'Keeps WSL awake while you are away', kind: 'Windows task', task: 'WSL-Agents-Keepalive' },
  { id: 'watchdog', title: 'Watchdog timer', about: 'Restarts stalled tasks every 10 minutes', kind: 'WSL timer', unit: 'agent-watchdog.timer' },
];

/**
 * @param {{ distro:string }} cfg
 * @param {{ exec?:Function, fetch?:Function, now?:()=>number }} [io]
 */
export async function readServices(cfg, io = {}) {
  const exec = io.exec ?? real.exec, fetch = io.fetch ?? real.fetch, now = io.now ?? Date.now;
  const wsl = await wslRunning(cfg.distro, { exec });
  const wslDefs = DEFS.filter((d) => d.unit);
  const [units, https, tasks] = await Promise.all([
    wsl ? systemdUnits(cfg.distro, wslDefs.map((d) => d.unit), { exec }).catch(() => null) : null,
    Promise.all(DEFS.filter((d) => d.url).map(async (d) => [d.id, await httpProbe(d.url, { fetch })])).then(Object.fromEntries),
    Promise.all(DEFS.filter((d) => d.task).map(async (d) => [d.id, await taskStatus(d.task, { exec })])).then(Object.fromEntries),
  ]);
  return DEFS.map((d) => ({ id: d.id, title: d.title, about: d.about, kind: d.kind, port: d.port ?? null, ...judge(d, { wsl, units, http: https[d.id], task: tasks[d.id], now: now() }) }));
}

/** Pure: probe results for one service -> { state, text, uptimeSec?, memMB? }. */
export function judge(d, { wsl, units, http, task, now }) {
  if (d.id === 'wsl') return wsl ? { state: 'ok', text: 'Running' } : { state: 'fail', text: 'Not running' };
  if (d.task) {
    if (!task?.exists) return d.optional ? { state: 'off', text: 'Not set up' } : { state: 'fail', text: 'Not registered' };
    return task.status === 'Running' ? { state: 'ok', text: 'Running' } : { state: d.optional ? 'warn' : 'warn', text: task.status ?? 'Unknown' };
  }
  if (!wsl) return { state: 'unknown', text: 'Unknown (WSL is down)' };
  if (!units) return { state: 'unknown', text: 'Could not read its state' };
  const u = units[d.unit];
  if (!u || u.LoadState === 'not-found') return { state: 'off', text: 'Not installed' };
  const since = parseSystemdTime(u.ActiveEnterTimestamp);
  const base = { uptimeSec: since ? Math.max(0, Math.round((now - since) / 1000)) : undefined, memMB: u.MemoryCurrent && /^\d+$/.test(u.MemoryCurrent) ? Math.round(Number(u.MemoryCurrent) / 1048576) : undefined, restarts: Number(u.NRestarts ?? 0) || 0 };
  if (u.ActiveState !== 'active') return { state: 'fail', text: u.ActiveState === 'activating' ? 'Starting' : 'Stopped', ...base, uptimeSec: undefined };
  if (d.url && !http?.ok) return { state: 'warn', text: 'Running but not answering', ...base };
  return { state: 'ok', text: 'Running', ...base };
}
