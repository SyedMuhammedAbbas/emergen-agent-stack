// What the wizard can do. Every action is a fixed, named step; the browser never sends a command, only choices.
// WIZARD_DRY=1 makes every step describe itself instead of running (used by the tests and for a safe preview).
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const DRY = () => process.env.WIZARD_DRY === '1'
const wslPath = p => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replaceAll('\\', '/')

// config.env keys the wizard may write; everything else is refused.
const CONFIG_KEYS = new Set(['COMPANY_NAME', 'DEPARTMENTS', 'PROJECT_CATEGORIES', 'PROJECTS_ROOT', 'MANAGER_HEARTBEAT_SEC', 'WATCHDOG_SWEEP_SCHEDULE', 'REPORT_SCHEDULE', 'EXTRA_SKILLS'])
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const NAME = /^[^\r\n=]{1,80}$/
const CATEGORY = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,29}$/
const DEPTS = ['engineering', 'operations', 'branding', 'freelance']

export function readConfig(repo) {
  const file = path.join(repo, 'config.env')
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) out[m[1]] = m[2] }
  return out
}

export function writeConfig(repo, values) {
  for (const k of Object.keys(values)) if (!CONFIG_KEYS.has(k)) throw new Error(`config key not allowed: ${k}`)
  const file = path.join(repo, 'config.env')
  const template = path.join(repo, 'examples', 'team.env')
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync(template, 'utf8')
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  for (const [k, v] of Object.entries(values)) {
    if (/[\r\n]/.test(v)) throw new Error(`bad value for ${k}`)
    const re = new RegExp(`^${k}=.*$`, 'm')
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : text.trimEnd() + eol + `${k}=${v}` + eol
  }
  fs.writeFileSync(file, text)
}

/** The brand profile's folder name: typed by the person, or made from the brand name. Always 3 to 40 safe characters. */
export function slugOf(typed, name) {
  const t = String(typed ?? '').trim()
  if (t) return t
  let s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  if (s.length < 3) s = (s + '-brand').replace(/^-/, '')
  return s
}

/** Validates the browser's choices and returns clean ones, or throws with a message the person can act on. */
export function clean(sel) {
  const areas = (sel.areas ?? []).filter(a => ['paperclip', 'personal', 'branding', 'freelance', 'routing', 'mods'].includes(a))
  const c = { areas, company: String(sel.company?.name ?? '').trim() }
  if (c.company && !NAME.test(c.company)) throw new Error('Company name: use up to 80 characters, no line breaks or "=".')
  const depts = new Set(areas.includes('paperclip') ? (sel.paperclip?.departments ?? []).filter(d => DEPTS.includes(d)) : [])
  if (areas.includes('branding')) depts.add('branding')
  if (areas.includes('freelance')) depts.add('freelance')
  if (areas.includes('paperclip') || depts.size) depts.add('engineering') // the Manager heads the org
  c.departments = DEPTS.filter(d => depts.has(d))
  c.profile = ['quiet', 'balanced', 'watchful'].includes(sel.paperclip?.profile) ? sel.paperclip.profile : 'balanced'
  const personal = areas.includes('personal') ? sel.personal ?? {} : {}
  c.organizer = !!personal.organizer
  c.categories = (personal.categories ?? []).map(s => String(s).trim()).filter(Boolean)
  for (const cat of c.categories) if (!CATEGORY.test(cat)) throw new Error(`Folder name "${cat}": use letters, numbers, spaces, dots, dashes or underscores (30 characters max).`)
  c.projectsRoot = String(personal.projectsRoot ?? '').trim()
  if (c.projectsRoot && !/^[A-Za-z]:\\[^<>:"|?*\r\n]*$/.test(c.projectsRoot)) throw new Error('Projects folder: enter a full Windows path such as C:\\Abbas.')
  const b = sel.branding ?? {}
  c.brand = areas.includes('branding') && b.name ? {
    name: String(b.name).trim(), slug: slugOf(b.slug, b.name),
    website: String(b.website ?? '').trim(), linkedin: String(b.linkedin ?? '').trim(), audience: String(b.audience ?? '').trim(), tone: String(b.tone ?? '').trim(), offer: String(b.offer ?? '').trim(),
    channels: (b.channels ?? []).map(String),
  } : null
  if (c.brand) {
    if (!NAME.test(c.brand.name)) throw new Error('Brand name: use up to 80 characters, no line breaks or "=".')
    if (!SLUG.test(c.brand.slug)) throw new Error('Brand folder name: use lowercase letters, numbers and dashes (3 to 40 characters).')
    for (const f of ['website', 'linkedin', 'audience', 'tone', 'offer']) if (c.brand[f].length > 300 || /[\r\n]/.test(c.brand[f])) throw new Error(`Brand ${f}: keep it to one line under 300 characters.`)
  }
  c.upworkMcp = areas.includes('freelance') && sel.freelance?.upworkMcp !== false
  c.omniroute = areas.includes('routing') && sel.routing?.omniroute !== false
  c.crew = areas.includes('mods') && sel.mods?.crew !== false
  return c
}

/** The steps this choice would run, in plain words, plus what only the person can do. */
export function plan(c, state) {
  const profiles = state.profiles.profiles
  const actions = [], manual = []
  const cfg = {}
  if (c.company) cfg.COMPANY_NAME = c.company
  if (c.departments.length) { cfg.DEPARTMENTS = c.departments.join(','); Object.assign(cfg, profiles[c.profile].env) }
  if (c.categories.length) cfg.PROJECT_CATEGORIES = c.categories.join(',')
  if (c.projectsRoot) cfg.PROJECTS_ROOT = wslPath(c.projectsRoot)
  if (c.brand) {
    const extra = new Set((state.config.EXTRA_SKILLS ?? '').split(',').filter(Boolean)); extra.add(`${c.brand.slug}-context`)
    cfg.EXTRA_SKILLS = [...extra].join(',')
  }
  if (Object.keys(cfg).length) actions.push({ id: 'config', title: 'Save your choices to config.env', detail: Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join('\n'), params: cfg, note: 'The old file is copied to config.env.bak-<time> first. config.env is never committed.' })
  if (c.categories.length) {
    const root = c.projectsRoot || 'C:\\Abbas'
    actions.push({ id: 'folders', title: `Create ${c.categories.length} project folder${c.categories.length > 1 ? 's' : ''}`, detail: c.categories.map(x => `${root}\\${x}`).join('\n'), params: { root, categories: c.categories }, note: 'Existing folders are left as they are.' })
  }
  if (c.brand) actions.push({ id: 'brand-skill', title: `Write the ${c.brand.name} brand profile`, detail: `project-skills/${c.brand.slug}-context/SKILL.md`, params: { brand: c.brand }, note: 'Every agent reads it, so the content team stops asking what your company does.' })
  if (c.organizer) actions.push({ id: 'organizer', title: 'Start the Downloads organizer at every logon', detail: 'tools/downloads-organizer/install-startup.ps1', note: 'Registers a hidden logon task. Windows may refuse this from a locked-down session; the log will say so.' })
  if (c.departments.length || c.brand || c.upworkMcp) actions.push({ id: 'apply-org', title: 'Create the agents in Paperclip', detail: 'install.ps1 -OnlyOrg', note: 'Takes about 25 minutes the first time. WSL and Paperclip must be running.' })
  if (c.omniroute) actions.push({ id: 'omniroute', title: 'Install the OmniRoute gateway', detail: 'wsl/45-omniroute.sh', note: 'Installs the npm package omniroute (MIT) in WSL and runs it as a service on port 20128.' })
  if (c.upworkMcp) actions.push({ id: 'upwork-mcp', title: 'Register Upwork\'s official MCP server', detail: 'claude mcp add --transport http upwork https://mcp.upwork.com/mcp', note: 'Registers it only. You sign in to Upwork yourself afterwards.' })
  if (c.crew) actions.push({ id: 'mods', title: 'Install the Paperclip Crew mod and add it to Mod Bar', detail: 'claude plugin marketplace add mods/ ; plugin install paperclip-crew ; register-in-mod-bar.mjs', note: 'Open a new chat afterwards to see the crabs.' })
  if (c.departments.length || c.omniroute) manual.push({ title: 'Log in once inside Ubuntu', detail: 'gh auth login, then claude (log in, then /exit), then jev-router setup --models claude --service systemd --no-claude-settings. Type keys yourself; the wizard never sees them.' })
  if (c.upworkMcp) manual.push({ title: 'Sign in to Upwork', detail: 'In Ubuntu run claude, type /mcp, choose upwork and finish the browser sign-in.' })
  if (c.omniroute) manual.push({ title: 'Finish OmniRoute in its dashboard', detail: 'Open http://localhost:20128: set a password, connect your providers, create the combos fast, balanced and frontier, then make an API key. Details in docs/omniroute.md.' })
  if (c.departments.length) manual.push({ title: 'Keep WSL awake', detail: 'Windows blocks apps from registering the keepalive task. Run .\\install.ps1 once in a normal PowerShell window.' })
  return { actions, manual }
}

// ---- running steps ----
function run(job, cmd, args, opts = {}) {
  return new Promise(resolve => {
    job.log(`$ ${cmd} ${args.join(' ')}`)
    if (DRY()) { job.log('(preview: not run)'); return resolve(0) }
    const p = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true })
    const feed = d => String(d).replace(/\0/g, '').split(/\r?\n/).filter(Boolean).forEach(l => job.log(l))
    p.stdout.on('data', feed); p.stderr.on('data', feed)
    p.on('error', e => { job.log(`could not start ${cmd}: ${e.message}`); resolve(1) })
    p.on('close', code => resolve(code ?? 1))
  })
}

export const EXECUTORS = {
  async config(job, a, repo) { if (DRY()) { job.log(`(preview) would write ${Object.keys(a.params).join(', ')}`); return 0 } writeConfig(repo, a.params); job.log('config.env updated'); return 0 },
  async folders(job, a) {
    for (const c of a.params.categories) {
      const dir = path.join(a.params.root, c)
      if (DRY()) { job.log(`(preview) would create ${dir}`); continue }
      fs.mkdirSync(dir, { recursive: true }); job.log(`ready: ${dir}`)
    }
    return 0
  },
  async 'brand-skill'(job, a, repo) {
    const b = a.params.brand
    const dir = path.join(repo, 'project-skills', `${b.slug}-context`)
    const md = `---
name: ${b.slug}-context
description: What ${b.name} is, who it is for and how it sounds. Use for any content, design or outreach work for ${b.name}.
---

# ${b.name}

${b.offer ? `**What it does:** ${b.offer}\n` : ''}${b.audience ? `**Audience:** ${b.audience}\n` : ''}${b.tone ? `**Tone of voice:** ${b.tone}\n` : ''}${b.website ? `**Website:** ${b.website}\n` : ''}${b.linkedin ? `**LinkedIn:** ${b.linkedin}\n` : ''}${b.channels.length ? `**Channels:** ${b.channels.join(', ')}\n` : ''}
## Rules
- Use only the facts above. If something is missing (prices, proof, client names), ask with a \`**Question for board:**\` instead of inventing it.
- Nothing is published by an agent. The owner approves and posts.
`
    if (DRY()) { job.log(`(preview) would write ${dir}\\SKILL.md`); return 0 }
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'SKILL.md')
    if (fs.existsSync(file)) { fs.copyFileSync(file, `${file}.bak`); job.log('existing profile saved as SKILL.md.bak') }
    fs.writeFileSync(file, md); job.log(`wrote ${file}`); return 0
  },
  organizer: (job, a, repo) => run(job, 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'tools', 'downloads-organizer', 'install-startup.ps1')]),
  'apply-org': (job, a, repo) => run(job, 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'install.ps1'), '-OnlyOrg'], { cwd: repo }),
  omniroute: (job, a, repo) => run(job, 'wsl.exe', ['-d', readConfig(repo).WSL_DISTRO || 'Ubuntu-24.04', '--', 'bash', `${wslPath(repo)}/wsl/45-omniroute.sh`]),
  'upwork-mcp': (job, a, repo) => run(job, 'wsl.exe', ['-d', readConfig(repo).WSL_DISTRO || 'Ubuntu-24.04', '--', 'bash', '-c', 'export PATH="$HOME/.local/bin:$PATH"; claude mcp add --transport http --scope user upwork https://mcp.upwork.com/mcp']),
  async mods(job, a, repo) {
    const mods = path.join(repo, 'mods')
    for (const args of [['plugin', 'marketplace', 'add', mods], ['plugin', 'install', 'paperclip-crew@emergen-mods']]) { const code = await run(job, 'claude', args); if (code) return code }
    return run(job, process.execPath, [path.join(mods, 'register-in-mod-bar.mjs')])
  },
}
