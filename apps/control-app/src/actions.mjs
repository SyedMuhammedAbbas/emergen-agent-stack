// State-changing actions on services. The browser sends { service, action }; everything else is fixed here.
//  - allow-list: only the service/action pairs in CONTROL exist; nothing is built from user input
//  - busy guard: stopping or restarting a service agents depend on needs `force` while agents are working
//  - one action at a time, a short cool-down per service, every attempt written to the audit log
import { real, taskStatus } from './probes.mjs';
import { redact } from './redact.mjs';

export const CONTROL = {
  paperclip: { kind: 'systemd', unit: 'paperclipai.service', actions: ['start', 'stop', 'restart'], busyGuard: true },
  jev: { kind: 'systemd', unit: 'jev-router.service', actions: ['start', 'stop', 'restart'], busyGuard: true },
  omniroute: { kind: 'systemd', unit: 'omniroute.service', actions: ['start', 'stop', 'restart'], busyGuard: true },
  keepalive: { kind: 'task', task: 'WSL-Agents-Keepalive', actions: ['start'] },
  wsl: { kind: 'wsl', actions: ['start'] },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expected = (action) => (action === 'stop' ? ['fail', 'unknown', 'off'] : ['ok']);

export function createActions({ settings, store, audit, io = {}, control = CONTROL, wait = sleep, cooldownMs = 2000, settleMs = 20000, pollMs = 1500, now = Date.now }) {
  const exec = io.exec ?? real.exec;
  let inflight = null; const last = new Map();

  async function execute(def, action) {
    if (def.kind === 'systemd') return exec('wsl.exe', ['-d', settings.distro, '--', 'systemctl', '--user', action, def.unit], { timeout: 30000 });
    if (def.kind === 'task') return exec('schtasks.exe', ['/run', '/tn', def.task]);
    // wsl: the keepalive task starts the distro and holds it; without it, a one-shot command still wakes WSL
    const ka = await taskStatus(control.keepalive?.task ?? 'WSL-Agents-Keepalive', { exec });
    return ka.exists ? exec('schtasks.exe', ['/run', '/tn', control.keepalive.task]) : exec('wsl.exe', ['-d', settings.distro, '--exec', 'true'], { timeout: 60000 });
  }

  async function run({ service, action, force: rawForce }) {
    const force = rawForce === true;   // only a literal true skips the busy guard
    const def = Object.hasOwn(control, service) ? control[service] : null;   // own keys only: never reach __proto__ and friends
    if (!def || !def.actions.includes(action)) return { status: 400, error: 'That action is not available for this service.' };
    if (def.busyGuard && (action === 'stop' || action === 'restart') && !force) {
      const working = ((await store.get()).crew ?? []).filter((c) => c.mood === 'working').length;
      if (working > 0) return { status: 409, needsConfirm: 'busy', working, error: `${working} agent${working > 1 ? 's are' : ' is'} working right now.` };
    }
    if (inflight) return { status: 409, error: 'Another action is still running. Wait for it to finish.' };
    if (now() - (last.get(service) ?? 0) < cooldownMs) return { status: 429, error: 'That service was just changed. Give it a moment.' };

    const t0 = now();
    inflight = (async () => {
      let err = null;
      try { await execute(def, action); } catch (e) { err = e.stderr?.toString().trim() || e.message; }
      let final = null;
      if (!err) {
        const deadline = now() + settleMs;
        for (;;) { final = (await store.refresh()).services.find((s) => s.id === service); if (final && expected(action).includes(final.state)) break; if (now() > deadline) break; await wait(pollMs); }
      } else await store.refresh().catch(() => {});
      const ok = !err && Boolean(final) && expected(action).includes(final.state);
      const detail = err ? redact(err) : ok ? undefined : `Did not reach the expected state within ${Math.round(settleMs / 1000)} s (now: ${final?.text ?? 'unknown'}).`;
      audit.add({ service, action, forced: Boolean(force), ok, ms: now() - t0, finalState: final?.state, ...(detail ? { error: detail } : {}) });
      return { status: ok ? 200 : 500, ok, state: final, ...(detail ? { error: detail } : {}) };
    })().finally(() => { last.set(service, now()); inflight = null; });
    return inflight;
  }
  return { run, controllable: (id) => control[id]?.actions ?? [] };
}
