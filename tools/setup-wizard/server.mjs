// Local setup wizard for the agent stack. Run: node tools/setup-wizard/server.mjs   (or setup.cmd at the repo root)
// Loopback only, a random token on every API call, and the browser sends choices, never commands (see actions.mjs).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DRY, EXECUTORS, clean, plan, readConfig } from './actions.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' }

async function ping(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.status < 500 } catch { return false }
}

export function createServer({ repo = path.resolve(here, '..', '..'), token = crypto.randomBytes(16).toString('hex') } = {}) {
  const profiles = JSON.parse(fs.readFileSync(path.join(here, 'profiles.json'), 'utf8'))
  const suggestionsFile = path.join(here, 'suggestions.json')
  const jobs = new Map()

  async function state() {
    const departments = []
    const orgDir = path.join(repo, 'org')
    for (const d of fs.existsSync(orgDir) ? fs.readdirSync(orgDir) : []) {
      const f = path.join(orgDir, d, 'department.json')
      if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); departments.push({ key: j.key, name: j.name, description: j.description, head: j.head, agents: j.agents.map(a => ({ key: a.key, name: a.name, title: a.title, budgetCents: a.budgetCents, router: a.router })) }) }
    }
    const order = ['engineering', 'operations', 'branding', 'freelance']
    departments.sort((x, y) => (order.indexOf(x.key) + 1 || 99) - (order.indexOf(y.key) + 1 || 99))
    const [paperclip, omniroute, jev] = await Promise.all([ping('http://127.0.0.1:3100/api/health'), ping('http://127.0.0.1:20128/'), ping('http://127.0.0.1:4100/')])
    return { repo, dry: DRY(), os: `${os.type()} ${os.release()}`, node: process.version, config: readConfig(repo), configExists: fs.existsSync(path.join(repo, 'config.env')), departments, profiles, services: { paperclip, omniroute, jevRouter: jev } }
  }

  async function body(req) {
    let s = ''; for await (const c of req) { s += c; if (s.length > 200_000) throw new Error('request too large') }
    return s ? JSON.parse(s) : {}
  }
  const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }

  async function refreshSuggestions() {
    const j = JSON.parse(fs.readFileSync(suggestionsFile, 'utf8')); let ok = 0, failed = 0
    for (const it of j.items) {
      try {
        const r = await fetch(`https://api.github.com/repos/${it.repo}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'agent-stack-setup-wizard' }, signal: AbortSignal.timeout(8000) })
        if (!r.ok) { failed++; continue }
        const g = await r.json()
        Object.assign(it, { stars: g.stargazers_count, license: g.license?.spdx_id ?? 'none', pushed: g.pushed_at.slice(0, 10) }); ok++
      } catch { failed++ }
    }
    if (ok) { j.generatedAt = new Date().toISOString().slice(0, 10); fs.writeFileSync(suggestionsFile, JSON.stringify(j, null, 2) + '\n') }
    return { ok, failed, suggestions: j }
  }

  async function startJob(sel, ids) {
    const c = clean(sel), st = await state(), { actions } = plan(c, st)
    const todo = actions.filter(a => ids.includes(a.id))
    const job = { id: crypto.randomBytes(6).toString('hex'), steps: todo.map(a => ({ id: a.id, title: a.title, status: 'waiting' })), lines: [], done: false }
    job.log = line => job.lines.push(line)
    jobs.set(job.id, job)
    ;(async () => {
      for (const [i, a] of todo.entries()) {
        const step = job.steps[i]; step.status = 'running'; job.log(`\n== ${a.title}`)
        try { step.status = (await EXECUTORS[a.id](job, a, repo)) === 0 ? 'done' : 'failed' } catch (e) { job.log(`error: ${e.message}`); step.status = 'failed' }
        if (step.status === 'failed') job.log('This step did not finish. Later steps still run; fix this one and run the wizard again.')
      }
      job.done = true
    })()
    return job.id
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      const host = req.headers.host ?? ''
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'bad host' })
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-wizard-token'] !== token) return send(res, 401, { error: 'Open the wizard from the link it printed; this page has no valid token.' })
        if (req.headers.origin && new URL(req.headers.origin).host !== host) return send(res, 403, { error: 'bad origin' })
        if (url.pathname === '/api/state') return send(res, 200, await state())
        if (url.pathname === '/api/suggestions') return send(res, 200, JSON.parse(fs.readFileSync(suggestionsFile, 'utf8')))
        if (url.pathname === '/api/suggestions/refresh' && req.method === 'POST') return send(res, 200, await refreshSuggestions())
        if (url.pathname === '/api/plan' && req.method === 'POST') { const b = await body(req); return send(res, 200, plan(clean(b), await state())) }
        if (url.pathname === '/api/run' && req.method === 'POST') { const b = await body(req); return send(res, 200, { job: await startJob(b.selections ?? {}, b.ids ?? []) }) }
        const m = url.pathname.match(/^\/api\/job\/([a-f0-9]+)$/)
        if (m) { const j = jobs.get(m[1]); if (!j) return send(res, 404, { error: 'unknown job' }); const from = Number(url.searchParams.get('from') ?? 0); return send(res, 200, { steps: j.steps, lines: j.lines.slice(from), next: j.lines.length, done: j.done }) }
        return send(res, 404, { error: 'not found' })
      }
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const file = path.resolve(here, 'ui', rel)
      if (!file.startsWith(path.join(here, 'ui') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found') }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      fs.createReadStream(file).pipe(res)
    } catch (e) { send(res, 400, { error: e.message }) }
  })
  return { server, token }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, token } = createServer()
  const want = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4777
  let port = want
  server.on('error', e => { if (e.code === 'EADDRINUSE' && port < want + 10) server.listen(++port, '127.0.0.1'); else throw e })
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/?t=${token}`
    console.log(`Agent stack setup wizard${DRY() ? ' (preview mode: nothing is changed)' : ''}\n\n  ${url}\n\nLeave this window open while you use it. Ctrl+C stops it.`)
    if (!process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true }).unref()
  })
}
