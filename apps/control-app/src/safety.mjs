// Secrets and backups. Read-only except two audited actions: a leak scan (writes only its own result file) and a database backup.
//   inventory: where the stack keeps secrets, their permissions, whether they are git-ignored. Paths only, never contents.
//   leak scan: secret-shaped strings where secrets do NOT belong (tracked files, the app's data, WSL state, logs). Reports file/line/kind only.
//   backups  : Paperclip's own database backups (listed), "Back up now" (paperclipai db:backup), optional copy to a folder you choose.
import { existsSync, readdirSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { real } from './probes.mjs';
import { redact } from './redact.mjs';
import { scanFiles, walk } from './secretscan.mjs';
import { toWslPath } from './doctor.mjs';

// ---------------------------------------------------------------- inventory
export const WSL_SECRET_FILES = [
  { id: 'jev-env', path: '~/.config/jev-router/env', what: 'OpenRouter key for jev-router', dir: false },
  { id: 'jev-setup', path: '~/.config/jev-router/setup.json', what: 'jev-router setup', dir: false },
  { id: 'pc-env', path: '~/.paperclip/instances/default/.env', what: 'Paperclip signing secrets', dir: false },
  { id: 'pc-key', path: '~/.paperclip/instances/default/secrets/master.key', what: 'Paperclip secrets key', dir: false },
  { id: 'gh', path: '~/.config/gh/hosts.yml', what: 'GitHub login', dir: false },
  { id: 'claude-wsl', path: '~/.claude/.credentials.json', what: 'Claude login (WSL)', dir: false },
  { id: 'omniroute', path: '~/.omniroute', what: 'OmniRoute data (can hold provider keys)', dir: true },
];
const CRED_FOLDER = /credential|secret|password|passwd|api[-_ ]?key|token/i;

/** Pure: stat lines "mode|type|path" -> inventory rows. Files must not be group/other readable; directories must not be world-accessible. */
export function judgeWslFiles(statOut) {
  const got = new Map(String(statOut).split('\n').filter(Boolean).map((l) => { const [mode, type, path] = l.split('|'); return [path, { mode, type }]; }));
  return WSL_SECRET_FILES.map((f) => {
    const g = got.get(f.path);
    if (!g) return { id: f.id, where: 'WSL', path: f.path, what: f.what, state: 'absent', note: 'Not present.' };
    const m = parseInt(g.mode, 8), tooOpen = f.dir ? (m & 0o007) !== 0 : (m & 0o077) !== 0;
    return { id: f.id, where: 'WSL', path: f.path, what: f.what, mode: g.mode, state: tooOpen ? 'warn' : 'ok', note: tooOpen ? `Readable by other users (mode ${g.mode}). Run: chmod ${f.dir ? '700' : '600'} ${f.path}` : `Private to you (mode ${g.mode}).` };
  });
}

/** Pure: names only. Folders whose NAME looks like they hold credentials, found next to where files get downloaded or saved. */
export function credentialFolders(listing) {
  return listing.filter((x) => x.isDir && CRED_FOLDER.test(x.name)).map((x) => ({ id: 'cred:' + x.path, where: 'Windows', path: x.path, what: 'A folder named like it holds credentials', state: 'warn', note: 'Its contents were not read. Keep real passwords in a password manager, and rotate anything saved in plain text here.' }));
}

export async function readInventory(settings, { exec = real.exec, fs = { exists: existsSync, readdir: (d) => readdirSync(d, { withFileTypes: true }) }, env = process.env } = {}) {
  const items = [];
  // one stat per path, with the label printed by us (the paths come from the fixed list above, never from a request)
  const script = WSL_SECRET_FILES.map((f) => `p="${f.path.replace('~', '$HOME')}"; [ -e "$p" ] && printf '%s|%s|%s\\n' "$(stat -c %a "$p")" "$(stat -c %F "$p")" '${f.path}'`).join('; ');
  const out = await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', script], { timeout: 10000 }).then((r) => r.stdout, () => null);
  if (out === null) items.push({ id: 'wsl-unreadable', where: 'WSL', path: '(WSL files)', what: 'Secret files inside WSL', state: 'unknown', note: 'WSL is not reachable, so these could not be checked.' });
  else items.push(...judgeWslFiles(out));
  // Windows side
  const repo = settings.repo;
  if (repo) {
    const cfg = join(repo, 'config.env'), has = fs.exists(cfg);
    const ignored = has ? await exec('git', ['check-ignore', '-q', 'config.env'], { cwd: repo }).then(() => true, () => false) : null;
    items.push({ id: 'config-env', where: 'Windows', path: cfg, what: 'Your personal settings (ids, names, schedules)', state: !has ? 'absent' : ignored ? 'ok' : 'warn', note: !has ? 'Not present.' : ignored ? 'Excluded from git.' : 'NOT excluded from git: add config.env to .gitignore.' });
  }
  for (const [id, p, what] of [['hermes-env', join(env.LOCALAPPDATA ?? '', 'hermes', '.env'), 'Hermes bridge tokens (Odoo, Discord)'], ['claude-win', join(env.USERPROFILE ?? '', '.claude', '.credentials.json'), 'Claude login (Windows)']]) {
    const has = fs.exists(p); items.push({ id, where: 'Windows', path: p, what, state: has ? 'ok' : 'absent', note: has ? 'Present. Windows file permissions are not checked by this app.' : 'Not present.' });
  }
  const roots = ['Downloads', 'Desktop', 'Documents'].map((d) => join(env.USERPROFILE ?? '', d)), found = [];
  for (const r of roots) { let es = []; try { es = fs.readdir(r); } catch { /* folder missing */ } for (const e of es) found.push({ name: e.name, path: join(r, e.name), isDir: e.isDirectory() }); }
  items.push(...credentialFolders(found));
  return items;
}

// ---------------------------------------------------------------- leak scan
const WSL_IGNORE_NOTE = 'secrets in their proper place (Paperclip instance .env and secrets/) are covered by the inventory, not reported as leaks';
export async function runLeakScan(settings, { exec = real.exec, appDir, now = () => new Date(), cliPath } = {}) {
  const scopes = [], findings = []; const add = (scope, r) => { scopes.push({ name: scope, scanned: r.scanned, count: r.findings.length }); for (const f of r.findings) findings.push({ scope, ...f }); };
  const repo = settings.repo;
  if (repo) {
    const files = await exec('git', ['ls-files'], { cwd: repo, maxBuffer: 50 * 1024 * 1024 }).then((r) => r.stdout.split('\n').filter(Boolean).map((f) => join(repo, f)), () => []);
    add('Repository (tracked files)', scanFiles(files, { root: repo }));
  }
  if (appDir) add('App data on Windows', scanFiles(walk(appDir), { root: appDir, ignore: ['secret-scan.json'] }));
  const cli = cliPath ?? (repo ? toWslPath(join(repo, 'apps', 'control-app', 'src', 'secretscan-cli.mjs')) : null);
  if (cli) {
    const run = async (cmd, label, timeout) => { try { const o = await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', cmd], { timeout, maxBuffer: 20 * 1024 * 1024 }); const j = JSON.parse(o.stdout); add(label, { scanned: j.scanned, findings: j.findings.map((f) => ({ file: f.file, line: f.line, kind: f.kind })) }); } catch (e) { scopes.push({ name: label, scanned: 0, count: 0, error: redact(e.message).slice(0, 100) }); } };
    await run(`source ~/.nvm/nvm.sh >/dev/null 2>&1; node "${cli}" "$HOME/.agent-stack" "$HOME/.local/state/jev-router"`, 'Reconciler state and router log (WSL)', 60000);
    await run(`source ~/.nvm/nvm.sh >/dev/null 2>&1; journalctl --user -u paperclipai -u jev-router -u omniroute -n 5000 --no-pager 2>/dev/null | node "${cli}" --stdin "service logs"`, 'Service logs (WSL journal)', 60000);
  }
  const result = { ranAt: now().toISOString(), scopes, total: findings.length, findings: findings.slice(0, 200), truncated: findings.length > 200, note: WSL_IGNORE_NOTE };
  if (appDir) { try { mkdirSync(appDir, { recursive: true }); writeFileSync(join(appDir, 'secret-scan.json'), JSON.stringify(result)); } catch { /* the result is still returned */ } }
  return result;
}
export const lastScan = (appDir) => { try { return JSON.parse(readFileSync(join(appDir, 'secret-scan.json'), 'utf8')); } catch { return null; } };

// ---------------------------------------------------------------- backups
const BACKUP_DIR_CMD = `jq -r '.database.backup | "\\(.dir)|\\(.enabled)|\\(.intervalMinutes)|\\(.retentionDays)"' "$HOME/.paperclip/instances/default/config.json" 2>/dev/null`;
/** Pure: `ls -l --time-style=long-iso` lines -> backups, newest first. */
export function parseBackupList(text) {
  return String(text).split('\n').map((l) => /^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/.exec(l.trim())).filter(Boolean)
    .map((m) => ({ name: m[4], bytes: Number(m[1]), at: new Date(`${m[2]}T${m[3]}:00`).toISOString() })).filter((b) => /\.sql(\.gz)?$/.test(b.name)).sort((a, b) => new Date(b.at) - new Date(a.at));
}
export async function listBackups(settings, { exec = real.exec } = {}) {
  try {
    const cfg = (await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', BACKUP_DIR_CMD], { timeout: 10000 })).stdout.trim().split('|');
    const [dir, enabled, every, keep] = cfg; if (!dir) return { available: false, error: 'Paperclip backup settings not found.' };
    const ls = (await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', 'ls -l --time-style=long-iso -- "$1"', '_', dir], { timeout: 10000 })).stdout;
    const list = parseBackupList(ls);
    return { available: true, dir, automatic: enabled === 'true', everyMinutes: Number(every) || null, keepDays: Number(keep) || null, backups: list.slice(0, 12), count: list.length, totalBytes: list.reduce((n, b) => n + b.bytes, 0), copyDir: settings.backupCopyDir ?? null };
  } catch (e) { return { available: false, error: redact(e.message).slice(0, 120) }; }
}
/** A Windows path that is safe to hand to cp as a plain argument (no control characters; a drive-letter absolute path). */
export const okCopyDir = (p) => typeof p === 'string' && /^[A-Za-z]:[\\/][^\u0000-\u001f"<>|?*]*$/.test(p);

export async function runBackup(settings, { exec = real.exec } = {}) {
  const out = await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', 'source ~/.nvm/nvm.sh >/dev/null 2>&1; paperclipai db:backup --json'], { timeout: 180000 });
  let meta = {}; try { meta = JSON.parse(out.stdout.slice(out.stdout.indexOf('{'))); } catch { /* not JSON: the listing will show the new file */ }
  const file = meta.path ?? meta.file ?? meta.backupPath ?? null;
  let copied = null;
  if (settings.backupCopyDir && okCopyDir(settings.backupCopyDir) && file && /^\/[\w./-]+$/.test(file)) {
    await exec('wsl.exe', ['-d', settings.distro, '--exec', 'bash', '-c', 'mkdir -p -- "$2" && cp -- "$1" "$2"/', '_', file, toWslPath(settings.backupCopyDir)], { timeout: 120000 }).then(() => { copied = settings.backupCopyDir; }, () => { copied = false; });
  }
  return { file, copied };
}

// ---------------------------------------------------------------- the two audited actions
import { basename } from 'node:path';
export function createSafetyActions({ settings, audit, io = {}, appDir, refresh = async () => {}, now = Date.now, cooldownMs = 5000 }) {
  let inflight = null, last = -Infinity;   // not 0: the cool-down must not depend on how large the clock value is
  async function run({ action }) {
    if (action !== 'scan' && action !== 'backup') return { status: 400, error: 'That action is not available.' };
    if (inflight) return { status: 409, error: 'Another safety action is still running. Wait for it to finish.' };
    if (now() - last < cooldownMs) return { status: 429, error: 'Please wait a moment before running that again.' };
    const t0 = now();
    inflight = (async () => {
      try {
        const r = action === 'scan' ? await runLeakScan(settings, { exec: io.exec, appDir }) : await runBackup(settings, { exec: io.exec });
        await refresh().catch(() => {});
        audit.add({ service: 'safety', action, ok: true, ms: now() - t0, ...(action === 'scan' ? { findings: r.total } : { file: r.file ? basename(r.file) : null, copied: r.copied === null ? null : Boolean(r.copied) }) });
        return { status: 200, ok: true, result: r };
      } catch (e) {
        audit.add({ service: 'safety', action, ok: false, ms: now() - t0, error: e.message });
        return { status: 500, ok: false, error: redact(String(e.message)).slice(0, 200) };
      } finally { last = now(); inflight = null; }
    })();
    return inflight;
  }
  return { run };
}
