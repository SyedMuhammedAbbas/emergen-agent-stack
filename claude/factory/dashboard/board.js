'use strict';
// Board tab: one Kanban board per Odoo project. Read-only toward Odoo (search_read / read_group /
// search_count / fields_get over JSON-RPC, credentials read from Hermes' .env at request time and never
// sent to the browser). Badges (branch, active now, factory job, queue bucket) are computed locally.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BOARDS_FILE = path.join(ROOT, 'boards.json');
const JOBS_DIR = path.join(ROOT, 'jobs');
const ENV_FILE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes', '.env');
const OWNER = 7; // res.users id of Syed Abbas
const TTL = 60 * 1000;
const ACTIVE_MS = 15 * 60 * 1000;
const READ_ONLY = new Set(['search_read', 'read', 'read_group', 'search_count', 'fields_get']);

// ---------- Odoo JSON-RPC ----------

function loadEnv() {
  const env = {};
  for (const l of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
    if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  for (const k of ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY']) if (!env[k]) throw new Error(`${k} missing in the Hermes .env`);
  env.ODOO_URL = env.ODOO_URL.replace(/\/+$/, '').replace(/\/(xmlrpc|jsonrpc)(\/2)?$/, '');
  return env;
}

let session = null; // { sig, uid }
async function odoo() {
  const env = loadEnv();
  const secret = env.ODOO_API_KEY;
  const clean = (m) => String(m).split(secret).join('***');
  const rpc = async (service, method, args) => {
    let j;
    try {
      const r = await fetch(env.ODOO_URL + '/jsonrpc', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      j = await r.json();
    } catch (e) { throw new Error('Odoo unreachable: ' + clean(e.message)); }
    if (j.error) throw new Error('Odoo: ' + clean((j.error.data && j.error.data.message) || j.error.message));
    return j.result;
  };
  const sig = [env.ODOO_URL, env.ODOO_DB, env.ODOO_USERNAME, secret].join('|');
  if (!session || session.sig !== sig) {
    const uid = await rpc('common', 'authenticate', [env.ODOO_DB, env.ODOO_USERNAME, secret, {}]);
    if (!uid) throw new Error('Odoo: authentication failed');
    session = { sig, uid };
  }
  const x = (model, method, args, kw = {}) => {
    if (!READ_ONLY.has(method)) throw new Error('write methods are not allowed: ' + method);
    return rpc('object', 'execute_kw', [env.ODOO_DB, session.uid, secret, model, method, args, kw]);
  };
  return { x, url: env.ODOO_URL, uid: session.uid };
}

let ticketField; // discovered once via fields_get
async function findTicketField(x) {
  if (ticketField !== undefined) return ticketField;
  const f = await x('project.task', 'fields_get', [], { attributes: ['type', 'string'] });
  const c = Object.keys(f).filter((n) => /ticket|task_number/i.test(n) || /ticket|task number/i.test(f[n].string));
  const pick = c.find((n) => f[n].type === 'integer') || c.find((n) => f[n].type === 'char') || null;
  return (ticketField = pick);
}

// ---------- boards.json ----------

const readBoards = () => { try { return JSON.parse(fs.readFileSync(BOARDS_FILE, 'utf8')); } catch { return null; } };
const git = (repo, args) => new Promise((res) => execFile('git', ['-C', repo, ...args], { timeout: 10000, windowsHide: true, maxBuffer: 16 << 20 }, (err, out) => res(err ? null : out)));

const REPO_ROOTS = ['D:\\Projects\\Emergen', 'D:\\Projects\\Personal'];
const KNOWN = [
  { re: /neurax/i, repos: ['D:\\Projects\\Emergen\\NeuraX\\neurax-backend', 'D:\\Projects\\Emergen\\NeuraX\\neurax-dashboard', 'D:\\Projects\\Emergen\\NeuraX\\neurax-app'], integration: 'staging', queue: 'D:\\Projects\\Emergen\\NeuraX\\.claude\\work-queue.md' },
  { re: /radbase/i, repos: ['D:\\Projects\\Personal\\reports-scoped'], integration: 'main' },
];
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

async function guessRepos(name) {
  const k = KNOWN.find((e) => e.re.test(name));
  if (k) return { repos: k.repos.filter((r) => fs.existsSync(r)), integration: k.integration, queue: k.queue };
  const n = norm(name);
  const hits = [];
  for (const root of REPO_ROOTS) {
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch { continue; }
    for (const d of dirs) {
      const dn = norm(d);
      if (dn.length >= 5 && n.length >= 5 && (dn.includes(n) || n.includes(dn)) && fs.existsSync(path.join(root, d, '.git'))) hits.push(path.join(root, d));
    }
  }
  // shortcut: a repo is only guessed when the folder and project names contain each other; edit boards.json for the rest
  const integration = hits.length && (await git(hits[0], ['rev-parse', '--verify', '--quiet', 'origin/staging'])) ? 'staging' : 'main';
  return { repos: hits, integration };
}

async function discover() {
  const { x } = await odoo();
  const groups = await x('project.task', 'read_group', [[['user_ids', 'in', [OWNER]], ['state', 'not in', ['1_done', '1_canceled']], ['project_id.active', '=', true]], ['project_id'], ['project_id']], { lazy: false });
  const found = new Map(groups.filter((g) => g.project_id).map((g) => [g.project_id[0], g.project_id[1]]));
  const extra = await x('project.project', 'search_read', [['|', ['id', '=', 91], ['name', 'ilike', 'radbase']]], { fields: ['name'] });
  for (const p of extra) found.set(p.id, p.name);
  const cur = readBoards() || { owner: OWNER, boards: [] };
  for (const [id, name] of found) {
    if (cur.boards.some((b) => b.id === id)) continue; // never overwrite the owner's edits
    const g = await guessRepos(name);
    cur.boards.push({ id, name, repos: g.repos, integration: g.integration, ...(g.queue ? { queue: g.queue } : {}) });
  }
  cur.boards.sort((a, b) => (a.id === 91 ? -1 : b.id === 91 ? 1 : a.name.localeCompare(b.name)));
  fs.writeFileSync(BOARDS_FILE, JSON.stringify(cur, null, 2) + '\n');
  return cur;
}

// ---------- HTML to plain text ----------

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function plain(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Odoo data per project (60 s cache, stale fallback) ----------

const isDone = (s) => s.fold || /done|cancel|closed|complete/i.test(s.name);
const DONE_LIMIT = 150;
const cache = new Map(); // project id -> { at, data, error }
const inflight = new Map();

async function fetchProject(b) {
  const { x, url } = await odoo();
  const tf = await findTicketField(x);
  const [stages, groups] = await Promise.all([
    x('project.task.type', 'search_read', [[['project_ids', 'in', [b.id]]]], { fields: ['name', 'sequence', 'fold'], order: 'sequence, id' }),
    x('project.task', 'read_group', [[['project_id', '=', b.id]], ['stage_id'], ['stage_id']], { lazy: false }),
  ]);
  const counts = new Map(groups.filter((g) => g.stage_id).map((g) => [g.stage_id[0], g.__count]));
  const doneIds = stages.filter(isDone).map((s) => s.id);
  const fields = ['name', 'stage_id', 'user_ids', 'tag_ids', 'milestone_id', 'priority', 'date_deadline', 'state', 'write_date', ...(tf ? [tf] : [])];
  const [open, done] = await Promise.all([
    x('project.task', 'search_read', [[['project_id', '=', b.id], ['stage_id', 'not in', doneIds]]], { fields, order: 'priority desc, id desc' }),
    doneIds.length ? x('project.task', 'search_read', [[['project_id', '=', b.id], ['stage_id', 'in', doneIds]]], { fields, order: 'write_date desc', limit: DONE_LIMIT }) : [],
  ]);
  const tasks = [...open, ...done];
  const uids = [...new Set(tasks.flatMap((t) => t.user_ids))];
  const tids = [...new Set(tasks.flatMap((t) => t.tag_ids))];
  const [users, tags] = await Promise.all([
    uids.length ? x('res.users', 'read', [uids], { fields: ['name'] }) : [],
    tids.length ? x('project.tags', 'read', [tids], { fields: ['name'] }) : [],
  ]);
  const cols = stages.filter((s) => !isDone(s)).map((s) => ({ id: s.id, name: s.name, tasks: [], count: counts.get(s.id) || 0 }));
  const doneCol = { id: 'done', name: 'Done / Cancelled', done: true, tasks: [], count: doneIds.reduce((n, id) => n + (counts.get(id) || 0), 0), parts: stages.filter(isDone).map((s) => ({ name: s.name, count: counts.get(s.id) || 0 })) };
  for (const t of tasks) {
    const sid = t.stage_id && t.stage_id[0];
    let col = doneIds.includes(sid) ? doneCol : cols.find((c) => c.id === sid);
    if (!col) { col = { id: sid, name: t.stage_id ? t.stage_id[1] : '(no stage)', tasks: [], count: counts.get(sid) || 0 }; cols.push(col); }
    col.tasks.push({
      id: t.id, title: t.name, ticket: tf && t[tf] ? t[tf] : null, assignees: t.user_ids, tags: t.tag_ids,
      milestone: t.milestone_id ? t.milestone_id[1] : null, priority: t.priority, deadline: t.date_deadline || null,
      state: t.state, updated: t.write_date,
    });
  }
  if (doneCol.count || doneCol.tasks.length) cols.push(doneCol);
  return {
    odooUrl: url, ticketField: tf, generated: new Date().toISOString(), columns: cols,
    users: Object.fromEntries(users.map((u) => [u.id, u.name])), tags: Object.fromEntries(tags.map((t) => [t.id, t.name])),
  };
}

function projectData(b, force) {
  const c = cache.get(b.id);
  if (c && !force && Date.now() - c.at < TTL) return Promise.resolve({ ...c, stale: false });
  if (!inflight.has(b.id)) {
    inflight.set(b.id, fetchProject(b)
      .then((data) => { cache.set(b.id, { at: Date.now(), data }); return { at: Date.now(), data, stale: false }; })
      .catch((e) => {
        const old = cache.get(b.id);
        if (!old) throw e;
        return { ...old, stale: true, error: e.message };
      })
      .finally(() => inflight.delete(b.id)));
  }
  return inflight.get(b.id);
}

// ---------- local badges ----------

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matchers(t) {
  const eme = [...new Set([...String(t.title).matchAll(/EME-(\d+)/gi)].map((m) => m[1]))];
  const branch = [], text = [];
  if (eme.length) { const r = `EME-(?:${eme.join('|')})(?!\\d)`; branch.push(r); text.push(r); }
  if (t.ticket) { const r = `ticket[\\s#_-]*${t.ticket}(?!\\d)`; branch.push(r); text.push(r); }
  branch.push(`(?<!\\d)${t.id}(?!\\d)`);
  text.push(`(?:odoo|project\\.task)[\\s#:/_-]*${t.id}(?!\\d)`);
  return { branch: new RegExp(branch.join('|'), 'i'), text: new RegExp(text.join('|'), 'i'), eme, ticket: t.ticket, id: t.id };
}

const refCache = new Map(); // repo -> { at, refs }
async function repoRefs(repo, integration) {
  const c = refCache.get(repo);
  if (c && Date.now() - c.at < TTL) return c.refs;
  const fmt = '%(refname:short)\t%(objectname)';
  const base = `origin/${integration}`;
  const [all, merged] = await Promise.all([
    git(repo, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes']),
    git(repo, ['for-each-ref', `--merged=${base}`, `--format=${fmt}`, 'refs/heads', 'refs/remotes']),
  ]);
  const repoName = path.basename(repo);
  const refs = [];
  if (all) {
    const mergedSet = merged == null ? null : new Set(merged.split('\n').map((l) => l.split('\t')[0]));
    const tip = (all.split('\n').map((l) => l.split('\t')).find((p) => p[0] === base) || [])[1];
    const byName = new Map();
    for (const l of all.split('\n')) {
      const [ref, sha] = l.split('\t');
      if (!ref || ref === 'origin' || ref.endsWith('/HEAD')) continue;
      const name = ref.replace(/^origin\//, '');
      if (name === integration || name === 'main' || name === 'master') continue;
      const prev = byName.get(name) || { name, repo: repoName, local: false, remote: false, merged: null, sha };
      if (ref.startsWith('origin/')) prev.remote = true; else prev.local = true;
      // a branch is merged when either of its refs is an ancestor of the integration branch; same tip = nothing to merge yet
      prev.merged = mergedSet ? (prev.merged || mergedSet.has(ref)) : null;
      prev.atTip = tip ? sha === tip : false;
      byName.set(name, prev);
    }
    refs.push(...byName.values());
  }
  refCache.set(repo, { at: Date.now(), refs });
  return refs;
}

let queueCache = { file: null, mtime: 0, map: new Map() };
function queueBuckets(file) {
  const map = new Map();
  if (!file) return map;
  let st;
  try { st = fs.statSync(file); } catch { return map; }
  if (queueCache.file === file && queueCache.mtime === st.mtimeMs) return queueCache.map;
  // shortcut: format of work-queue.md is not fixed yet; a bucket is the letter A-F in a "Bucket X"/"## X" heading
  // or a lone table cell, applied to every ticket/EME/Odoo id on the line. Tighten when the file format is settled.
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const h = /^#{1,4}\s*(?:bucket\s*)?([A-F])(?![A-Za-z0-9])/i.exec(line);
    if (h) { cur = h[1].toUpperCase(); continue; }
    if (/^#{1,4}\s/.test(line)) { cur = null; continue; }
    const cell = /\|\s*(?:bucket\s*)?([A-F])\s*\|/i.exec(line) || /\bbucket[\s:]*([A-F])\b/i.exec(line);
    const b = cell ? cell[1].toUpperCase() : cur;
    if (!b) continue;
    for (const m of line.matchAll(/(?:ticket\s*#?|#)(\d+)/gi)) map.set('t' + m[1], b);
    for (const m of line.matchAll(/EME-(\d+)/gi)) map.set('e' + m[1], b);
    for (const m of line.matchAll(/(?:odoo|task)[\s#:/_-]*(\d{4,})/gi)) map.set('o' + m[1], b);
  }
  queueCache = { file, mtime: st.mtimeMs, map };
  return map;
}

function readJobs() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(JOBS_DIR); } catch { return out; }
  for (const d of dirs) {
    try { const raw = fs.readFileSync(path.join(JOBS_DIR, d, 'job.json'), 'utf8'); const j = JSON.parse(raw); out.push({ id: j.id || d, stage: j.stage, round: j.round, raw, branches: [].concat(j.branch || []) }); } catch { /* not a job */ }
  }
  return out;
}

async function badges(b, tasks, deps) {
  const refs = (await Promise.all((b.repos || []).filter((r) => fs.existsSync(r)).map((r) => repoRefs(r, b.integration || 'main')))).flat();
  const cut = Date.now() - ACTIVE_MS;
  const recent = deps.loadEvents(2).filter((e) => Date.parse(e.ts) >= cut).reverse().map((e) => ({
    e, text: [e.tool, e.prompt, e.branch, e.message, e.error_text, e.cwd].filter(Boolean).join('\n'),
  }));
  const jobs = readJobs();
  const queue = queueBuckets(b.queue);
  const out = new Map();
  for (const t of tasks) {
    const m = matchers(t);
    const bd = {};
    const hit = refs.filter((r) => m.branch.test(r.name));
    if (hit.length) bd.branches = hit.map((r) => ({ name: r.name, repo: r.repo, local: r.local, remote: r.remote, merged: r.merged, atTip: r.atTip }));
    const names = hit.map((r) => r.name);
    const ev = recent.find((r) => m.text.test(r.text) || names.some((n) => r.text.includes(n)));
    if (ev) bd.active = { agent: ev.e.agent_type || 'main session', tool: ev.e.tool_name || ev.e.event, ts: ev.e.ts, project: ev.e.project };
    const job = jobs.find((j) => m.text.test(j.raw) || j.branches.some((n) => names.includes(String(n).replace(/^origin\//, ''))));
    if (job) bd.job = { id: job.id, stage: job.stage, round: job.round };
    const q = (m.ticket && queue.get('t' + m.ticket)) || m.eme.map((n) => queue.get('e' + n)).find(Boolean) || queue.get('o' + t.id);
    if (q) bd.bucket = q;
    if (Object.keys(bd).length) out.set(t.id, bd);
  }
  return out;
}

// ---------- API ----------

async function boardApi(url, deps) {
  let cfg = readBoards();
  if (!cfg) { try { cfg = await discover(); } catch (e) { return [502, { error: e.message }]; } }
  const id = url.searchParams.get('id');
  if (!id) return [200, { owner: cfg.owner || OWNER, boards: cfg.boards.map((b) => ({ id: b.id, name: b.name, repos: (b.repos || []).length })) }];
  const b = cfg.boards.find((x) => x.id === Number(id));
  if (!b) return [404, { error: 'unknown board' }];
  let p;
  try { p = await projectData(b, url.searchParams.get('refresh') === '1'); } catch (e) { return [502, { error: e.message }]; }
  const all = p.data.columns.flatMap((c) => c.tasks);
  const bd = await badges(b, all, deps);
  const columns = p.data.columns.map((c) => ({ ...c, tasks: c.tasks.map((t) => ({ ...t, badges: bd.get(t.id) || null })) }));
  return [200, {
    board: { id: b.id, name: b.name, repos: b.repos || [], integration: b.integration || 'main' }, owner: cfg.owner || OWNER,
    odooUrl: p.data.odooUrl, users: p.data.users, tags: p.data.tags, columns,
    generated: p.data.generated, cachedFor: Math.round((Date.now() - p.at) / 1000), stale: p.stale, error: p.error || null,
  }];
}

const taskCache = new Map();
async function taskApi(url) {
  const id = Number(url.searchParams.get('id'));
  const cfg = readBoards();
  if (!id || !cfg) return [400, { error: 'bad request' }];
  const c = taskCache.get(id);
  if (c && Date.now() - c.at < TTL) return [200, c.data];
  try {
    const { x } = await odoo();
    // only tasks of a configured board can be read through this endpoint
    const t = await x('project.task', 'search_read', [[['id', '=', id], ['project_id', 'in', cfg.boards.map((b) => b.id)]]], { fields: ['description'], limit: 1 });
    if (!t.length) return [404, { error: 'task not on a configured board' }];
    const msgs = await x('mail.message', 'search_read', [[['model', '=', 'project.task'], ['res_id', '=', id], ['message_type', 'in', ['comment', 'email']]]], { fields: ['date', 'author_id', 'body'], order: 'date desc', limit: 12 });
    const data = {
      id, description: plain(t[0].description),
      messages: msgs.map((m) => ({ date: m.date, author: m.author_id ? m.author_id[1] : null, text: plain(m.body) })).filter((m) => m.text).slice(0, 3),
    };
    taskCache.set(id, { at: Date.now(), data });
    return [200, data];
  } catch (e) {
    return c ? [200, { ...c.data, stale: true, error: e.message }] : [502, { error: e.message }];
  }
}

// Returns a promise of [status, body] for a board route, or null when the path is not one of ours.
function handle(method, url, deps) {
  if (url.pathname === '/api/boards' && method === 'GET') return boardApi(url, deps);
  if (url.pathname === '/api/boards/discover' && method === 'POST') return discover().then((c) => [200, { boards: c.boards.length }], (e) => [502, { error: e.message }]);
  if (url.pathname === '/api/board' && method === 'GET') return boardApi(url, deps);
  if (url.pathname === '/api/board/task' && method === 'GET') return taskApi(url);
  return null;
}

module.exports = { handle, plain, matchers, queueBuckets, fetchProject, discover };
