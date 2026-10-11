// Canonical JSON and short hashes, identical on every platform. Keys sorted, undefined dropped, arrays keep order.
import { createHash } from 'node:crypto';

/** @param {unknown} v @returns {string} */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

/** 16 hex chars of SHA-256 over the canonical form: short enough to keep in agent metadata. */
export const hash = (v) => createHash('sha256').update(canonical(v)).digest('hex').slice(0, 16);

/** Full SHA-256 of raw text (this is what Paperclip reports as an instruction file's contentHash). */
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Instruction text compared and stored the same way on both sides: LF line ends, no trailing blanks, one final newline. */
export const normText = (s) => String(s).replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
