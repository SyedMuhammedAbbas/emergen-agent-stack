// Path containment for tools. A tool gets named roots; every path it touches is resolved through the real file system
// (symlinks and junctions followed) and must land inside a root. Refuses what cannot be reasoned about: NUL bytes,
// device/UNC/long-path prefixes, alternate data streams, reserved Windows names, names Windows silently rewrites
// (trailing dot or space), and links as move sources.
import { realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';

const WIN = process.platform === 'win32';
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export const MAX_PATH = 240; // Windows' own limit is 260; stay clear of it rather than rely on long-path support

export class SandboxError extends Error { constructor(msg) { super(msg); this.name = 'SandboxError'; } }
const norm = (p) => (WIN ? p.toLowerCase() : p);

/** @param {string[]} roots existing directories */
export function makeSandbox(roots) {
  if (!Array.isArray(roots) || !roots.length) throw new SandboxError('A tool needs at least one root folder.');
  const real = roots.map((r) => {
    let rr; try { rr = realpathSync.native(path.resolve(r)); } catch { throw new SandboxError(`Root folder does not exist: ${r}`); }
    if (path.parse(rr).root === rr) throw new SandboxError('A whole drive cannot be a root; pick a folder.');
    return rr;
  });
  const inside = (p) => real.some((r) => { const a = norm(p), b = norm(r); return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep); });

  function syntax(p) {
    if (typeof p !== 'string' || !p) throw new SandboxError('Empty path.');
    if (p.includes('\0')) throw new SandboxError('Path contains a NUL byte.');
    if (WIN) {
      if (/^\\\\/.test(p) || /^\/\//.test(p)) throw new SandboxError('Network, device and long-path prefixes are not allowed.');
      if (/:/.test(p.replace(/^[A-Za-z]:/, ''))) throw new SandboxError('Alternate data streams are not allowed.');
    }
    if (p.length > MAX_PATH) throw new SandboxError(`Path is longer than ${MAX_PATH} characters.`);
    for (const seg of p.split(/[\\/]/).filter(Boolean)) {
      if (WIN && /[. ]$/.test(seg) && seg !== '.' && seg !== '..') throw new SandboxError(`"${seg}" ends in a dot or space, which Windows rewrites.`);
      if (WIN && RESERVED.test(seg.replace(/^[A-Za-z]:$/, 'x'))) throw new SandboxError(`"${seg}" is a reserved Windows name.`);
    }
  }

  /** Real location of p (which may not exist yet): the nearest existing ancestor, resolved, plus the rest. */
  function locate(p) {
    syntax(p);
    const abs = path.resolve(p);
    let head = abs, tail = [];
    for (;;) {
      try { return path.join(realpathSync.native(head), ...tail); }
      catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw new SandboxError(`Cannot resolve ${p}: ${e.code ?? e.message}`); const up = path.dirname(head); if (up === head) throw new SandboxError(`Cannot resolve ${p}.`); tail.unshift(path.basename(head)); head = up; }
    }
  }

  return {
    roots: real,
    /** Throws unless p resolves inside a root; returns the resolved path. */
    check(p) { const r = locate(p); if (!inside(r)) throw new SandboxError(`${p} is outside this tool's folders.`); return r; },
    /** For move sources: must be a regular file that is not a link, inside a root. */
    checkSourceFile(p) {
      const r = this.check(p); let st;
      try { st = lstatSync(path.resolve(p)); } catch { throw new SandboxError(`${p} does not exist.`); }
      if (st.isSymbolicLink()) throw new SandboxError(`${p} is a link; links are never moved.`);
      if (!st.isFile()) throw new SandboxError(`${p} is not a regular file.`);
      return r;
    },
  };
}
