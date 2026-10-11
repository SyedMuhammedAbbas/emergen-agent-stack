// Leak scanner: finds secret-shaped strings where they should not be (git-tracked files, the app's own state, logs, the
// reconciler's journal). It reports WHERE (file, line) and WHAT KIND, never the value. The rules are the redactor's.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { RULES } from './redact.mjs';

const KEYWORD = /key|token|secret|passw|auth|credential/i;
const PLACEHOLDER = /^(\[redacted|\*{3}|<|\$|\{\{|%|x{4,}|\.{3}|your[_-]|changeme|example|placeholder|dummy|test[_-]?(key|token)|fake|null$|none$|true$|false$|undefined$)/i;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|7z|woff2?|ttf|otf|mp4|mov|exe|dll|so|node|lock)$/i;
export const DEFAULT_IGNORE = ['node_modules', `${sep}.git${sep}`, '.test.', `${sep}test${sep}`, `${sep}fixtures${sep}`, 'package-lock.json', `${sep}spikes${sep}native-win${sep}`, 'm0-export'];

const ASSIGNED = new Set(['Secret assignment', 'Token in URL']);
const valueOf = (r, m) => (r.valueGroup ? m[0].slice(m[1].length) : r.kind === 'Token in URL' ? m[0].slice(m[0].indexOf('=') + 1) : m[0]);
/** token = crypto.randomBytes(16)... , password: z.string().min(8) , api_key=os.environ.get(...) , api_key=api_key) : code, not a secret.
 *  A bare identifier (letters, underscores, dots, no digits) is a variable name. Trade-off: a password made only of letters in an
 *  assignment is missed; real keys and anything with digits are still caught. */
const looksLikeCode = (v) => /^[A-Za-z_$][\w.$]*\(/.test(v) || /^[A-Za-z_][A-Za-z_.]*[)\],]?$/.test(v);

/** @returns {{ line:number, kind:string }[]} one entry per line and kind; values are never returned */
export function scanText(text) {
  const out = [], seen = new Set();
  String(text).split('\n').forEach((ln, i) => {
    if (ln.length > 4000) ln = ln.slice(0, 4000);
    for (const r of RULES) {
      if (r.needsContext && !KEYWORD.test(ln)) continue;                   // a bare 40-hex string is usually a git hash or a checksum
      r.re.lastIndex = 0;
      for (let m; (m = r.re.exec(ln)); ) {
        const value = valueOf(r, m);
        if (PLACEHOLDER.test(value) || (ASSIGNED.has(r.kind) && looksLikeCode(value))) continue;   // already redacted, a template, or code that produces/reads a value
        const key = `${i + 1}:${r.kind}`; if (!seen.has(key)) { seen.add(key); out.push({ line: i + 1, kind: r.kind }); }
        if (!r.re.global) break;
      }
    }
  });
  return out;
}

/** Scan files; `rootLabel` only shapes the reported path. Skips ignored paths, binaries and anything over maxBytes. */
export function scanFiles(files, { root = '', ignore = DEFAULT_IGNORE, maxBytes = 1_500_000, read = readFileSync } = {}) {
  const findings = []; let scanned = 0, skipped = 0;
  for (const f of files) {
    const rel = root ? relative(root, f) : f;
    if (ignore.some((p) => f.includes(p) || rel.includes(p)) || BINARY.test(f)) { skipped++; continue; }
    let text; try { if (statSync(f).size > maxBytes) { skipped++; continue; } text = read(f, 'utf8'); } catch { skipped++; continue; }
    if (text.includes('\u0000')) { skipped++; continue; }
    scanned++;
    for (const h of scanText(text)) findings.push({ file: rel.split(sep).join('/'), line: h.line, kind: h.kind });
  }
  return { scanned, skipped, findings };
}

export function walk(dir, { max = 5000 } = {}) {
  const out = [];
  const go = (d) => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (out.length >= max) return; const p = join(d, e.name); if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') go(p); } else if (e.isFile()) out.push(p); } };
  if (existsSync(dir)) go(dir);
  return out;
}
