// Planner for the runner: loose files directly inside each root move into a topic subfolder of that root.
// Same rules as the background watcher (rules.js), but nothing happens until the plan is confirmed.
import { readdirSync, statSync, existsSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { folderFor, safe } from './rules.js'

const TEMP = /\.(crdownload|part|partial|tmp|download|opdownload|aria2|!qb)$/i
const IGNORE = /^(desktop\.ini|thumbs\.db|~\$.*|\..*)$/i

export function plan({ roots }) {
  const ops = [], made = new Set(), taken = new Set()
  for (const root of roots) {
    for (const name of readdirSync(root)) {
      if (TEMP.test(name) || IGNORE.test(name)) continue
      const from = path.join(root, name)
      let st; try { st = lstatSync(from) } catch { continue }
      if (!st.isFile() || st.isSymbolicLink()) continue
      const dir = path.join(root, folderFor(name))
      if (!existsSync(dir) && !made.has(dir)) { made.add(dir); ops.push({ op: 'mkdir', path: dir }) }
      const ext = path.extname(name), base = path.basename(safe(name), ext)
      let n = safe(name), i = 1
      while (existsSync(path.join(dir, n)) || taken.has(path.join(dir, n).toLowerCase())) n = `${base} (${i++})${ext}`
      taken.add(path.join(dir, n).toLowerCase())
      ops.push({ op: 'move', from, to: path.join(dir, n) })
    }
  }
  return ops
}
