// Last lines of a service's log, redacted. Systemd units come from the journal; Windows tasks show their schtasks status.
import { real } from './probes.mjs';
import { redact } from './redact.mjs';

export const LOG_UNITS = { paperclip: 'paperclipai.service', jev: 'jev-router.service', omniroute: 'omniroute.service', watchdog: 'agent-watchdog.service' };

export async function readLogs(service, settings, { exec = real.exec, lines = 40 } = {}) {
  const unit = Object.hasOwn(LOG_UNITS, service) ? LOG_UNITS[service] : null;   // own keys only (service comes from the request)
  if (unit) {
    try {
      const { stdout } = await exec('wsl.exe', ['-d', settings.distro, '--', 'journalctl', '--user', '-u', unit, '-n', String(lines), '--no-pager', '-o', 'short-iso'], { timeout: 15000 });
      return { service, text: redact(stdout).trimEnd() || '(no log lines yet)' };
    } catch (e) { return { service, text: `Could not read the log: ${redact(e.message).slice(0, 200)}` }; }
  }
  const tasks = { keepalive: 'WSL-Agents-Keepalive', hermes: 'Hermes_Gateway' };
  if (Object.hasOwn(tasks, service)) {
    try { return { service, text: redact((await exec('schtasks.exe', ['/query', '/tn', tasks[service], '/fo', 'LIST', '/v'])).stdout).trim() }; }
    catch { return { service, text: 'This scheduled task is not registered.' }; }
  }
  return { service, text: 'No log is available for this service.' };
}
