#!/usr/bin/env node
// Mod Bar only lists mods named in its built-in catalog. This adds every entry of mods/catalog.json to it, so
// each mod in this folder gets the same on/off switch as the others (toolbar and /mods).
// Idempotent. Run it again after Mod Bar updates (an update replaces the file it patches), then open a new chat.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const entries = JSON.parse(fs.readFileSync(path.join(here, 'catalog.json'), 'utf8'))
const cache = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'claude-mod-mod-bar', 'mod-bar')
if (!fs.existsSync(cache)) { console.error('mod-bar is not installed: claude plugin install mod-bar@claude-mod-mod-bar'); process.exit(1) }

for (const version of fs.readdirSync(cache)) {
  const file = path.join(cache, version, 'hooks', 'mod-bar.mjs')
  if (!fs.existsSync(file)) continue
  let src = fs.readFileSync(file, 'utf8')
  const missing = entries.filter(e => !src.includes(`{ name: "${e.name}",`))
  if (missing.length === 0) { console.log(`${version}: already registered`); continue }
  const lines = missing.map(e => `  { name: ${JSON.stringify(e.name)}, short: ${JSON.stringify(e.short)}, icon: ${JSON.stringify(e.icon)}, title: ${JSON.stringify(e.title)}, about: ${JSON.stringify(e.about)} },`).join('\n')
  const marker = /const CATALOG = \[\r?\n/
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  if (!marker.test(src)) { console.error(`${version}: catalog not found, Mod Bar changed; update this script`); process.exit(1) }
  fs.writeFileSync(file, src.replace(marker, m => m + lines.replaceAll('\n', eol) + eol))
  console.log(`${version}: registered ${missing.map(e => e.name).join(', ')}`)
}
