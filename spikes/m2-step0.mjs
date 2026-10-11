// M2 step 0: what can a Windows-side Node process learn about the stack, how fast, and without admin rights?
// Read-only. Run on Windows:  node spikes/m2-step0.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfsSync } from 'node:fs';
const run = promisify(execFile);
const t = async (label, fn) => { const s = performance.now(); try { const v = await fn(); console.log(`\n## ${label}  (${Math.round(performance.now() - s)} ms)\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`); return v; } catch (e) { console.log(`\n## ${label}  FAILED (${Math.round(performance.now() - s)} ms)\n${String(e.message).slice(0, 300)}`); } };
const http = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(3000) }); const x = await r.text(); let j; try { j = JSON.parse(x) } catch { j = x.slice(0, 80) } return { status: r.status, body: j } };

await t('ports from Windows', async () => Object.fromEntries(await Promise.all([['paperclip', 'http://127.0.0.1:3100/api/health'], ['jev live view', 'http://127.0.0.1:4100/'], ['jev proxy', 'http://127.0.0.1:4000/'], ['omniroute', 'http://127.0.0.1:20128/']].map(async ([k, u]) => [k, await http(u).then((r) => r.status, (e) => `down (${e.cause?.code ?? e.name})`)]))));

await t('WSL state (wsl -l --running)', async () => (await run('wsl.exe', ['-l', '--running', '-q'], { encoding: 'utf16le' })).stdout.replace(/\0/g, '').trim());

await t('systemd units in one wsl.exe call', async () => {
  const { stdout } = await run('wsl.exe', ['-d', 'Ubuntu-24.04', '--', 'systemctl', '--user', 'show', 'paperclipai', 'jev-router', 'omniroute', 'agent-watchdog.timer',
    '--property=Id,ActiveState,SubState,ActiveEnterTimestamp,MemoryCurrent,NRestarts'], { encoding: 'utf8' });
  return stdout.trim().split(/\r?\n\r?\n/).map((b) => Object.fromEntries(b.split(/\r?\n/).map((l) => l.split(/=(.*)/s).slice(0, 2))));
});

await t('keepalive task via schtasks (no admin)', async () => (await run('schtasks.exe', ['/query', '/tn', 'WSL-Agents-Keepalive', '/fo', 'LIST']).then((r) => r.stdout.split(/\r?\n/).filter((l) => /Status|Last Run|Next Run/.test(l)).join('\n'))));

await t('disk free on C:', async () => { const s = statfsSync('C:\\'); return `${(s.bavail * s.bsize / 1e9).toFixed(1)} GB free of ${(s.blocks * s.bsize / 1e9).toFixed(0)} GB`; });

const cid = await t('company id', async () => (await http('http://127.0.0.1:3100/api/companies')).body[0].id);
if (cid) {
  const api = `http://127.0.0.1:3100/api/companies/${cid}`;
  await t('agents list (fields the crew needs)', async () => { const a = (await http(`${api}/agents`)).body; return { count: a.length, sample: a.slice(0, 2).map((x) => ({ name: x.name, status: x.status, pauseReason: x.pauseReason, lastHeartbeatAt: x.lastHeartbeatAt, palette: x.appearance?.paletteId })) }; });
  await t('heartbeat-runs shape and size', async () => { const r = (await http(`${api}/heartbeat-runs`)).body; const L = Array.isArray(r) ? r : (r.items ?? r.runs ?? []); return { topLevel: Array.isArray(r) ? 'array' : Object.keys(r), count: L.length, first: L[0] && { status: L[0].status, agentId: !!L[0].agentId, createdAt: L[0].createdAt, finishedAt: L[0].finishedAt, cost: L[0].usageJson?.costUsd, billing: L[0].usageJson?.billingType }, hasNextCursor: !Array.isArray(r) && 'nextCursor' in r }; });
  await t('live runs endpoint', async () => { const r = await http(`${api}/live-runs`); return { status: r.status, sample: JSON.stringify(r.body).slice(0, 200) }; });
  const spec = (await http('http://127.0.0.1:3100/api/openapi.json')).body.paths;
  await t('approvals and cost paths', async () => Object.keys(spec).filter((p) => /approval|costs?\b|spend|budget/i.test(p) && /companies\/\{companyId\}/.test(p)).slice(0, 14));
  await t('pending approvals', async () => { const r = await http(`${api}/approvals?status=pending`); return { status: r.status, sample: JSON.stringify(r.body).slice(0, 200) }; });
}
