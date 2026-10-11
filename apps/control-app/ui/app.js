// Agent Stack control app UI (M2.1: Home and Services, read-only). Renders what /api/state reports; nothing is invented here.
import { crab, crabSvg, profileOf, ACCENT } from './crab.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const $ = (id) => document.getElementById(id);

// ---- token: from the link the server printed, kept for this tab only, then removed from the address bar ----
let token = null;
try { token = new URLSearchParams(location.search).get('t') || sessionStorage.getItem('stack-token'); if (token) sessionStorage.setItem('stack-token', token); } catch { /* storage blocked: the link must be opened again after a reload */ }
if (location.search.includes('t=')) history.replaceState(null, '', location.pathname + location.hash);

let lastKey = null;
let S = null, failure = null, THEME = ''; try { THEME = localStorage.getItem('theme') || ''; } catch { /* no storage */ }
const DEPTS = [['engineering', 'Engineering'], ['operations', 'Operations'], ['branding', 'Branding'], ['freelance', 'Freelance']];

// ---- formatting ----
const ago = (iso) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000)); return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const dur = (s) => (s == null ? '' : s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 86400)} d`);
const usd = (n) => '$' + (n ?? 0).toFixed(2);
const mem = (mb) => (mb == null ? '' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

// ---- status lamps: a shape and a word, never colour alone ----
const LAMP = { ok: ['ok', 'Running'], warn: ['warn', 'Needs a look'], fail: ['fail', 'Stopped'], off: ['off', 'Not set up'], unknown: ['off', 'Unknown'] };
const lamp = (state, text) => { const [c, d] = LAMP[state] ?? LAMP.unknown; return `<span class="lamp ${c}"><i></i>${esc(text ?? d)}</span>`; };

// ---- screens ----
function hero() {
  const h = S.headline, n = h.needCount;
  const tail = n ? ` <a href="#/home-needs">${n} thing${n > 1 ? 's' : ''} need${n > 1 ? '' : 's'} you</a>.` : '';
  return `<div aria-live="polite"><h1>${esc(h.text)}${tail}</h1></div>`;
}
function subline() {
  if (!S.paperclip.up) return 'Paperclip is not reachable, so run and spend figures are unavailable.';
  const working = S.crew.filter((c) => c.mood === 'working').length;
  return `${S.runs.today} run${S.runs.today === 1 ? '' : 's'} today, ${working} agent${working === 1 ? '' : 's'} working. ${usd(S.spend.monthUsd)} spent this month.`;
}
function svcDetail(s) {
  return [s.port ? `port <span class="mono">${s.port}</span>` : s.kind, s.state === 'ok' && s.uptimeSec != null ? `up <span class="mono">${dur(s.uptimeSec)}</span>` : '', s.state === 'ok' && s.memMB != null ? `<span class="mono">${mem(s.memMB)}</span>` : ''].filter(Boolean).join(' · ');
}
function needsCard() {
  const items = S.needs.map((x) => `<li><span class="lamp ${x.level}"><i></i><span class="sr">${x.level === 'fail' ? 'Problem' : 'Attention'}</span></span><div><p><b>${esc(x.title)}</b></p><p class="why">${esc(x.why)}</p><p class="hint">${esc(x.hint)}</p></div><div>${fixButton(x.fix)}</div></li>`).join('');
  return `<section class="card" id="needs" aria-labelledby="h-need"><h2 id="h-need">Needs you</h2>${items ? `<ul class="need">${items}</ul>` : `<p class="empty">${lamp('ok', 'Nothing needs you right now.')}</p>`}</section>`;
}
function spendCard() {
  const p = S.spend;
  if (!p) return `<section class="card" aria-labelledby="h-cost"><h2 id="h-cost">Spend this month</h2><p class="hint">Not available while Paperclip is unreachable.</p></section>`;
  return `<section class="card" aria-labelledby="h-cost"><h2 id="h-cost">Spend this month</h2>
    <div><span class="big">${usd(p.monthUsd)}</span> <span class="of">of $${p.budgetUsd}</span></div>
    <div class="meter" role="img" aria-label="${p.pct} percent of the monthly budget used; alert at ${Math.round(p.alertAt * 100)} percent"><span style="width:${p.pct}%"></span><em style="left:${p.alertAt * 100}%"></em></div>
    <div class="legend"><span><i style="background:var(--clay)"></i>Billed to API <b class="mono">${usd(p.apiUsd)}</b></span><span><i style="background:repeating-linear-gradient(135deg,var(--ink-3) 0 2px,transparent 2px 5px)"></i>Covered by subscriptions <b class="mono">${usd(p.subscriptionUsd)}</b></span></div>
    <p class="tiles-note">${p.projectedUsd == null ? 'Too early in the month for a projection.' : `On pace for about $${p.projectedUsd} by the end of the month.`}</p></section>`;
}
function crewCard() {
  const byDept = (k) => S.crew.filter((a) => profileOf(a.name)[0] === k);
  const word = { working: 'working', idle: 'idle', paused: 'paused', error: 'needs attention' };
  const groups = DEPTS.map(([k, n]) => { const list = byDept(k); return list.length ? `<div class="dept" style="--c:${ACCENT[k]}"><h3>${n}</h3><div class="crabs">${list.map((a) => `<span class="crabbtn" title="${esc(a.name)}, ${word[a.mood]}">${crabSvg(a.name, a.mood, `${a.name}, ${word[a.mood]}`)}</span>`).join('')}</div></div>` : ''; }).join('');
  return `<section class="card" aria-labelledby="h-crew"><h2 id="h-crew">Crew <a href="#/team">Open Team</a></h2>${S.crew.length ? `<div class="crew">${groups}</div><p class="tiles-note">The same crabs as the Claude mod. Walking means working, dim means idle, red means it needs attention.</p>` : '<p class="hint">No agents to show.</p>'}</section>`;
}
function recentCard() {
  const word = { succeeded: ['ok', 'Succeeded'], failed: ['fail', 'Failed'], running: ['ok', 'Working'], queued: ['idle', 'Queued'], cancelled: ['off', 'Cancelled'] };
  const rows = S.recent.map((r) => { const [k, t] = word[r.status] ?? ['off', r.status]; return `<div class="row" style="grid-template-columns:48px minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.5fr)"><span style="width:42px">${crabSvg(r.agent, r.status === 'running' ? 'working' : r.status === 'failed' ? 'error' : 'idle')}</span><span><span class="t">${esc(r.agent)}</span></span><span>${lamp(k === 'idle' ? 'off' : k, t)}</span><span class="s mono-s" style="text-align:right;white-space:nowrap">${ago(r.at)}${r.costUsd != null ? `<br>${usd(r.costUsd)}${r.subscription ? ' · subscription' : ''}` : ''}</span></div>`; }).join('');
  return `<section class="card flush" aria-labelledby="h-act"><div style="padding:18px 18px 4px"><h2 id="h-act">Recent runs</h2></div>${rows ? `<div class="rows">${rows}</div>` : '<p class="hint" style="padding:0 18px 18px">No runs yet.</p>'}</section>`;
}
function home() {
  return `<div class="topline"><span id="checked">Checked ${ago(S.checkedAt)}</span><span class="mono">${new Date().toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
  ${hero()}<p class="sub">${esc(subline())}</p>
  <div class="grid" style="gap:22px">
    <section aria-labelledby="h-svc"><h2 id="h-svc">Services</h2><div class="tiles">${S.services.map((s) => `<a class="tile ${s.state === 'fail' ? 'is-fail' : s.state === 'warn' ? 'is-warn' : ''}" href="#/services"><span class="n">${esc(s.title)}</span>${lamp(s.state, s.text)}<span class="d">${svcDetail(s)}</span></a>`).join('')}</div></section>
    <div class="grid g2">${needsCard()}${spendCard()}</div>
    ${crewCard()}${recentCard()}</div>`;
}
// ---- actions: confirm, run, report. The server enforces the allow-list and the busy guard; this only asks politely first ----
let BUSY = false, DOCTOR = null, AUDIT = [], LOGS = {};
async function api(path, body) {
  const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'x-stack-token': token ?? '', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let json = {}; try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}
function toast(msg, bad) {
  const n = document.createElement('div'); n.textContent = msg; n.setAttribute('role', bad ? 'alert' : 'status');
  n.style.cssText = `position:fixed;left:50%;bottom:76px;transform:translateX(-50%);background:${bad ? 'var(--fail)' : 'var(--ink)'};color:${bad ? '#fff' : 'var(--on-ink)'};padding:10px 18px;border-radius:99px;z-index:60;font-size:14px;max-width:calc(100vw - 32px)`;
  document.body.append(n); setTimeout(() => n.remove(), bad ? 6000 : 2600);
}
function confirmDialog({ title, message, label, danger }) {
  return new Promise((resolve) => {
    const d = $('dlg');
    d.innerHTML = `<h3>${esc(title)}</h3><p>${esc(message)}</p><div class="acts"><button class="btn" type="button" data-x>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-ok>${esc(label)}</button></div>`;
    d.onclose = () => resolve(d.returnValue === 'ok');
    d.querySelector('[data-x]').onclick = () => d.close('cancel'); d.querySelector('[data-ok]').onclick = () => d.close('ok');
    d.showModal(); d.querySelector('[data-x]').focus();
  });
}
const EFFECT = {
  stop: { paperclip: 'Agents stop taking work and any run in progress ends. Tasks stay queued and resume when it is started again.', jev: "Engineers' Claude requests fail until it is back.", omniroute: 'Non-Claude models are unavailable until it is back.' },
  restart: { _: 'This takes about 10 seconds. Runs in progress may be interrupted.' },
  start: { wsl: 'Starts Ubuntu and the services in it. About 20 seconds.', keepalive: 'Starts the task that keeps WSL awake.', _: 'Starts it now.' },
};
const VERB = { start: ['Start', 'Started'], stop: ['Stop', 'Stopped'], restart: ['Restart', 'Restarted'] };
async function doAction(service, action, force = false) {
  if (BUSY) return;
  const svc = S.services.find((s) => s.id === service), [verb, done] = VERB[action];
  BUSY = true; paint();
  try {
    const { status, json } = await api('/api/action', { service, action, force });
    if (status === 409 && json.needsConfirm === 'busy') {
      BUSY = false; paint();
      const go = await confirmDialog({ title: `${verb} ${svc.title} anyway?`, message: `${json.working} agent${json.working > 1 ? 's are' : ' is'} working right now. ${(EFFECT[action][service] ?? EFFECT[action]._)}`, label: `${verb} anyway`, danger: true });
      if (go) return doAction(service, action, true);
      return;
    }
    if (json.ok) toast(`${done} ${svc.title}.`); else toast(json.error ?? 'That did not work.', true);
  } catch { toast('The control app did not answer.', true); }
  BUSY = false; await load(); loadAudit();
}
async function askAction(service, action) {
  const svc = S.services.find((s) => s.id === service), [verb] = VERB[action];
  if (await confirmDialog({ title: `${verb} ${svc.title}?`, message: EFFECT[action][service] ?? EFFECT[action]._, label: verb, danger: action === 'stop' })) doAction(service, action);
}
async function loadAudit() { try { const r = await api('/api/audit?n=8'); if (Array.isArray(r.json)) { AUDIT = r.json; if (route() === 'services') paint(); } } catch { /* optional */ } }
async function toggleLogs(id) {
  if (LOGS[id] !== undefined) { delete LOGS[id]; return paint(); }
  LOGS[id] = 'Loading…'; paint();
  const r = await api(`/api/logs?service=${encodeURIComponent(id)}`); LOGS[id] = r.json.text ?? 'No log is available.'; paint();
}
async function runDoctorNow() { DOCTOR = { running: true }; paint(); const r = await api('/api/doctor', {}); DOCTOR = r.status === 200 ? r.json : { error: true }; paint(); }

function actionButtons(s) {
  const dis = BUSY ? 'disabled' : '', b = [];
  const up = s.state === 'ok' || s.state === 'warn';
  if (s.actions.includes('restart') && up) b.push(`<button class="btn small" data-act="restart:${s.id}" ${dis} type="button">Restart</button>`);
  if (s.actions.includes('stop') && up) b.push(`<button class="btn small danger" data-act="stop:${s.id}" ${dis} type="button">Stop</button>`);
  if (s.actions.includes('start') && (s.state === 'fail' || (['wsl', 'keepalive'].includes(s.id) && s.state !== 'ok'))) b.push(`<button class="btn small primary" data-act="start:${s.id}" ${dis} type="button">Start</button>`);
  if (s.hasLogs) b.push(`<button class="btn small" data-logs="${s.id}" type="button" aria-expanded="${LOGS[s.id] !== undefined}">Logs</button>`);
  return b.join('');
}
const fixButton = (fix) => (fix ? `<button class="btn small primary" data-act="${fix.action}:${fix.service}" ${BUSY ? 'disabled' : ''} type="button">${esc(fix.label)}</button>` : '');

function doctorCard() {
  let body = '<p class="hint" style="margin:0 0 12px">Checks the things that have gone wrong on this PC before. A fix is only offered when it is a safe start or restart.</p>';
  if (DOCTOR?.running) body += '<p class="hint">Checking…</p>';
  else if (DOCTOR?.error) body += '<p class="hint" role="alert">The checks could not run.</p>';
  else if (DOCTOR) body += `<ul class="need">${DOCTOR.results.map((r) => `<li><span class="lamp ${r.status}"><i></i><span class="sr">${r.status}</span></span><div><p><b>${esc(r.title)}</b></p>${r.detail ? `<p class="why">${esc(r.detail)}</p>` : ''}</div><div>${fixButton(r.fix)}</div></li>`).join('')}</ul><p class="tiles-note">Checked ${ago(DOCTOR.ranAt)}.</p>`;
  return `<section class="card" aria-labelledby="h-doc"><h2 id="h-doc">Doctor</h2>${body}<button class="btn primary" data-doctor ${DOCTOR?.running ? 'disabled' : ''} type="button">${DOCTOR && !DOCTOR.running ? 'Run checks again' : 'Run checks'}</button></section>`;
}
function auditCard() {
  const rows = AUDIT.map((a) => `<li style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:8px 0;border-top:1px solid var(--line-2)"><span>${lamp(a.ok ? 'ok' : 'fail', `${(VERB[a.action] ?? [a.action])[0]} ${a.service}`)}${a.error ? `<br><span class="s">${esc(a.error)}</span>` : ''}</span><span class="s mono-s">${ago(a.at)}</span></li>`).join('');
  return `<section class="card" aria-labelledby="h-aud"><h2 id="h-aud">Recent actions</h2>${rows ? `<ul class="need" style="gap:0">${rows}</ul>` : '<p class="hint">Nothing yet. Every start, stop and restart made here is recorded.</p>'}</section>`;
}
function services() {
  const rows = S.services.map((s) => `<div><div class="row" style="grid-template-columns:minmax(0,2fr) minmax(0,1.2fr) minmax(0,2fr) auto"><span><span class="t">${esc(s.title)}</span><br><span class="s">${esc(s.about)}</span></span><span>${lamp(s.state, s.text)}</span><span class="s">${esc(s.kind)}${s.port ? ` · port <span class="mono">${s.port}</span>` : ''}${s.state === 'ok' && s.uptimeSec != null ? ` · up <span class="mono">${dur(s.uptimeSec)}</span>` : ''}${s.state === 'ok' && s.memMB != null ? ` · <span class="mono">${mem(s.memMB)}</span>` : ''}${s.restarts ? ` · restarted ${s.restarts}×` : ''}</span><span class="acts">${actionButtons(s)}</span></div>${LOGS[s.id] !== undefined ? `<div class="drawer"><pre class="log">${esc(LOGS[s.id])}</pre></div>` : ''}</div>`).join('');
  return `<h1>Services</h1><p class="sub">Start, stop and check what runs behind the agents. Stopping something agents depend on asks first, and every action is recorded.</p>
  <div class="card flush"><div class="rows">${rows}</div></div>
  <p class="tiles-note">C: has <span class="mono">${S.disk.cFreeGB ?? '?'} GB</span> free. Checked ${ago(S.checkedAt)}.</p>
  <div class="grid g2" style="margin-top:16px">${doctorCard()}${auditCard()}</div>`;
}

// ---- Cost and Activity (M2.4) ----
const kfmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n ?? 0));
const FILTER = { agent: '', status: '' };
function cost() {
  const c = S.cost;
  if (!c) return '<h1>Cost</h1><p class="hint">Not available yet.</p>';
  const max = Math.max(0.0001, ...c.days.map((d) => d.apiUsd + d.subscriptionUsd)), mon = new Date().toLocaleString('en', { month: 'short' });
  const bar = (d) => { const h = (v) => (v ? Math.max(3, (v / max) * 100) : 0); return `<div title="${mon} ${d.day}: ${usd(d.apiUsd + d.subscriptionUsd)}, ${d.runs} run${d.runs === 1 ? '' : 's'}"><i class="sub-i" style="height:${h(d.subscriptionUsd)}%"></i><i class="api-i" style="height:${h(d.apiUsd)}%"></i></div>`; };
  const top = Math.max(0.0001, c.byAgent[0]?.usd ?? 0);
  const note = c.budget.level === 'ok' ? '' : `<p class="why" style="color:var(--${c.budget.level === 'fail' ? 'fail' : 'warn'});margin:10px 0 0"><b>${c.budget.level === 'fail' ? 'Over budget.' : 'Past the alert line.'}</b> ${usd(c.totalUsd)} of $${c.budget.usd}.</p>`;
  return `<h1>Cost</h1><p class="sub">${esc(c.month.label)}, from every agent run. Subscription runs cost nothing extra, but they are counted at API prices so you can see the load.</p>
  <div class="grid g2">
    <section class="card" aria-labelledby="h-m"><h2 id="h-m">This month</h2>
      <div><span class="big">${usd(c.totalUsd)}</span> <span class="of">of $${c.budget.usd}</span></div>
      <div class="meter" role="img" aria-label="${c.budget.pct} percent of the monthly budget used; alert at ${Math.round(c.budget.alertAt * 100)} percent"><span style="width:${Math.min(100, c.budget.pct)}%"></span><em style="left:${c.budget.alertAt * 100}%"></em></div>
      <div class="legend"><span><i style="background:var(--clay)"></i>Billed to API <b class="mono">${usd(c.apiUsd)}</b></span><span><i style="background:repeating-linear-gradient(135deg,var(--ink-3) 0 2px,transparent 2px 5px)"></i>Covered by subscriptions <b class="mono">${usd(c.subscriptionUsd)}</b></span></div>
      ${c.totalUsd || c.month.runs ? `<div class="bars" role="img" aria-label="Spend per day this month">${c.days.map(bar).join('')}</div><div class="axis"><span>1 ${mon}</span><span>${c.month.day} ${mon}</span></div>` : '<p class="hint" style="margin-top:14px">No runs yet this month.</p>'}
      <p class="tiles-note">${c.projectedUsd == null ? 'Too early in the month for a projection.' : `On pace for about $${c.projectedUsd} by the end of the month.`} ${c.month.runs} run${c.month.runs === 1 ? '' : 's'} so far.</p>${note}</section>
    <section class="card flush" aria-labelledby="h-a"><div style="padding:18px 18px 4px"><h2 id="h-a">By agent</h2></div>
      ${c.byAgent.length ? `<div class="rows">${c.byAgent.map((a) => `<div class="row" style="grid-template-columns:48px minmax(0,1.4fr) minmax(0,1.6fr) auto"><span style="width:42px">${crabSvg(a.name, 'idle')}</span><span><span class="t">${esc(a.name)}</span><br><span class="s">${a.runs} run${a.runs === 1 ? '' : 's'}</span></span><span class="meter" style="margin:0" role="img" aria-label="${usd(a.usd)}"><span style="width:${(a.usd / top) * 100}%"></span></span><span class="mono">${usd(a.usd)}</span></div>`).join('')}</div>` : '<p class="hint" style="padding:0 18px 18px">No spend yet.</p>'}</section>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <section class="card flush" aria-labelledby="h-mo"><div style="padding:18px 18px 4px"><h2 id="h-mo">By model</h2></div>${c.byModel.length ? `<div class="rows">${c.byModel.map((m) => `<div class="row" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto"><span class="mono-s">${esc(m.model)}</span><span class="s">${m.runs} run${m.runs === 1 ? '' : 's'}</span><span class="mono">${usd(m.usd)}</span></div>`).join('')}</div>` : '<p class="hint" style="padding:0 18px 18px">No spend yet.</p>'}</section>
    <section class="card" aria-labelledby="h-tk"><h2 id="h-tk">Tokens this month</h2><p style="margin:0"><span class="mono">${kfmt(c.tokens.in)}</span> input · <span class="mono">${kfmt(c.tokens.cached)}</span> read from cache · <span class="mono">${kfmt(c.tokens.out)}</span> output</p>
      <p class="tiles-note">Dollar figures are what Claude reports for each run. Paperclip's own cost summary shows $0 for subscription runs, which is why this page adds the runs up itself.</p></section>
  </div>`;
}

function activity() {
  const all = S.activity ?? [], agents = [...new Set(all.map((i) => i.agent).filter(Boolean))].sort();
  const stat = (i) => (i.kind === 'approval' ? (i.status === 'pending' ? ['warn', 'Needs approval'] : i.status === 'approved' ? ['ok', 'Approved'] : i.status === 'rejected' ? ['fail', 'Rejected'] : ['off', i.status])
    : ({ succeeded: ['ok', 'Succeeded'], failed: ['fail', 'Failed'], running: ['ok', 'Working'], queued: ['off', 'Queued'], cancelled: ['off', 'Cancelled'] }[i.status] ?? ['off', i.status]));
  const items = all.filter((i) => (!FILTER.agent || i.agent === FILTER.agent) && (!FILTER.status || (FILTER.status === 'approval' ? i.kind === 'approval' : i.kind === 'run' && i.status === FILTER.status)));
  const rows = items.map((i) => { const [k, t] = stat(i); const title = i.title || (i.kind === 'approval' ? 'Approval' : i.wake ? `Run: ${i.wake}` : 'Run'); return `<div class="row" style="grid-template-columns:48px minmax(0,2fr) minmax(0,1fr) minmax(0,1.8fr)"><span style="width:42px">${i.agent ? crabSvg(i.agent, i.status === 'running' ? 'working' : i.status === 'failed' ? 'error' : 'idle') : ''}</span><span><span class="t">${esc(title)}</span><br><span class="s">${esc(i.agent ?? '')}${i.kind === 'approval' ? ' · approval' : ''}</span></span><span>${lamp(k, t)}</span><span class="s mono-s" style="text-align:right;white-space:nowrap">${ago(i.at)}${i.usd != null ? `<br>${usd(i.usd)}${i.billing === 'subscription' ? ' · subscription' : ''}` : ''}</span></div>`; }).join('');
  const sel = (name, label, opts) => `<label class="s" style="display:flex;align-items:center;gap:8px">${label}<select data-filter="${name}" style="font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:5px 8px">${opts.map(([v, t]) => `<option value="${esc(v)}" ${FILTER[name] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  return `<h1>Activity</h1><p class="sub">Runs and approvals across all agents, newest first. Open Paperclip for the full task.</p>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin:0 0 14px">${sel('agent', 'Agent', [['', 'All agents'], ...agents.map((a) => [a, a])])}${sel('status', 'Show', [['', 'Everything'], ['succeeded', 'Succeeded'], ['failed', 'Failed'], ['running', 'Working'], ['cancelled', 'Cancelled'], ['approval', 'Approvals']])}</div>
  <div class="card flush">${rows ? `<div class="rows">${rows}</div>` : `<p class="hint" style="padding:18px">${all.length ? 'Nothing matches these filters.' : 'No runs or approvals yet.'}</p>`}</div>`;
}

// ---- Team (M2.2): agents joined with the reconciler's read-only plan ----
const CHIP = { 'in-step': ['ok', 'In step'], edit: ['warn', 'Keeping your edit'], update: ['warn', 'Will update'], decision: ['fail', 'Needs a decision'], unmanaged: ['warn', 'Not managed'], unknown: ['', 'Checking…'] };
const chip = (state) => { const [c, t] = CHIP[state] ?? CHIP.unknown; return `<span class="chip ${c}">${esc(t)}</span>`; };
const MOODWORD = { working: 'working', idle: 'idle', paused: 'paused', error: 'needs attention' };
let lastFocus = null;

function team() {
  const t = S.team, moods = Object.fromEntries(S.crew.map((c) => [c.id, c.mood]));
  if (!t || !S.paperclip.up) return '<h1>Team</h1><p class="sub">Paperclip is not reachable, so the agents cannot be listed.</p>';
  const dept = (a) => profileOf(a.name)[0];
  const counts = Object.entries(t.counts).filter(([k]) => k !== 'in-step').map(([k, n]) => `${n} ${{ edit: 'keeping your edit', update: 'will update', decision: 'need a decision', unmanaged: 'not managed', unknown: 'unchecked' }[k]}`).join(' · ');
  const status = t.available ? `${t.agents.length} agents. ${counts ? `${counts}.` : 'Every agent matches its template.'} Plan checked ${ago(t.ranAt)}.` : `${t.agents.length} agents. ${t.error ? `The plan could not be read: ${esc(t.error)}` : 'Reading the reconciler’s plan…'}`;
  const groups = DEPTS.map(([k, n]) => { const list = t.agents.filter((a) => dept(a) === k); if (!list.length) return '';
    return `<div class="sect" style="--c:${ACCENT[k]}">${n}</div>${list.map((a) => `<button class="rowbtn" data-agent="${esc(a.id)}" type="button"><div class="row teamrow deptbar" style="--c:${ACCENT[k]}"><span style="width:42px">${crabSvg(a.name, moods[a.id] ?? 'idle', `${a.name}, ${MOODWORD[moods[a.id] ?? 'idle']}`)}</span><span><span class="t">${esc(a.name)}</span><br><span class="s">${esc(a.title)}</span></span><span class="s mono-s">${esc(a.model)}</span><span>${chip(a.state)}</span><span class="s" aria-hidden="true">›</span></div></button>`).join('')}`; }).join('');
  return `<h1>Team</h1><p class="sub">${status}</p><div class="card flush"><div class="rows">${groups}</div></div>
  <p class="tiles-note">Agents follow the templates in <span class="mono">org/</span>. Edits you make in Paperclip are kept. Applying a change stays in the command line for now; open an agent to see the exact command.</p>`;
}

function openAgent(id) {
  const a = S.team.agents.find((x) => x.id === id); if (!a) return;
  const mood = S.crew.find((c) => c.id === id)?.mood ?? 'idle', d = DEPTS.find(([k]) => k === profileOf(a.name)[0]);
  const OPWORD = { update: 'The template changed this', 'keep-live': 'You changed this in Paperclip', conflict: 'Both changed this', 'adopt-diff': 'Differs from the template' };
  const changes = a.changes.map((c) => `<h2 style="margin:18px 0 6px">${esc(c.label)}</h2><p class="s" style="margin:0 0 6px">${esc(OPWORD[c.op] ?? c.op)}. ${esc(c.summary)}</p>${c.diff?.lines?.length ? `<div class="diff">${c.diff.lines.map((l) => `<div class="${l.t === '-' ? 'rm' : 'ad'}">${l.t} ${esc(l.s)}</div>`).join('')}${c.diff.more ? `<div class="s">…and ${c.diff.more} more changed lines</div>` : ''}</div>` : ''}`).join('');
  const body = a.state === 'in-step' ? `<h2 style="margin-top:20px">Matches the template</h2><p class="s">No differences. Plan checked ${ago(S.team.ranAt)}.</p>`
    : a.state === 'unmanaged' ? `<h2 style="margin-top:20px">Not managed</h2><p>${esc(a.note ?? '')} The reconciler leaves it alone, and the older sync still maintains it.</p>`
    : a.state === 'unknown' ? '<h2 style="margin-top:20px">Plan not available yet</h2><p class="s">The reconciler’s plan has not been read, so differences cannot be shown.</p>'
    : changes;
  const cmd = a.command ? `<h2 style="margin:20px 0 6px">To apply it</h2><p class="s" style="margin:0 0 6px">Run this in PowerShell from the repo folder. Nothing changes until you do.</p><pre class="log" id="cmd">${esc(a.command)}</pre><p style="margin:10px 0 0"><button class="btn small" data-copy type="button">Copy command</button></p>` : '';
  $('panel').innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><div style="display:flex;gap:12px;align-items:center"><span style="width:56px">${crabSvg(a.name, mood, `${a.name}, ${MOODWORD[mood]}`)}</span><div><h3 id="ptitle">${esc(a.name)}</h3><div class="s">${esc(a.title)}${d ? ` · ${d[1]}` : ''}</div></div></div><button class="btn small" data-close-panel type="button">Close</button></div>
   <dl style="display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:20px 0 0"><dt class="s">Model</dt><dd class="mono" style="margin:0">${esc(a.model)}</dd><dt class="s">State</dt><dd style="margin:0">${MOODWORD[mood]}</dd><dt class="s">Budget</dt><dd class="mono" style="margin:0">$${a.budgetUsd.toFixed(2)} / month</dd>${a.reportsTo ? `<dt class="s">Reports to</dt><dd style="margin:0">${esc(a.reportsTo)}</dd>` : ''}<dt class="s">Template</dt><dd style="margin:0">${chip(a.state)}</dd></dl>${body}${cmd}
   <p style="margin-top:22px"><a href="http://localhost:3100/" target="_blank" rel="noopener" class="s">Open Paperclip ↗</a></p>`;
  lastFocus = document.activeElement; setPanel(true); $('panel').querySelector('[data-close-panel]').focus();
}
function setPanel(on) { $('panel').classList.toggle('open', on); $('panel').setAttribute('aria-hidden', String(!on)); $('scrim').classList.toggle('on', on); if (!on && lastFocus?.isConnected) lastFocus.focus(); }

// ---- Models (M2.5): how Claude agents are routed, and the gateway for other models ----
const TIERNAME = { fast: 'Fast', balanced: 'Balanced', frontier: 'Frontier', max: 'Max' };
function models() {
  const m = S.models;
  if (!m) return '<h1>Models</h1><p class="sub">Reading how models are routed…</p>';
  const r = m.router, cfg = r.config, svc = (id) => S.services.find((s) => s.id === id);
  const jevSvc = svc('jev'), omniSvc = svc('omniroute');
  const maxTier = Math.max(1, ...Object.values(r.last24h.byTier));
  const base = cfg?.baselineModel && typeof cfg.baselineModel === 'object' ? Object.values(cfg.baselineModel)[0] : cfg?.baselineModel;
  const channels = r.jev ? (r.jev.channels.length ? r.jev.channels.map((c) => lamp(c.open || c.errors > c.calls / 2 ? 'warn' : 'ok', c.name + ': ' + c.calls + ' call' + (c.calls === 1 ? '' : 's') + ', ' + c.errors + ' error' + (c.errors === 1 ? '' : 's') + (c.open ? ' (paused after errors)' : ''))).join('<br>') : lamp('off', 'Jev is not connected')) : lamp('off', 'Jev status unavailable');
  const tiers = cfg ? '<div class="rows" style="border:1px solid var(--line-2);border-radius:8px;margin-top:12px">' + cfg.tiers.map((t) => '<div class="row" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1.4fr) auto;padding:10px 14px"><span class="t">' + esc(TIERNAME[t.tier] ?? t.tier) + (t.isDefault ? ' <span class="chip">starts here</span>' : '') + '</span><span class="mono-s">' + esc(t.models.join(', ') || '-') + '</span><span class="s">needs ' + Math.round((t.confidence ?? 0) * 100) + '% sure</span></div>').join('') + '</div><p class="tiles-note">Policy: ' + esc(cfg.policy.mode) + (cfg.policy.mode === 'ratchet' ? ' (it decides again at each of your messages and only ever moves up to a stronger model)' : '') + '. The percentage is the minimum probability Jev must give a tier before it is chosen; cheaper tiers need more.' + (base ? ' Baseline for savings: ' + esc(base) + '.' : '') + '</p>' : '<p class="hint">The router’s settings could not be read.</p>';
  const decisions = r.recent.length ? '<ul class="need" style="gap:0;margin-top:6px">' + r.recent.map((d) => '<li style="grid-template-columns:minmax(0,1fr) auto;padding:8px 0"><span><span class="chip">' + esc(TIERNAME[d.tier] ?? d.tier) + '</span> <span class="mono-s">' + esc(d.model ?? '') + '</span>' + (d.reason ? '<br><span class="s">' + esc(d.reason) + '</span>' : '') + '</span><span class="s mono-s">' + ago(d.at) + '</span></li>').join('') + '</ul>' : '';
  const tally = r.last24h.total ? '<div style="margin-top:12px">' + Object.entries(r.last24h.byTier).map(([t, n]) => '<div style="display:grid;grid-template-columns:90px 1fr auto;gap:10px;align-items:center;margin:4px 0"><span class="s">' + esc(TIERNAME[t] ?? t) + '</span><span class="meter" style="margin:0"><span style="width:' + (n / maxTier) * 100 + '%"></span></span><span class="mono-s">' + n + '</span></div>').join('') + '</div>' : '<p class="hint" style="margin-top:12px">No routed messages in the last 24 hours. Engineers use the router the next time they run.</p>';
  const group = (title, list, none) => '<div style="margin:0 0 14px"><h2 style="margin-bottom:8px">' + title + ' (' + list.length + ')</h2>' + (list.length ? '<div class="crabs" style="gap:8px">' + list.map((a) => '<span class="chip" title="' + esc(a.model) + '">' + esc(a.name) + '</span>').join('') + '</div>' : '<p class="hint">' + none + '</p>') + '</div>';
  const spend = (S.cost?.byModel ?? []).length ? '<div class="rows">' + S.cost.byModel.map((x) => '<div class="row" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto"><span class="mono-s">' + esc(x.model) + '</span><span class="s">' + x.runs + ' run' + (x.runs === 1 ? '' : 's') + '</span><span class="mono">' + usd(x.usd) + '</span></div>').join('') + '</div>' : '<p class="hint" style="padding:0 18px 18px">No spend yet this month.</p>';
  return '<h1>Models</h1><p class="sub">Two separate paths, never chained. Agents that use the router go through jev-router; other models go through OmniRoute. Some agents call Claude directly with a fixed model.</p>' +
  '<div class="grid g2">' +
    '<section class="card" aria-labelledby="h-jev"><h2 id="h-jev">Claude, through jev-router</h2><p style="margin:0 0 8px">' + lamp(jevSvc?.state ?? (r.up ? 'ok' : 'fail'), jevSvc?.text) + '</p>' +
      '<p class="s" style="margin:0 0 4px">' + (r.up ? 'Version ' + esc(r.version) + ' · up ' + dur(r.uptimeSec) + ' · ' + r.sessions + ' session' + (r.sessions === 1 ? '' : 's') + ', ' + r.active + ' active' : 'Not answering.') + '</p>' +
      '<p class="s" style="margin:10px 0 0">Jev (the model that picks the tier):</p><p style="margin:2px 0 0">' + channels + '</p>' + tiers + '</section>' +
    '<section class="card" aria-labelledby="h-omni"><h2 id="h-omni">Other models, through OmniRoute</h2><p style="margin:0 0 8px">' + lamp(omniSvc?.state ?? (m.omniroute.up ? 'ok' : 'fail'), omniSvc?.text) + '</p>' +
      '<p class="s">OmniRoute picks a provider and falls back when one reaches its limit. Its providers and combinations are behind its own sign-in, so they are not listed here. Add or review them in its dashboard.</p>' +
      '<p style="margin:12px 0 0"><a class="btn" href="http://localhost:20128/" target="_blank" rel="noopener">Open the OmniRoute dashboard ↗</a></p></section>' +
  '</div>' +
  '<div class="grid g2" style="margin-top:16px">' +
    '<section class="card" aria-labelledby="h-24"><h2 id="h-24">Routed in the last 24 hours</h2><p style="margin:0"><span class="big" style="font-size:30px">' + r.last24h.total + '</span> <span class="of">message' + (r.last24h.total === 1 ? '' : 's') + '</span></p>' + tally + decisions + '</section>' +
    '<section class="card" aria-labelledby="h-paths"><h2 id="h-paths">Which agents use which path</h2>' + group('Through jev-router', m.paths.jev, 'None.') + group('Direct to Claude, fixed model', m.paths.direct, 'None.') + group('Through OmniRoute', m.paths.omni, 'None yet.') + '</section>' +
  '</div>' +
  '<section class="card flush" style="margin-top:16px" aria-labelledby="h-sm"><div style="padding:18px 18px 4px"><h2 id="h-sm">Spend by model this month</h2></div>' + spend + '</section>';
}

// ---- Safety (M2.5): database backups and secrets ----
let SBUSY = null;
const bytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const SLAMP = { ok: ['ok', 'OK'], warn: ['warn', 'Look at this'], absent: ['off', 'Not present'], unknown: ['off', 'Unknown'] };
async function runSafety(action) {
  if (SBUSY) return; SBUSY = action; paint();
  try {
    const { status, json } = await api('/api/safety', { action });
    if (status === 200 && json.ok) {
      if (action === 'backup') toast(json.result.file ? 'Backup created: ' + json.result.file.split('/').pop() + (json.result.copied ? ' (copied to ' + json.result.copied + ')' : json.result.copied === false ? ' (the copy failed)' : '') : 'Backup finished.');
      else toast(json.result.total ? 'Found ' + json.result.total + ' possible secret' + (json.result.total === 1 ? '' : 's') + '.' : 'No secrets found.', json.result.total > 0);
    } else toast(json.error ?? 'That did not work.', true);
  } catch { toast('The control app did not answer.', true); }
  SBUSY = null; await load();
}
function safetyScreen() {
  const sf = S.safety;
  if (!sf) return '<h1>Safety</h1><p class="sub">Checking backups and secret locations…</p>';
  const b = sf.backups, sc = sf.lastScan, dis = SBUSY ? 'disabled' : '';
  const newest = b?.available && b.backups[0] ? b.backups[0] : null;
  const backups = !b?.available ? '<p class="hint">Backups could not be read' + (b?.error ? ': ' + esc(b.error) : '') + '.</p>' :
    '<p style="margin:0 0 6px">' + lamp(newest ? 'ok' : 'warn', newest ? 'Latest backup ' + ago(newest.at) : 'No backups yet') + '</p>' +
    '<p class="s" style="margin:0 0 12px">' + (b.automatic ? 'Automatic: every ' + b.everyMinutes + ' min, kept ' + b.keepDays + ' days' : 'Automatic backups are off') + ' · ' + b.count + ' backup' + (b.count === 1 ? '' : 's') + ' · ' + bytes(b.totalBytes) + '</p>' +
    '<button class="btn primary" data-safety="backup" ' + dis + ' type="button">' + (SBUSY === 'backup' ? 'Backing up…' : 'Back up now') + '</button>' +
    (b.backups.length ? '<div class="rows" style="margin-top:14px;border:1px solid var(--line-2);border-radius:8px">' + b.backups.slice(0, 6).map((x) => '<div class="row" style="grid-template-columns:minmax(0,2fr) auto auto;padding:9px 14px"><span class="mono-s">' + esc(x.name) + '</span><span class="s mono-s">' + bytes(x.bytes) + '</span><span class="s mono-s">' + ago(x.at) + '</span></div>').join('') + '</div>' : '') +
    '<p class="tiles-note">' + (b.copyDir ? 'Each backup is also copied to <span class="mono">' + esc(b.copyDir) + '</span>.' : '<b>These backups sit on the same disk as the data</b> (inside WSL on C:), so they will not help if that disk is lost. To keep a second copy, add <span class="mono">"backupCopyDir": "D:\\\\Backups\\\\agent-stack"</span> to <span class="mono">%LOCALAPPDATA%\\AgentStack\\settings.json</span>; it is used on every “Back up now”.') + ' This app never restores a backup; see docs/operations.md.</p>';
  const inv = sf.inventory.map((i) => '<div class="row" style="grid-template-columns:minmax(0,2fr) minmax(0,.9fr) minmax(0,1.6fr)"><span><span class="t">' + esc(i.what) + '</span><br><span class="s mono-s" style="overflow-wrap:anywhere">' + esc(i.path) + '</span></span><span>' + lamp(...(SLAMP[i.state] ?? SLAMP.unknown)) + '</span><span class="s">' + esc(i.note) + '</span></div>').join('');
  const finds = sc?.findings?.length ? '<div class="rows" style="margin-top:12px;border:1px solid var(--line-2);border-radius:8px">' + [...new Map(sc.findings.map((f) => [f.file + ':' + f.line, f])).values()].slice(0, 25).map((f) => '<div class="row" style="grid-template-columns:minmax(0,2fr) auto minmax(0,1fr);padding:9px 14px"><span class="mono-s" style="overflow-wrap:anywhere">' + esc(f.file) + '</span><span class="s mono-s">line ' + f.line + '</span><span class="s">' + esc(f.kind) + '</span></div>').join('') + '</div><p class="tiles-note">Only the place and the kind are shown, never the value. Remove or rotate the secret, then scan again.</p>' : '';
  const scan = '<p class="s" style="margin:0 0 12px">Looks for key-shaped text where secrets do not belong: files tracked by git, this app’s own data, the reconciler’s state, jev-router’s log and the services’ logs.</p><button class="btn primary" data-safety="scan" ' + dis + ' type="button">' + (SBUSY === 'scan' ? 'Scanning…' : sc ? 'Scan again' : 'Scan for leaks') + '</button>' +
    (sc ? '<p style="margin:14px 0 0">' + lamp(sc.total ? 'fail' : 'ok', sc.total ? sc.total + ' possible secret' + (sc.total === 1 ? '' : 's') + ' found' : 'No secrets found') + '</p><p class="s" style="margin:4px 0 0">' + sc.scopes.map((x) => esc(x.name) + ': ' + x.scanned + (x.error ? ' (could not scan)' : '')).join(' · ') + '. Scanned ' + ago(sc.ranAt) + '.</p>' + finds : '<p class="hint" style="margin-top:12px">Not scanned yet.</p>');
  return '<h1>Safety</h1><p class="sub">Backups of the database, and where your secrets live. Nothing here shows a secret’s value.</p>' +
    '<div class="grid g2"><section class="card" aria-labelledby="h-bk"><h2 id="h-bk">Database backups</h2>' + backups + '</section><section class="card" aria-labelledby="h-ls"><h2 id="h-ls">Leak scan</h2>' + scan + '</section></div>' +
    '<section class="card flush" style="margin-top:16px" aria-labelledby="h-inv"><div style="padding:18px 18px 4px"><h2 id="h-inv">Where secrets live</h2></div><div class="rows">' + inv + '</div></section>' +
    '<p class="tiles-note">Paths and permissions only; file contents are never read here. Windows file permissions are not checked.</p>';
}

// ---- Tools: connected tools, what each is allowed to do, and what they have done ----
const POLICY_WORD = { allow: 'allowed', ask: 'asks first', off: 'off' };
function toolsScreen() {
  const t = S.tools;
  if (!t) return '<h1>Tools</h1><p class="sub">Reading the tool log…</p>';
  const tile = (n, label) => `<div class="tile"><b class="big">${n}</b><span class="s">${label}</span></div>`;
  const chipFor = (a) => `<span class="chip ${a === 'allow' ? 'ok' : ''}">${esc(POLICY_WORD[a] ?? a)}</span>`;
  const cards = t.integrations.map((i) => `<section class="card" aria-label="${esc(i.server)}"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><h2 style="margin:0">${esc(i.server)}</h2>${lamp(i.calls24h ? 'ok' : 'off', i.calls24h ? 'Active today' : 'No activity yet')}</div>
      <p class="s">Everything not listed below ${i.defaultPolicy === 'ask' ? 'asks you first' : i.defaultPolicy === 'allow' ? 'is allowed' : 'is off'}.</p>
      ${i.policy.length ? `<p>${i.policy.map((p) => `<span class="mono-s">${esc(p.tool)}</span> ${chipFor(p.action)}`).join(' &nbsp; ')}</p>` : ''}
      <p class="s mono-s">Last 24 h: ${i.calls24h} call${i.calls24h === 1 ? '' : 's'}, ${i.blocked24h} blocked, ${i.errors24h} failed${i.lastAt ? ` · last used ${esc(i.lastTool)} ${ago(i.lastAt)}` : ''}</p></section>`).join('');
  const unlisted = t.unlisted.length ? `<section class="card"><h2>Used but not in your list</h2><p class="hint">These asked to run and were treated as "asks first".</p><div class="rows">${t.unlisted.map((u) => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><span class="t">${esc(u.server)}</span><span class="s mono-s">${u.calls24h} call${u.calls24h === 1 ? '' : 's'} · ${u.blocked24h} blocked</span></div>`).join('')}</div></section>` : '';
  const grants = t.grants.length ? `<section class="card"><h2>Temporary approvals</h2><div class="rows">${t.grants.map((g) => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><span class="t mono-s">${esc(g.tool.replace(/^mcp__/, '').replace('__', ' › '))}</span><span class="s">until ${new Date(g.until).toLocaleString()}</span></div>`).join('')}</div></section>` : '';
  const verb = (f) => (f.kind === 'result' ? (f.ok === false ? 'failed' : 'finished') : f.decision === 'blocked' || f.decision === 'off' ? 'was blocked from' : 'called');
  const feed = t.feed.length ? `<div class="rows">${t.feed.map((f) => `<div class="row" style="grid-template-columns:48px minmax(0,2fr) auto auto"><span style="width:42px">${f.agent ? crabSvg(f.agent.replace(/^agent .*/, 'Agent'), 'idle') : ''}</span><span><span class="t">${esc(f.agent ?? 'An agent')} ${verb(f)} ${esc(f.name)}</span><br><span class="s">${esc(f.server ?? '')}${f.argKeys.length ? ' · inputs: ' + esc(f.argKeys.join(', ')) : ''}</span></span>
      <span>${f.kind === 'result' ? lamp(f.ok === false ? 'fail' : 'ok', f.ok === false ? 'Failed' : 'Done') : lamp(f.decision === 'blocked' || f.decision === 'off' ? 'fail' : 'ok', { allowed: 'Allowed', granted: 'Approved', blocked: 'Blocked', off: 'Off' }[f.decision] ?? 'Called')}</span><span class="s mono-s" style="text-align:right;white-space:nowrap">${ago(f.at)}</span></div>`).join('')}</div>`
    : `<p class="hint" style="padding:12px 18px">${t.logging.hasLog ? 'Nothing in the last 24 hours.' : 'No tool calls recorded yet. They appear here the moment an agent uses a connected tool.'}</p>`;
  return `<h1>Tools</h1><p class="sub">Every tool your agents can use, what each is allowed to do, and what it has done. Only names and outcomes are recorded here, never the contents of a request or its answer.</p>
    <div class="tiles">${tile(t.integrations.length, 'connected')}${tile(t.last24h.calls, 'calls in 24 h')}${tile(t.last24h.blocked, 'blocked')}${tile(t.last24h.errors, 'failed')}</div>
    ${t.hasPolicy ? cards : '<section class="card"><h2>No tools connected yet</h2><p class="hint">Connected tools are listed from your integrations policy. Run <span class="mono-s">stack integrations sync</span> after adding one.</p></section>'}
    ${unlisted}${grants}
    <section class="card flush" style="padding:0"><h2 style="padding:16px 18px 0;margin:0">What happened</h2>${feed}</section>`;
}

// ---- Set up (M3): describe -> review the blueprint -> approve -> apply ----
const SETUP = { step: 'describe', text: '', req: null, bp: null, errors: [], via: '', note: '', busy: false, opts: null, job: null };
const AUTONOMY_WORD = { quiet: 'Quiet: wakes only when asked', balanced: 'Balanced', watchful: 'Watchful: checks in often' };
async function setupInit() { if (SETUP.opts) return; const r = await api('/api/setup/options'); if (r.status === 200) { SETUP.opts = r.json; if (route() === 'setup') paint(); } }
async function setupPreview(req) {
  SETUP.busy = true; paint();
  const r = await api('/api/setup/preview', { requirements: req });
  SETUP.busy = false; SETUP.errors = r.json.errors ?? (r.json.error ? [r.json.error] : []);
  if (r.json.ok) { SETUP.req = req; SETUP.bp = r.json.blueprint; SETUP.step = 'review'; }
  paint();
}
async function setupInterpret() {
  if (!SETUP.text.trim()) { toast('Describe what you want first.', true); return; }
  SETUP.busy = true; SETUP.errors = []; paint();
  const r = await api('/api/setup/interpret', { text: SETUP.text });
  SETUP.busy = false; SETUP.via = r.json.via ?? ''; SETUP.note = r.json.note ?? '';
  if (r.json.ok) return setupPreview(r.json.requirements);
  SETUP.errors = r.json.errors ?? [r.json.error ?? 'That could not be read.']; paint();
}
function setupPreset(id) {
  const p = SETUP.opts.presets.find((x) => x.id === id);
  setupPreview({ schemaVersion: 1, kind: p.kind, name: p.kind === 'personal' ? '' : (SETUP.req?.name || 'My company'), goals: [p.title], departments: p.departments, tools: p.tools, autonomy: 'balanced', budgetMonthlyUsd: 100, personal: { organizer: p.tools.includes('downloads-organizer') }, unknowns: [] });
}
function setupEdit(field, value) {
  const q = structuredClone(SETUP.req);
  if (field === 'name') q.name = value; else if (field === 'autonomy') q.autonomy = value; else if (field === 'budget') q.budgetMonthlyUsd = Number(value);
  else if (field.startsWith('dept:')) { const d = field.slice(5); q.departments = value ? [...new Set([...q.departments, d])] : q.departments.filter((x) => x !== d); }
  else if (field.startsWith('tool:')) { const t = field.slice(5); q.tools = value ? [...new Set([...q.tools, t])] : q.tools.filter((x) => x !== t); }
  setupPreview(q);
}
async function setupApply() {
  const r = await api('/api/setup/apply', { requirements: SETUP.req, hash: SETUP.bp.hash });
  if (r.status !== 200) { toast(r.json.error ?? 'Could not start.', true); return; }
  SETUP.step = 'apply'; SETUP.job = { id: r.json.job, steps: [], lines: [], done: false, next: 0 }; paint(); pollSetup();
}
async function pollSetup() {
  const j = SETUP.job; if (!j || j.done) return;
  const r = await api(`/api/setup/job/${j.id}?from=${j.next}`);
  if (r.status === 200) { Object.assign(j, { steps: r.json.steps, done: r.json.done, next: r.json.next, manual: r.json.manual, dry: r.json.dry }); j.lines.push(...r.json.lines); }
  if (route() === 'setup') paint(); if (!j.done) setTimeout(pollSetup, 1500);
}
function setupScreen() {
  setupInit();
  const o = SETUP.opts; if (!o) return '<h1>Set up</h1><p class="sub">Loading…</p>';
  const err = SETUP.errors.length ? `<div class="err" role="alert">${SETUP.errors.map((e) => `<p>${esc(e)}</p>`).join('')}</div>` : '';
  const busy = SETUP.busy ? '<p class="hint" aria-live="polite">Working…</p>' : '';
  if (SETUP.step === 'describe') return `<h1>Set up</h1><p class="sub">Say what you want in your own words, or start from a template. You will see exactly what would be created and what it costs before anything happens.</p>
    <section class="card"><label for="sdesc"><b>What do you want your agents to do?</b></label>
    <textarea id="sdesc" class="field" rows="5" maxlength="4000" placeholder="For example: a small software agency called Acme. We want agents to build features, track time and report progress. Keep the cost low.">${esc(SETUP.text)}</textarea>
    <p style="margin:10px 0 0"><button class="btn primary" type="button" data-setup="read" ${SETUP.busy ? 'disabled' : ''}>Read my description</button></p>${busy}${err}
    <p class="hint">Never type passwords or keys here. A language model reads your text only to fill in a form; it cannot create permissions or run anything.</p></section>
    <h2 style="margin-top:22px">Or start from a template</h2><div class="grid">${o.presets.map((p) => `<button class="tile" type="button" data-preset="${esc(p.id)}"><b>${esc(p.title)}</b><span class="s">${esc(p.blurb)}</span></button>`).join('')}</div>`;
  if (SETUP.step === 'apply') {
    const j = SETUP.job;
    return `<h1>Setting up</h1><p class="sub">${j.done ? (j.dry ? 'Preview run finished: nothing was changed.' : (j.steps.some((s) => s.status === 'failed') ? 'Finished, but a step needs a look.' : 'Finished.')) : 'This can take several minutes. You can leave this page open.'}</p>
      <section class="card"><div class="rows">${j.steps.map((s) => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><span class="t">${esc(s.title)}</span><span>${lamp(s.status === 'done' ? 'ok' : s.status === 'failed' ? 'fail' : s.status === 'running' ? 'warn' : 'off', { done: 'Done', failed: 'Did not finish', running: 'Running', waiting: 'Waiting' }[s.status])}</span></div>`).join('')}</div>
      <pre class="log" tabindex="0" aria-label="Setup log">${esc(j.lines.slice(-60).join('\n'))}</pre></section>
      ${j.done && j.manual?.length ? `<section class="card"><h2>Still to do by you</h2><div class="rows">${j.manual.map((m) => `<div class="row" style="grid-template-columns:1fr"><span><span class="t">${esc(m.title)}</span><br><span class="s">${esc(m.detail)}</span></span></div>`).join('')}</div></section>` : ''}
      ${j.done ? '<p><a class="btn" href="#/team">See the team</a> <button class="btn" type="button" data-setup="again">Start over</button></p>' : ''}`;
  }
  const b = SETUP.bp, r = SETUP.req, v = b.validation, c = b.cost;
  const deptBox = o.departments.map((d) => `<label class="chk"><input type="checkbox" data-sf="dept:${esc(d.key)}" ${b.departments.includes(d.key) ? 'checked' : ''} ${d.key === 'engineering' && b.departments.length > 1 ? 'disabled' : ''}> ${esc(d.name)} <span class="s">${d.agents} agent${d.agents === 1 ? "" : "s"}</span></label>`).join('');
  const toolBox = o.tools.map((t) => `<label class="chk"><input type="checkbox" data-sf="tool:${esc(t.id)}" ${r.tools.includes(t.id) ? 'checked' : ''}> ${esc(t.title)}${t.external ? ' <span class="chip">asks first</span>' : ''}</label>`).join('');
  const agents = b.agents.map((a) => `<span class="crabbtn" title="${esc(a.name)}, ${esc(a.title)}">${crabSvg(a.name, 'idle', `${a.name}, ${a.title}`)}</span>`).join('');
  return `<h1>Review the plan</h1><p class="sub">${esc(b.workspace.name)}. Nothing has been created yet.${SETUP.note ? ' ' + esc(SETUP.note) : ''}</p>${err}${busy}
    <section class="card"><h2>Your choices</h2>
      ${b.workspace.kind !== 'personal' ? `<p><label for="sname">Company name</label> <input id="sname" class="field" data-sf="name" maxlength="80" value="${esc(r.name)}"></p><div class="chks">${deptBox}</div>` : ''}
      <p><label for="sauto">Schedule</label> <select id="sauto" class="field" data-sf="autonomy">${Object.entries(AUTONOMY_WORD).map(([k, w]) => `<option value="${k}" ${k === r.autonomy ? 'selected' : ''}>${w}</option>`).join('')}</select>
      <label for="sbud">Monthly budget (USD)</label> <input id="sbud" class="field" type="number" min="5" max="10000" data-sf="budget" value="${esc(r.budgetMonthlyUsd)}"></p>
      <div class="chks">${toolBox}</div></section>
    ${b.agents.length ? `<section class="card"><h2>${b.agents.length} agent${b.agents.length === 1 ? "" : "s"}</h2><div class="crabs">${agents}</div><p class="hint">${esc(b.departments.join(', '))}</p></section>` : ''}
    <section class="card"><h2>What it costs</h2><p class="big">about ${usd(c.idleUsd)} <span class="s">a month while idle (${usd(c.idleRangeUsd[0])} to ${usd(c.idleRangeUsd[1])})</span></p>
      <p class="s">${c.parts.map((p) => `${esc(p.label)} ${usd(p.usd)}`).join(' · ') || 'No scheduled routines.'}</p><p class="hint">Your hard limit is ${usd(b.budget.monthlyUsd)} a month; agents together are capped at ${usd(c.capsUsd)}. ${esc(c.note)}</p></section>
    <section class="card"><h2>What will not happen without you</h2><ul class="plain"><li>${esc(b.policy.note)}</li>${b.tools.map((t) => `<li>${esc(t.title)}: ${t.external ? 'every action asks you first' : 'runs on this computer only'}.</li>`).join('')}${b.manual.map((m) => `<li><b>${esc(m.title)}</b>: ${esc(m.detail)}</li>`).join('')}</ul></section>
    <section class="card"><h2>Steps that will run</h2><div class="rows">${b.actions.map((a) => `<div class="row" style="grid-template-columns:1fr"><span><span class="t">${esc(a.title)}</span><br><span class="s">${esc(a.note ?? '')}</span></span></div>`).join('') || '<p class="hint" style="padding:12px 18px">No steps.</p>'}</div></section>
    ${v.errors.length ? `<div class="err" role="alert">${v.errors.map((e) => `<p>${esc(e)}</p>`).join('')}</div>` : ''}${v.warnings.length ? `<section class="card"><h2>Worth knowing</h2><ul class="plain">${v.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>` : ''}
    ${b.unknowns.length ? `<section class="card"><h2>Open questions</h2><ul class="plain">${b.unknowns.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></section>` : ''}
    <p class="s mono-s">Approval code ${esc(b.hash)}. The plan is re-checked against it when you apply.</p>
    <p><button class="btn primary" type="button" data-setup="apply" ${v.ok && !SETUP.busy ? '' : 'disabled'}>Approve and set up</button> <button class="btn" type="button" data-setup="back">Back</button></p>`;
}

// ---- shell ----
const ROUTES = { home: ['Home', home, 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'], services: ['Services', services, 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6'],
  team: ['Team', team, 'M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0'],
  cost: ['Cost', cost, 'M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3.2 5 1.3 5 3.3-2.2 3-5 3-5-1.1-5-3'], safety: ['Safety', safetyScreen, 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
  models: ['Models', models, 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5'],
  tools: ['Tools', toolsScreen, 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z'],
  setup: ['Set up', setupScreen, 'M12 5v14M5 12h14'],
  activity: ['Activity', activity, 'M3 12h4l3-8 4 16 3-8h4'] };
const icon = (p) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${p}"/></svg>`;
const route = () => { const h = (location.hash.replace(/^#\/?/, '') || 'home').split('/')[0]; return ROUTES[h] ? h : 'home'; };

function paint() {
  const r = route(), badge = S?.needs.length ?? 0;
  $('nav').innerHTML = Object.entries(ROUTES).map(([k, v]) => `<a href="#/${k}" ${k === r ? 'aria-current="page"' : ''}>${icon(v[2])}<span>${v[0]}</span>${k === 'home' && badge ? `<b class="badge" aria-label="${badge} need you">${badge}</b>` : ''}</a>`).join('');
  const MORE = ['cost', 'activity', 'models', 'safety', 'setup'], main4 = Object.entries(ROUTES).filter(([k]) => !MORE.includes(k));
  $('tabs').style.gridTemplateColumns = 'repeat(' + (main4.length + 1) + ',1fr)';
  $('tabs').innerHTML = main4.map(([k, v]) => '<a href="#/' + k + '" ' + (k === r ? 'aria-current="page"' : '') + '>' + icon(v[2]) + v[0] + '</a>').join('') + '<button type="button" data-more ' + (MORE.includes(r) ? 'aria-current="page"' : '') + '>' + icon('M4 7h16M4 12h16M4 17h16') + 'More</button>';
  const main = $('main');
  if (failure) main.innerHTML = `<h1>Cannot read the stack</h1><div class="err" role="alert"><p><b>${esc(failure.title)}</b></p><p class="hint">${esc(failure.hint)}</p></div>`;
  else if (!S) main.innerHTML = '<p style="color:var(--ink-3)">Loading…</p>';
  else if (!(r === 'setup' && document.activeElement?.id === 'sdesc')) main.innerHTML = ROUTES[r][1](); // never repaint under someone who is typing
  document.title = `${S && !failure ? `${S.headline.needCount ? `(${S.headline.needCount}) ` : ''}` : ''}${ROUTES[r][0]} · Agent Stack`;
  if (S && location.hash === '#/home-needs') $('needs')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function load() {
  try {
    const res = await fetch('/api/state', { headers: { 'x-stack-token': token ?? '' }, cache: 'no-store' });
    if (res.status === 401) { failure = { title: 'This page does not have the access key.', hint: 'Open the app from the link printed in the terminal window (it contains ?t=…).' }; S = null; }
    else if (!res.ok) throw new Error(String(res.status));
    else { const next = await res.json(), key = JSON.stringify({ ...next, checkedAt: 0 }); const changed = key !== lastKey || failure; S = next; failure = null; lastKey = key; if (!changed) return; }
  } catch { failure = { title: 'The control app stopped answering.', hint: 'Start it again with app.cmd, then open the new link it prints.' }; }
  paint();
}

function applyTheme() { document.documentElement.dataset.theme = THEME || ''; const dark = THEME === 'dark' || (!THEME && matchMedia('(prefers-color-scheme:dark)').matches); $('theme').textContent = dark ? 'Light mode' : 'Dark mode'; }
$('theme').onclick = () => { const dark = document.documentElement.dataset.theme === 'dark' || (!THEME && matchMedia('(prefers-color-scheme:dark)').matches); THEME = dark ? 'light' : 'dark'; try { localStorage.setItem('theme', THEME); } catch { /* ignore */ } applyTheme(); };
document.addEventListener('input', (e) => { if (e.target.id === 'sdesc') SETUP.text = e.target.value; });
document.addEventListener('change', (e) => { const sf = e.target.dataset?.sf; if (sf && SETUP.req) setupEdit(sf, e.target.type === 'checkbox' ? e.target.checked : e.target.value); });
document.addEventListener('change', (e) => { const f = e.target.dataset?.filter; if (f) { FILTER[f] = e.target.value; paint(); } });
addEventListener('hashchange', () => { setPanel(false); paint(); scrollTo(0, 0); });
$('scrim').onclick = () => setPanel(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setPanel(false); });
$('logo').innerHTML = crab('Manager', 'working');
$('railclock').textContent = 'v0.1';
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-more]')) { const d = $('dlg'); d.innerHTML = '<h3>More</h3><p style="display:flex;flex-direction:column;gap:8px"><a class="btn" href="#/cost">Cost</a><a class="btn" href="#/activity">Activity</a><a class="btn" href="#/models">Models</a><a class="btn" href="#/safety">Safety</a><a class="btn" href="#/setup">Set up</a></p><div class="acts"><button class="btn" type="button" data-x>Close</button></div>'; d.querySelectorAll('a,[data-x]').forEach((b) => { b.onclick = () => d.close(); }); d.showModal(); return; }
  const ps = e.target.closest('[data-preset]'); if (ps) return setupPreset(ps.dataset.preset);
  const su = e.target.closest('[data-setup]'); if (su && !su.disabled) { const a = su.dataset.setup; if (a === 'read') return setupInterpret(); if (a === 'apply') return setupApply(); if (a === 'back') { SETUP.step = 'describe'; return paint(); } if (a === 'again') { Object.assign(SETUP, { step: 'describe', req: null, bp: null, job: null, errors: [], note: '' }); return paint(); } }
  const ag = e.target.closest('[data-agent]'); if (ag) return openAgent(ag.dataset.agent);
  if (e.target.closest('[data-close-panel]')) return setPanel(false);
  const cp = e.target.closest('[data-copy]'); if (cp) { navigator.clipboard?.writeText($('cmd').textContent).then(() => toast('Command copied.'), () => toast('Select the command and copy it.', true)); return; }
  const sb = e.target.closest('[data-safety]'); if (sb && !sb.disabled) return runSafety(sb.dataset.safety);
  const t = e.target.closest('[data-act],[data-logs],[data-doctor]'); if (!t || t.disabled) return;
  if (t.dataset.act) { const [action, service] = t.dataset.act.split(':'); return askAction(service, action); }
  if (t.dataset.logs) return toggleLogs(t.dataset.logs);
  if (t.hasAttribute('data-doctor')) return runDoctorNow();
});
applyTheme(); paint(); load(); loadAudit();
setInterval(load, 5000);
setInterval(() => { const el = $('checked'); if (el && S) el.textContent = `Checked ${ago(S.checkedAt)}`; }, 1000);
