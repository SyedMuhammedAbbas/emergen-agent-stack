// Setup wizard UI. No framework: state in S, one render() per step, the company panel redrawn on every change.
const T = new URLSearchParams(location.search).get('t') ?? ''
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'x-wizard-token': T, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${r.statusText}`)
  return j
}

const AREAS = [
  { id: 'paperclip', name: 'Agent company', blurb: 'Departments of Claude Code agents that Paperclip runs for you.', c: 'var(--eng)' },
  { id: 'personal', name: 'Personal workspace', blurb: 'Sort new downloads automatically and set up your project folders.', c: 'var(--ops)' },
  { id: 'branding', name: 'Branding and content', blurb: 'A brand lead, designer, video maker and content writer.', c: 'var(--brand)' },
  { id: 'freelance', name: 'Freelance', blurb: 'An Upwork scout that screens jobs and drafts proposals.', c: 'var(--free)' },
  { id: 'routing', name: 'Model routing', blurb: 'OmniRoute sends each request to a provider that still has quota.', c: 'var(--eng)' },
  { id: 'mods', name: 'Claude mods', blurb: 'A pixel crab per agent above your prompt.', c: 'var(--clay)' },
]
const SUG_AREAS = { paperclip: ['paperclip', 'claude'], personal: ['personal'], branding: ['branding'], freelance: ['freelance'], routing: [], mods: ['mods', 'claude'] }
const DEPT_COLOR = { engineering: 'var(--eng)', operations: 'var(--ops)', branding: 'var(--brand)', freelance: 'var(--free)' }
const KEY = 'agent-stack-wizard-v1'
const DEFAULT = {
  step: 'welcome', areas: ['paperclip'], company: '',
  paperclip: { departments: ['engineering', 'operations'], profile: 'balanced' },
  personal: { organizer: true, categories: ['Emergen', 'Personal'], projectsRoot: 'C:\\Abbas' },
  branding: { name: '', offer: '', audience: '', tone: '', website: '', linkedin: '', channels: ['Website posts', 'LinkedIn'] },
  freelance: { upworkMcp: true }, routing: { omniroute: true }, mods: { crew: true },
}
let S, ST, SUG, PLAN = null, JOB = null, rendered = new Set()
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)) } catch {} }
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
const setPath = (o, p, v) => { const k = p.split('.'); const last = k.pop(); k.reduce((a, x) => a[x], o)[last] = v }
const money = n => `$${n < 10 ? n.toFixed(2) : Math.round(n)}`

// ---- derived values ----
const stepList = () => ['welcome', 'areas', ...AREAS.filter(a => S.areas.includes(a.id)).map(a => a.id), 'review', 'run']
const labelOf = id => ({ welcome: 'Welcome', areas: 'What to set up', review: 'Review', run: 'Run' }[id] ?? AREAS.find(a => a.id === id).name)
function effectiveDepts() {
  const d = new Set(S.areas.includes('paperclip') ? S.paperclip.departments : [])
  if (S.areas.includes('branding')) d.add('branding')
  if (S.areas.includes('freelance')) d.add('freelance')
  if (d.size) d.add('engineering')
  return ['engineering', 'operations', 'branding', 'freelance'].filter(x => d.has(x))
}
function idleCost(profileKey, depts) {
  const p = ST.profiles.profiles[profileKey], c = ST.profiles.perRun
  let m = 0
  if (depts.includes('engineering')) m += p.runs.heartbeat * c.heartbeat
  if (depts.includes('operations')) m += p.runs.watchdog * c.watchdog + p.runs.report * c.report + ST.profiles.timesheetRunsPerMonth * c.timesheet
  return m
}

// ---- pixel crab, in the family of the Mod Bar crabs: clay body, the department's colour as its cap ----
const crab = color => `<svg viewBox="0 0 30 28" shape-rendering="crispEdges" aria-hidden="true"><rect x="7" y="10" width="16" height="12" fill="#d97757"/><rect x="3" y="14" width="4" height="4" fill="#d97757"/><rect x="23" y="14" width="4" height="4" fill="#d97757"/><rect x="9" y="12" width="2" height="2" fill="#1f1e1d"/><rect x="19" y="12" width="2" height="2" fill="#1f1e1d"/><rect x="7" y="22" width="2" height="4" fill="#d97757"/><rect x="11" y="22" width="2" height="4" fill="#d97757"/><rect x="17" y="22" width="2" height="4" fill="#d97757"/><rect x="21" y="22" width="2" height="4" fill="#d97757"/><rect x="9" y="7" width="12" height="3" fill="${color}"/><rect x="20" y="9" width="5" height="2" fill="${color}"/></svg>`

function renderCompany() {
  const depts = ST.departments.filter(d => effectiveDepts().includes(d.key))
  const now = new Set(); let i = 0
  $('#chart').innerHTML = depts.length
    ? `<div class="org"><div class="you">You</div><div class="tree">${depts.map(d => `<section class="dept" style="--c:${DEPT_COLOR[d.key]}"><h3>${esc(d.name)}</h3><div class="crabs">${d.agents.map(a => { const k = `${d.key}/${a.key}`; now.add(k); const fresh = !rendered.has(k); return `<div class="agent${fresh ? ' new' : ''}" style="--i:${fresh ? i++ : 0}">${crab(DEPT_COLOR[d.key])}${esc(a.name)}</div>` }).join('')}</div></section>`).join('')}</div></div>`
    : `<p class="empty">Pick what to set up and your agents appear here.</p>`
  rendered = now
  const caps = depts.reduce((n, d) => n + d.agents.reduce((m, a) => m + (a.budgetCents ?? 0), 0), 0) / 100
  const agents = depts.reduce((n, d) => n + d.agents.length, 0)
  const rows = []
  if (agents) rows.push(['Agents', String(agents), `${depts.length} department${depts.length > 1 ? 's' : ''}`])
  if (depts.some(d => d.key === 'engineering' || d.key === 'operations')) {
    const m = idleCost(S.paperclip.profile, effectiveDepts())
    rows.push(['Idle cost a month', money(m), 'With no tasks given. Estimated from runs measured on this stack; API-equivalent value, not a bill.'])
  }
  if (caps) rows.push(['Spend caps', money(caps), 'Per-agent monthly allowances. Paperclip does not enforce them for subscription runs.'])
  $('#meter').innerHTML = rows.map(([k, v, s]) => `<div><dt>${k}</dt><dd>${v}</dd><small>${esc(s)}</small></div>`).join('')
}

// ---- stepper ----
function renderRail() {
  const list = stepList(), at = list.indexOf(S.step)
  $('#steps').innerHTML = list.map((id, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}" ${i === at ? 'aria-current="step"' : ''}><span class="n">${i < at ? '✓' : i + 1}</span>${esc(labelOf(id))}</li>`).join('')
  $('#progress').innerHTML = `<div class="pt"><span>Step ${at + 1} of ${list.length}</span><b>${esc(labelOf(S.step))}</b></div><div class="bar" role="presentation"><i style="width:${Math.round(((at + 1) / list.length) * 100)}%"></i></div>`
  $('#mode').innerHTML = ST.dry ? '<span class="badge">preview</span> Nothing is changed.' : 'Changes are made only after you review them.'
}

// ---- pieces ----
const nav = (back = true, next = 'Continue', disabled = false) => `<div class="actions">${back ? '<button class="btn" data-act="back">Back</button>' : ''}<button class="btn primary" data-act="next" ${disabled ? 'disabled' : ''}>${next}</button></div>`
const head = (eyebrow, title, lede) => `<p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${lede ? `<p class="lede">${esc(lede)}</p>` : ''}`
const field = (label, path, hint = '', ph = '') => `<label class="field">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}<input type="text" data-bind="${path}" value="${esc(path.split('.').reduce((o, k) => o?.[k], S))}" placeholder="${esc(ph)}"></label>`
const check = (path, value, title, desc, { locked = false, pill = '' } = {}) => `<label class="choice"><input type="checkbox" data-toggle="${path}" data-value="${esc(value)}" ${path.split('.').reduce((o, k) => o?.[k], S).includes(value) || locked ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><b>${esc(title)}${pill ? `<span class="pill">${esc(pill)}</span>` : ''}</b><span class="d">${esc(desc)}</span></span></label>`
const flag = (path, title, desc) => `<label class="choice"><input type="checkbox" data-flag="${path}" ${path.split('.').reduce((o, k) => o?.[k], S) ? 'checked' : ''}><span><b>${esc(title)}</b><span class="d">${esc(desc)}</span></span></label>`

function others(areaId) {
  const keys = SUG_AREAS[areaId]; if (!keys?.length) return ''
  const items = SUG.items.filter(i => keys.includes(i.area)).sort((a, b) => b.stars - a.stars).slice(0, 4)
  if (!items.length) return ''
  const col = AREAS.find(a => a.id === areaId).c
  return `<section class="others" aria-label="What others have built"><header><div><h2>What others have built</h2><p>Real projects from GitHub, checked ${esc(SUG.generatedAt)}. Nothing here is installed for you.</p></div><button class="link" data-act="refresh">Refresh</button></header><div class="sug" style="--sugc:${col}">${items.map(i => `<article><h3><a href="https://github.com/${esc(i.repo)}" target="_blank" rel="noopener noreferrer">${esc(i.repo)}</a><span class="meta">${i.stars.toLocaleString()} ★ · ${esc(i.license)} · pushed ${esc(i.pushed)}</span></h3><p>${esc(i.summary)}</p><p class="why">${esc(i.why)}</p>${i.caution ? `<p class="warn">Check first: ${esc(i.caution)}</p>` : ''}</article>`).join('')}</div><p class="fine">Read a project's code and licence before installing it. This stack's rule: nothing from the internet is installed without your yes.</p></section>`
}

const VIEWS = {
  welcome() {
    const dot = (on, label) => `<div><span class="dot ${on ? 'on' : 'off'}"></span>${label}</div>`
    return `${head('Welcome', 'Set up your agent company', 'Pick what you need, answer a few questions, review exactly what will change, then run it. You can stop at any step and come back; your answers are kept.')}
    <div class="stack"><section class="card"><h3>This computer</h3><p class="mono" style="margin-top:6px">${esc(ST.os)} · node ${esc(ST.node)}</p><div class="status" style="margin-top:12px">${dot(ST.services.paperclip, ST.services.paperclip ? 'Paperclip is running at localhost:3100' : 'Paperclip is not running')}${dot(ST.services.jevRouter, ST.services.jevRouter ? 'jev-router is running' : 'jev-router is not running')}${dot(ST.services.omniroute, ST.services.omniroute ? 'OmniRoute is running' : 'OmniRoute is not installed yet')}${dot(ST.configExists, ST.configExists ? 'config.env found: your current settings are the starting point' : 'No config.env yet: one is created from the team template')}</div></section></div>
    <div class="actions"><button class="btn primary" data-act="next">Start</button></div>`
  },
  areas() {
    return `${head('Your setup', 'What do you want to set up?', 'Choose any combination. Each choice adds a few questions and, at the end, a reviewable list of changes.')}
    <div class="stack"><div class="choices two">${AREAS.map(a => `<label class="choice"><input type="checkbox" data-toggle="areas" data-value="${a.id}" ${S.areas.includes(a.id) ? 'checked' : ''}><span><b>${esc(a.name)}</b><span class="d">${esc(a.blurb)}</span></span></label>`).join('')}</div></div>${nav(true, 'Continue', !S.areas.length)}`
  },
  paperclip() {
    const profs = Object.entries(ST.profiles.profiles)
    const forced = d => (d === 'branding' && S.areas.includes('branding')) || (d === 'freelance' && S.areas.includes('freelance')) || d === 'engineering'
    const dep = ST.departments.map(d => check('paperclip.departments', d.key, d.name, `${d.description} (${d.agents.length} agent${d.agents.length === 1 ? '' : 's'})`, { locked: forced(d.key), pill: forced(d.key) && d.key !== 'engineering' ? 'from its own step' : d.key === 'engineering' ? 'always' : '' })).join('')
    return `${head('Agent company', 'Which departments should work for you?', 'Engineering always comes with a Manager who routes work. Add the rest as you need them.')}
    <div class="stack"><section class="card">${field('Company name', 'company', 'Shown in Paperclip and in every agent\'s instructions.', 'Emergen Engineering')}</section>
    <div class="choices">${dep}</div>
    <section class="card"><h3>How active should they be when idle?</h3><p>Scheduled checks cost money even with no tasks. Real work costs extra on top.</p><div class="choices" style="margin-top:12px">${profs.map(([k, p]) => `<label class="choice"><input type="radio" name="profile" data-radio="paperclip.profile" value="${k}" ${S.paperclip.profile === k ? 'checked' : ''}><span><b>${esc(p.label)}<span class="pill">${money(idleCost(k, effectiveDepts()))} a month idle</span></b><span class="d">${esc(p.blurb)}</span></span></label>`).join('')}</div></section></div>${others('paperclip')}${nav()}`
  },
  personal() {
    return `${head('Personal workspace', 'Keep your own files in order', 'The Downloads organizer sorts every new download into a topic folder. Project folders give each company its own place on disk.')}
    <div class="stack">${flag('personal.organizer', 'Sort new downloads automatically', 'A small background watcher moves each finished download into Finance, Identity and Legal, Images, Installers and so on. Works for any app, not only the browser.')}
    <section class="card"><label class="field">Projects folder<small>Where your company folders live. Agents work inside it.</small><input type="text" data-bind="personal.projectsRoot" value="${esc(S.personal.projectsRoot)}"></label>
    <div style="margin-top:16px"><b style="font-size:.9rem">Project folders to create</b><div class="chips" style="margin-top:8px">${S.personal.categories.map(c => `<span class="chip">${esc(c)}<button data-act="rmcat" data-v="${esc(c)}" aria-label="Remove ${esc(c)}">×</button></span>`).join('')}<input type="text" id="addcat" placeholder="Add a folder, press Enter"></div></div></section></div>${others('personal')}${nav()}`
  },
  branding() {
    const ch = ['Website posts', 'LinkedIn', 'Instagram', 'YouTube', 'Newsletter']
    return `${head('Branding and content', 'Tell the content team who you are', 'This becomes a short brand profile that every agent reads. Anything you leave blank, the agents will ask you instead of guessing.')}
    <div class="stack"><section class="card grid2">${field('Brand name', 'branding.name', '', 'Orrisian')}${field('Website', 'branding.website', '', 'https://orrisian.com')}${field('What it does', 'branding.offer', 'One sentence.', '')}${field('Who it is for', 'branding.audience', '', '')}${field('Tone of voice', 'branding.tone', 'Three adjectives work well.', 'Direct, warm, precise')}${field('LinkedIn page', 'branding.linkedin', '', '')}</section>
    <section class="card"><h3>Where will content go?</h3><div class="choices two" style="margin-top:10px">${ch.map(c => check('branding.channels', c, c, '')).join('')}</div><p class="fine">Agents draft; you approve and post. They never publish or log in for you.</p></section></div>${others('branding')}${nav()}`
  },
  freelance() {
    return `${head('Freelance', 'Let a scout find your Upwork work', 'The Upwork Scout screens jobs against your profile and drafts proposals. You read, edit and submit every one yourself.')}
    <div class="stack">${flag('freelance.upworkMcp', 'Connect Upwork\'s official MCP server', 'Lets the scout search jobs and read your profile. It only registers the connection; you sign in to Upwork in a later step, and the scout cannot submit or spend Connects.')}</div>${others('freelance')}${nav()}`
  },
  routing() {
    return `${head('Model routing', 'Stay productive when a provider runs out', 'jev-router decides how hard a task is. OmniRoute then maps that to a provider and falls back to another when one hits its limit.')}
    <div class="stack">${flag('routing.omniroute', 'Install OmniRoute', 'Adds the open-source gateway as a background service on this PC. You add your own provider keys in its dashboard; the wizard never asks for them.')}</div>${nav()}`
  },
  mods() {
    return `${head('Claude mods', 'See your agents working', 'A mini pixel crab for every Paperclip agent above your Claude prompt: walking while it works, dim when idle, red on error.')}
    <div class="stack">${flag('mods.crew', 'Install the Paperclip Crew mod', 'Also adds it to Mod Bar, so you can switch it on and off next to your other mods.')}</div>${others('mods')}${nav()}`
  },
  review() {
    if (!PLAN) return `${head('Review', 'Here is what will change', '')}<p class="lede">Working it out…</p>`
    if (PLAN.error) return `${head('Review', 'One answer needs fixing', '')}<p class="error">${esc(PLAN.error)}</p><div class="actions"><button class="btn" data-act="back">Back and fix it</button></div>`
    const a = PLAN.actions
    return `${head('Review', 'Here is what will change', 'Untick anything you want to skip. Nothing has run yet.')}
    <div class="stack">${a.length ? `<ul class="plan">${a.map(x => `<li><label><input type="checkbox" data-run="${x.id}" checked><span>${esc(x.title)}<span class="note">${esc(x.note ?? '')}</span></span></label><details><summary>Exactly what</summary><pre>${esc(x.detail)}</pre></details></li>`).join('')}</ul>` : '<p class="empty">Nothing to change. Go back and choose something to set up.</p>'}
    ${PLAN.manual.length ? `<section class="card"><h3>Only you can do these</h3><ul class="todo">${PLAN.manual.map(m => `<li><b>${esc(m.title)}</b><span class="mono">${esc(m.detail)}</span></li>`).join('')}</ul></section>` : ''}</div>
    <div class="actions"><button class="btn" data-act="back">Back</button><button class="btn primary" data-act="run" ${a.length ? '' : 'disabled'}>Run the steps</button></div>`
  },
  run() {
    if (!JOB) return `${head('Run', 'Starting…', '')}`
    return `${head('Run', JOB.done ? 'Finished' : 'Running your setup', JOB.done ? 'Each step shows how it ended. Anything that failed explains why in the log.' : 'Leave this page open.')}
    <div class="stack"><ul class="run">${JOB.steps.map(s => `<li><span>${esc(s.title)}</span><span class="st ${s.status}">${s.status}</span></li>`).join('')}</ul><pre id="log" aria-label="Log">${esc(JOB.text)}</pre>
    ${JOB.done && PLAN?.manual?.length ? `<section class="card"><h3>Still yours to do</h3><ul class="todo">${PLAN.manual.map(m => `<li><b>${esc(m.title)}</b><span class="mono">${esc(m.detail)}</span></li>`).join('')}</ul></section>` : ''}</div>`
  },
}

async function render({ focus = true } = {}) {
  renderRail(); renderCompany()
  const v = VIEWS[S.step]
  $('#main').innerHTML = v ? v() : ''
  if (focus) { $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0) }
}
async function go(step) {
  S.step = step; save(); PLAN = null
  await render()
  if (step === 'review') { try { PLAN = await api('/api/plan', selections()) } catch (e) { PLAN = { error: e.message } } render({ focus: false }) }
}
const selections = () => ({ areas: S.areas, company: { name: S.company }, paperclip: S.paperclip, personal: S.personal, branding: S.branding, freelance: S.freelance, routing: S.routing, mods: S.mods })

async function runJob() {
  const ids = [...document.querySelectorAll('[data-run]:checked')].map(e => e.dataset.run)
  JOB = { steps: ids.map(id => ({ title: PLAN.actions.find(a => a.id === id).title, status: 'waiting' })), text: '', done: false }
  await go('run')
  try {
    const { job } = await api('/api/run', { selections: selections(), ids })
    let from = 0
    for (;;) {
      const j = await api(`/api/job/${job}?from=${from}`)
      from = j.next; JOB = { steps: j.steps, text: JOB.text + j.lines.map(l => l + '\n').join(''), done: j.done }
      render({ focus: false }); const log = $('#log'); if (log) log.scrollTop = log.scrollHeight
      if (j.done) break
      await new Promise(r => setTimeout(r, 700))
    }
  } catch (e) { JOB = { steps: JOB.steps, text: `${JOB.text}\n${e.message}`, done: true }; render({ focus: false }) }
}

// ---- events ----
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return
  const list = stepList(), at = list.indexOf(S.step)
  switch (b.dataset.act) {
    case 'next': return go(list[Math.min(at + 1, list.length - 1)])
    case 'back': return go(list[Math.max(at - 1, 0)])
    case 'run': return runJob()
    case 'rmcat': S.personal.categories = S.personal.categories.filter(c => c !== b.dataset.v); save(); return render({ focus: false })
    case 'refresh': { b.textContent = 'Checking GitHub…'; b.disabled = true; try { const r = await api('/api/suggestions/refresh', {}); SUG = r.suggestions; b.textContent = r.ok ? `Updated ${r.ok}` : 'GitHub did not answer' } catch { b.textContent = 'GitHub did not answer' } return setTimeout(() => render({ focus: false }), 900) }
  }
})
document.addEventListener('input', e => { const t = e.target; if (t.dataset.bind) { setPath(S, t.dataset.bind, t.value); save(); renderCompany() } })
document.addEventListener('change', e => {
  const t = e.target
  if (t.dataset.toggle) { const arr = t.dataset.toggle.split('.').reduce((o, k) => o[k], S); const v = t.dataset.value; const i = arr.indexOf(v); if (t.checked && i < 0) arr.push(v); if (!t.checked && i >= 0) arr.splice(i, 1); save(); render({ focus: false }) }
  else if (t.dataset.flag) { setPath(S, t.dataset.flag, t.checked); save(); renderCompany() }
  else if (t.dataset.radio) { setPath(S, t.dataset.radio, t.value); save(); render({ focus: false }) }
})
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'addcat') { e.preventDefault(); const v = e.target.value.trim(); if (v && !S.personal.categories.includes(v)) { S.personal.categories.push(v); save(); render({ focus: false }); $('#addcat')?.focus() } }
})

// ---- start ----
try {
  if (!T) throw new Error('Open the wizard from the link it printed in the terminal: it carries a one-time key.')
  ;[ST, SUG] = await Promise.all([api('/api/state'), api('/api/suggestions')])
  const saved = load()
  S = { ...structuredClone(DEFAULT), ...(saved ?? {}) }
  if (!saved) { // first visit: start from what config.env already says
    const c = ST.config
    if (c.COMPANY_NAME) S.company = c.COMPANY_NAME
    if (c.PROJECT_CATEGORIES) S.personal.categories = c.PROJECT_CATEGORIES.split(',')
    if (c.PROJECTS_ROOT) S.personal.projectsRoot = c.PROJECTS_ROOT.replace(/^\/mnt\/([a-z])\/?/, (_, d) => `${d.toUpperCase()}:\\`).replaceAll('/', '\\')
    if (c.DEPARTMENTS) S.paperclip.departments = c.DEPARTMENTS.split(',').filter(d => ST.departments.some(x => x.key === d))
  }
  if (!stepList().includes(S.step) || S.step === 'run') S.step = 'welcome'
  await render()
} catch (e) { $('#main').innerHTML = `<h1>Can't start</h1><p class="error">${esc(e.message)}</p>` }
