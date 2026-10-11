// Doctor: checks behind the problems that actually happened on this PC (docs/operations.md, M0/M1 notes).
// Read-only. A result may carry a `fix` ({service, action, label}); only safe, reversible service starts and restarts are
// ever offered, and applying one goes through the guarded action runner like any other action.
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { real, httpProbe } from './probes.mjs';
import { redact } from './redact.mjs';

export const toWslPath = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
const ok = (id, title, detail = '') => ({ id, title, status: 'ok', detail });
const warn = (id, title, detail, fix) => ({ id, title, status: 'warn', detail, ...(fix && { fix }) });
const fail = (id, title, detail, fix) => ({ id, title, status: 'fail', detail, ...(fix && { fix }) });
const svc = (state, id) => state.services.find((s) => s.id === id);

/** @param {{ settings:any, state:any, repo:string, io?:any }} ctx */
export async function runDoctor({ settings, state, repo, io = {} }) {
  const exec = io.exec ?? real.exec, fetch = io.fetch ?? real.fetch;
  const wslOk = svc(state, 'wsl')?.state === 'ok';
  const sh = (cmd, timeout = 15000) => exec('wsl.exe', ['-d', settings.distro, '--', 'bash', '-c', cmd], { timeout });
  const needsWsl = (id, title) => warn(id, title, 'Cannot be checked while WSL is not running.');

  const checks = [
    async () => wslOk ? ok('wsl', 'WSL is running') : fail('wsl', 'WSL is not running', 'Your agents and services are down.', { service: 'wsl', action: 'start', label: 'Start WSL' }),

    async () => {
      const k = svc(state, 'keepalive');
      if (k?.state === 'ok') return ok('keepalive', 'The keepalive task is running', 'WSL stays awake while you are away.');
      if (k?.text === 'Not registered') return fail('keepalive', 'The keepalive task is not registered', 'WSL may shut down when you are away.', undefined);
      return warn('keepalive', 'The keepalive task is not running', k?.text ?? '', { service: 'keepalive', action: 'start', label: 'Start the keepalive' });
    },

    ...[['paperclip', 'Paperclip'], ['jev', 'jev-router'], ['omniroute', 'OmniRoute']].map(([id, name]) => async () => {
      const s = svc(state, id);
      if (!wslOk) return needsWsl(id, `${name} is answering`);
      if (s?.state === 'ok') return ok(id, `${name} is running and answering`);
      return fail(id, `${name} is not healthy`, s?.text ?? 'Unknown', { service: id, action: s?.state === 'fail' ? 'start' : 'restart', label: `${s?.state === 'fail' ? 'Start' : 'Restart'} ${name}` });
    }),

    async () => {
      const lock = JSON.parse(readFileSync(join(repo, 'services.lock.json'), 'utf8'));
      const r = await fetch(`${settings.paperclip}/api/health`, { signal: AbortSignal.timeout(3000) }).then((x) => x.json()).catch(() => null);
      if (!r) return warn('paperclip-version', 'Paperclip version', 'Paperclip did not answer, so its version cannot be checked.');
      return r.version === lock.paperclip ? ok('paperclip-version', `Paperclip ${r.version} is the version the reconciler was built for`)
        : warn('paperclip-version', `Paperclip is ${r.version}; the reconciler was built for ${lock.paperclip}`, 'Run "stack doctor" before applying changes.');
    },

    async () => { const gb = state.disk?.cFreeGB; return gb == null ? warn('disk', 'C: free space', 'Could not read it.') : gb < 5 ? fail('disk', `C: has only ${gb} GB free`, "WSL's disk lives on C: and goes read-only when it fills up.") : gb < 15 ? warn('disk', `C: has ${gb} GB free`, 'Getting low. See docs/operations.md.') : ok('disk', `C: has ${gb} GB free`); },

    async () => {
      if (!wslOk) return needsWsl('claude-wsl', 'Claude is logged in (WSL)');
      const out = (await sh('"$HOME/.local/bin/claude" auth status', 20000).catch((e) => ({ stdout: e.stdout ?? '' }))).stdout;
      return /"loggedIn"\s*:\s*true/.test(out) ? ok('claude-wsl', 'Claude is logged in inside WSL', 'Agents can run.') : fail('claude-wsl', 'Claude is not logged in inside WSL', 'Agent runs will fail with an auth error. Open Ubuntu, run "claude" and log in.');
    },

    async () => {
      const out = (await exec('claude', ['auth', 'status'], { timeout: 20000 }).catch((e) => ({ stdout: e.stdout ?? '', missing: e.code === 'ENOENT' })));
      if (out.missing) return warn('claude-win', 'Claude Code is not installed on Windows', 'Only needed for Claude Code on Windows.');
      return /"loggedIn"\s*:\s*true/.test(out.stdout) ? ok('claude-win', 'Claude is logged in on Windows') : warn('claude-win', 'Claude is not logged in on Windows', 'Only needed for Claude Code on Windows. Run "claude" in PowerShell.');
    },

    async () => {
      if (!wslOk) return needsWsl('service-path', 'The Paperclip service can find claude');
      const r = await sh('grep -q ".local/bin" "$HOME/.config/systemd/user/paperclipai.service.d/path.conf"').then(() => true, () => false);
      return r ? ok('service-path', 'The Paperclip service can find claude') : fail('service-path', 'The Paperclip service cannot see ~/.local/bin', 'Agent runs fail with "Command not found: claude". Re-run install.ps1 -OnlyOrg (it rewrites the drop-in).');
    },

    async () => {
      if (!wslOk) return needsWsl('ids', 'The agent id file exists');
      return (await sh('test -f "$HOME/.agent-stack/ids.json"').then(() => true, () => false)) ? ok('ids', 'The agent id file exists') : warn('ids', 'The agent id file is missing', 'Run install.ps1 -OnlyOrg to recreate it.');
    },

    async () => {
      const d = mkdtempSync(join(tmpdir(), 'stack-sym-'));
      try { writeFileSync(join(d, 'a'), 'x'); symlinkSync(join(d, 'a'), join(d, 'b')); return ok('symlinks', 'Windows can create symbolic links', 'Native agent skills will load.'); }
      catch { return warn('symlinks', 'Windows cannot create symbolic links', 'Only matters for running agents natively on Windows: turn on Developer Mode.'); }
      finally { rmSync(d, { recursive: true, force: true }); }
    },

    async () => {
      if (!wslOk) return needsWsl('contract', 'The reconciler matches the Paperclip API');
      const r = await sh(`source ~/.nvm/nvm.sh >/dev/null 2>&1; node "${toWslPath(repo)}/apps/cli/stack.mjs" doctor 2>&1`, 30000).then((x) => ({ code: 0, out: x.stdout }), (e) => ({ code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }));
      return r.code === 0 ? ok('contract', 'The reconciler matches the Paperclip API') : fail('contract', 'The Paperclip API changed', redact(r.out.trim().split('\n').slice(-3).join(' ')).slice(0, 240));
    },
  ];

  const settled = await Promise.all(checks.map((c, i) => Promise.race([c(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 40000))]).catch((e) => warn(`check-${i}`, 'A check could not run', redact(e.message)))));
  const counts = settled.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  return { ranAt: new Date().toISOString(), results: settled, counts };
}
