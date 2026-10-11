import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clean, plan, writeConfig, readConfig, slugOf } from './actions.mjs'
import { createServer } from './server.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const real = path.resolve(here, '..', '..')
const profiles = JSON.parse(fs.readFileSync(path.join(here, 'profiles.json'), 'utf8'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-'))
fs.mkdirSync(path.join(tmp, 'examples')); fs.copyFileSync(path.join(real, 'examples', 'team.env'), path.join(tmp, 'examples', 'team.env'))
fs.cpSync(path.join(real, 'org'), path.join(tmp, 'org'), { recursive: true })

// choices are validated and tied together
const c = clean({ areas: ['branding', 'freelance', 'personal', 'bogus'], company: { name: 'Acme' }, personal: { organizer: true, categories: ['Acme', 'Personal'], projectsRoot: 'C:\\Work' }, branding: { name: 'Acme Studio', website: 'acme.example' } })
assert.deepEqual(c.areas, ['branding', 'freelance', 'personal'])
assert.deepEqual(c.departments, ['engineering', 'branding', 'freelance'], 'branding and freelance pull in the Manager')
assert.equal(c.brand.slug, 'acme-studio')
assert.throws(() => clean({ areas: [], company: { name: 'a=b' } }), /Company name/)
assert.throws(() => clean({ areas: ['personal'], personal: { categories: ['../x'] } }), /Folder name/)
assert.throws(() => clean({ areas: ['personal'], personal: { projectsRoot: '/etc' } }), /full Windows path/)
assert.throws(() => clean({ areas: ['branding'], branding: { name: 'X Y', slug: 'Bad Slug' } }), /Brand folder name/)

// the brand folder name is made safely from any brand name
assert.equal(slugOf('', 'AI'), 'ai-brand')
assert.equal(slugOf('', 'Orrisian'), 'orrisian')
assert.equal(slugOf('', 'قلم'), 'brand')
assert.equal(slugOf('', 'B'.repeat(80)).length, 40)
assert.equal(clean({ areas: ['branding'], branding: { name: 'B'.repeat(80) } }).brand.slug.length, 40)

// choices for areas that were not selected are ignored
assert.deepEqual(clean({ areas: ['mods'], personal: { organizer: true, categories: ['X'] }, paperclip: { departments: ['operations'] } }).categories, [])
assert.deepEqual(clean({ areas: ['mods'], paperclip: { departments: ['operations'] } }).departments, [])

// the plan says what will happen, and what only the person can do
const p = plan(c, { profiles, config: {} })
const ids = p.actions.map(a => a.id)
for (const id of ['config', 'folders', 'brand-skill', 'organizer', 'apply-org', 'upwork-mcp']) assert.ok(ids.includes(id), id)
assert.ok(!ids.includes('omniroute') && !ids.includes('mods'), 'unchosen areas add nothing')
assert.match(p.actions.find(a => a.id === 'config').detail, /DEPARTMENTS=engineering,branding,freelance/)
assert.match(p.actions.find(a => a.id === 'config').detail, /PROJECTS_ROOT=\/mnt\/c\/Work/)
assert.ok(p.manual.some(m => /Sign in to Upwork/.test(m.title)))

// config.env: only allowed keys, backup first, secrets never asked for
assert.throws(() => writeConfig(tmp, { ANTHROPIC_API_KEY: 'x' }), /not allowed/)
writeConfig(tmp, { COMPANY_NAME: 'Acme', DEPARTMENTS: 'engineering,branding' })
writeConfig(tmp, { DEPARTMENTS: 'engineering' })
assert.equal(readConfig(tmp).DEPARTMENTS, 'engineering')
assert.equal(readConfig(tmp).COMPANY_NAME, 'Acme')
assert.ok(fs.readdirSync(tmp).some(f => f.startsWith('config.env.bak-')), 'backup written')

// server: token required, bad host refused, preview-mode job runs the plan without changing anything
process.env.WIZARD_DRY = '1'
const { server, token } = createServer({ repo: tmp, token: 'tok' })
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const api = (p, o = {}) => fetch(base + p, { ...o, headers: { 'x-wizard-token': 'tok', 'content-type': 'application/json', ...(o.headers ?? {}) } })
assert.equal((await fetch(base + '/api/state')).status, 401, 'no token, no API')
assert.equal((await fetch(base + '/api/state', { headers: { 'x-wizard-token': 'wrong' } })).status, 401)
const evil = await new Promise(r => { const q = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/state', headers: { host: 'evil.example', 'x-wizard-token': 'tok' } }, res => r(res.statusCode)); q.end() })
assert.equal(evil, 403, 'a forged Host (DNS rebinding) is refused')
assert.equal((await fetch(base + '/../../etc/passwd')).status, 404)
const st = await (await api('/api/state')).json()
assert.ok(st.dry && st.departments.length >= 4 && st.profiles.profiles.balanced)
const sel = { areas: ['paperclip', 'personal'], paperclip: { departments: ['engineering', 'operations'], profile: 'quiet' }, personal: { categories: ['Work'], projectsRoot: path.join(tmp, 'projects') } }
const before = fs.readFileSync(path.join(tmp, 'config.env'), 'utf8')
const { job } = await (await api('/api/run', { method: 'POST', body: JSON.stringify({ selections: sel, ids: ['config', 'folders', 'apply-org', 'not-a-step'] }) })).json()
let j
for (let i = 0; i < 50; i++) { j = await (await api(`/api/job/${job}`)).json(); if (j.done) break; await new Promise(r => setTimeout(r, 100)) }
assert.ok(j.done)
assert.deepEqual(j.steps.map(s => s.id), ['config', 'folders', 'apply-org'], 'unknown ids are ignored')
assert.ok(j.steps.every(s => s.status === 'done'))
assert.equal(fs.readFileSync(path.join(tmp, 'config.env'), 'utf8'), before, 'preview mode changes nothing')
assert.ok(!fs.existsSync(path.join(tmp, 'projects')), 'preview mode creates no folders')
server.close(); fs.rmSync(tmp, { recursive: true, force: true })
console.log('ok: validation, plan, config writer, token and host checks, preview job')
