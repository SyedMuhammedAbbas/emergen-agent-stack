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
  return `<section class="card" aria-labelledby="h-crew"><h2 id="h-crew">Crew</h2>${S.crew.length ? `<div class="crew">${groups}</div><p class="tiles-note">The same crabs as the Claude mod. Walking means working, dim means idle, red means it needs attention.</p>` : '<p class="hint">No agents to show.</p>'}</section>`;
}
function recentCard() {
  const word = { succeeded: ['ok', 'Succeeded'], failed: ['fail', 'Failed'], running: ['ok', 'Working'], queued: ['idle', 'Queued'], cancelled: ['off', 'Cancelled'] };
  const rows = S.recent.map((r) => { const [k, t] = word[r.status] ?? ['off', r.status]; return `<div class="row" style="grid-template-columns:48px minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.5fr)"><span style="width:42px">${crabSvg(r.agent, r.status === 'running' ? 'working' : r.status === 'failed' ? 'error' : 'idle')}</span><span><span class="t">${esc(r.agent)}</span></span><span>${lamp(k === 'idle' ? 'off' : k, t)}</span><span class="s mono-s" style="text-align:right">${ago(r.at)}${r.costUsd != null ? `<br>${usd(r.costUsd)}${r.subscription ? ' · subscription' : ''}` : ''}</span></div>`; }).join('');
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

// ---- shell ----
const ROUTES = { home: ['Home', home, 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'], services: ['Services', services, 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6'] };
const icon = (p) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${p}"/></svg>`;
const route = () => { const h = (location.hash.replace(/^#\/?/, '') || 'home').split('/')[0]; return ROUTES[h] ? h : 'home'; };

function paint() {
  const r = route(), badge = S?.needs.length ?? 0;
  $('nav').innerHTML = Object.entries(ROUTES).map(([k, v]) => `<a href="#/${k}" ${k === r ? 'aria-current="page"' : ''}>${icon(v[2])}<span>${v[0]}</span>${k === 'home' && badge ? `<b class="badge" aria-label="${badge} need you">${badge}</b>` : ''}</a>`).join('');
  $('tabs').style.gridTemplateColumns = `repeat(${Object.keys(ROUTES).length},1fr)`;
  $('tabs').innerHTML = Object.entries(ROUTES).map(([k, v]) => `<a href="#/${k}" ${k === r ? 'aria-current="page"' : ''}>${icon(v[2])}${v[0]}</a>`).join('');
  const main = $('main');
  if (failure) main.innerHTML = `<h1>Cannot read the stack</h1><div class="err" role="alert"><p><b>${esc(failure.title)}</b></p><p class="hint">${esc(failure.hint)}</p></div>`;
  else if (!S) main.innerHTML = '<p style="color:var(--ink-3)">Loading…</p>';
  else main.innerHTML = ROUTES[r][1]();
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
addEventListener('hashchange', () => { paint(); scrollTo(0, 0); });
$('logo').innerHTML = crab('Manager', 'working');
$('railclock').textContent = 'v0.1';
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-logs],[data-doctor]'); if (!t || t.disabled) return;
  if (t.dataset.act) { const [action, service] = t.dataset.act.split(':'); return askAction(service, action); }
  if (t.dataset.logs) return toggleLogs(t.dataset.logs);
  if (t.hasAttribute('data-doctor')) return runDoctorNow();
});
applyTheme(); paint(); load(); loadAudit();
setInterval(load, 5000);
setInterval(() => { const el = $('checked'); if (el && S) el.textContent = `Checked ${ago(S.checkedAt)}`; }, 1000);
