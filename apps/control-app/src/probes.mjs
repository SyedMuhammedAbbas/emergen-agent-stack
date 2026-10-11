// Low-level, read-only probes of the machine. Every external call (HTTP, child process, disk) is injectable so the
// logic above can be tested without WSL or Windows. Shapes verified on this PC in spikes/m2-step0.mjs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfsSync } from 'node:fs';

const pexec = promisify(execFile);
export const real = {
  exec: (cmd, args, opts = {}) => pexec(cmd, args, { timeout: 8000, windowsHide: true, ...opts }),
  fetch: (...a) => globalThis.fetch(...a),
  statfs: statfsSync,
};

/** @returns {Promise<{ok:boolean, status?:number, ms:number, error?:string}>} any status below 500 means "something answers". */
export async function httpProbe(url, { fetch = real.fetch, timeoutMs = 2500 } = {}) {
  const t = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: r.status < 500, status: r.status, ms: Date.now() - t };
  } catch (e) { return { ok: false, ms: Date.now() - t, error: e.cause?.code ?? e.name }; }
}

/** `wsl.exe -l --running -q` prints UTF-16. */
export async function wslRunning(distro, { exec = real.exec } = {}) {
  try {
    const { stdout } = await exec('wsl.exe', ['-l', '--running', '-q'], { encoding: 'utf16le' });
    return stdout.replace(/\0/g, '').split(/\r?\n/).map((s) => s.trim()).includes(distro);
  } catch { return false; }
}

/** `systemctl show a b c` prints one block of KEY=value lines per unit, separated by a blank line. */
export function parseSystemdShow(text) {
  return text.trim().split(/\r?\n\s*\r?\n/).filter(Boolean).map((block) =>
    Object.fromEntries(block.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })));
}

/** "Sun 2026-10-11 20:41:48 PKT" -> ms since epoch, read as this machine's local time (WSL shares the Windows time zone). */
export function parseSystemdTime(s) {
  const m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s ?? '');
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}

/** One wsl.exe call for all units. Returns { 'paperclipai.service': {ActiveState,...} | missing }. */
export async function systemdUnits(distro, units, { exec = real.exec } = {}) {
  const { stdout } = await exec('wsl.exe', ['-d', distro, '--', 'systemctl', '--user', 'show', ...units,
    '--property=Id,ActiveState,SubState,ActiveEnterTimestamp,MemoryCurrent,NRestarts,LoadState'], { encoding: 'utf8' });
  return Object.fromEntries(parseSystemdShow(stdout).map((u) => [u.Id, u]));
}

/** `schtasks /query /tn X /fo LIST` works without admin. Missing task -> { exists:false }. */
export function parseSchtasks(text) {
  const get = (k) => new RegExp(`^${k}:\\s*(.*)$`, 'mi').exec(text)?.[1]?.trim();
  return { exists: true, status: get('Status'), nextRun: get('Next Run Time') };
}
export async function taskStatus(name, { exec = real.exec } = {}) {
  try { return parseSchtasks((await exec('schtasks.exe', ['/query', '/tn', name, '/fo', 'LIST'])).stdout); }
  catch { return { exists: false }; }
}

export function diskFreeGB(path = 'C:\\', { statfs = real.statfs } = {}) {
  try { const s = statfs(path); return Math.round((s.bavail * s.bsize) / 1e8) / 10; } catch { return null; }
}
