// Watches the Downloads folder and moves each finished file into a topic subfolder. Any app that saves there is covered.
// Usage: node watcher.mjs        (env DOWNLOADS_DIR / QUALIFI_DIR override the defaults, used by the test)
import fs from 'node:fs/promises'
import { watch, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { folderFor, safe } from './rules.js'

const DL = process.env.DOWNLOADS_DIR ?? path.join(os.homedir(), 'Downloads')
// Topics that live outside Downloads. Everything else goes to a subfolder of Downloads.
const DEST = { Qualifi: process.env.QUALIFI_DIR ?? 'C:\\Abbas\\Qualifi\\inbox' }
const TEMP = /\.(crdownload|part|partial|tmp|download|opdownload|aria2|!qb)$/i
const IGNORE = /^(desktop\.ini|thumbs\.db|~\$.*|\..*)$/i
const LOG = path.join(import.meta.dirname, 'logs')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = msg => { try { mkdirSync(LOG, { recursive: true }); appendFileSync(path.join(LOG, 'watcher.log'), `${new Date().toISOString()} ${msg}\n`) } catch {} }

function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext)
  let n = name, i = 1
  while (existsSync(path.join(dir, n))) n = `${base} (${i++})${ext}`
  return path.join(dir, n)
}

// A download is done when its size stays the same across two checks (browsers write to a temp name first).
async function settled(file) {
  let prev = -1, same = 0
  for (let i = 0; i < 400 && same < 2; i++) {
    let st
    try { st = await fs.stat(file) } catch { return false }
    same = st.size === prev ? same + 1 : 0
    prev = st.size
    if (same < 2) await sleep(1500)
  }
  return same >= 2
}

const inFlight = new Set()
export async function handle(name) {
  if (inFlight.has(name) || TEMP.test(name) || IGNORE.test(name)) return
  inFlight.add(name)
  try {
    const file = path.join(DL, name)
    let st
    try { st = await fs.stat(file) } catch { return }
    if (!st.isFile() || !(await settled(file))) return
    const dir = DEST[folderFor(name)] ?? path.join(DL, folderFor(name))
    await fs.mkdir(dir, { recursive: true })
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const to = uniquePath(dir, safe(name))
        await fs.rename(file, to)
        log(`${name} -> ${to}`)
        return
      } catch (e) {
        if (!/EBUSY|EPERM|EACCES/.test(e.code ?? '')) { log(`FAILED ${name}: ${e.message}`); return }
        await sleep(3000) // still held by the app that wrote it
      }
    }
    log(`gave up on ${name}: file stayed locked`)
  } finally { inFlight.delete(name) }
}

// leftovers first, then everything that arrives
for (const e of await fs.readdir(DL)) handle(e)
const w = watch(DL, { persistent: true }, (_event, filename) => {
  if (filename && !/[\\/]/.test(filename)) setTimeout(() => handle(filename), 500)
})
w.on('error', e => { log(`watcher error: ${e.message}`); process.exit(1) }) // the startup task restarts it
log(`watching ${DL}`)
