// Mask anything that looks like a secret before text leaves the machine's logs and reaches the browser or the audit log.
// Deliberately blunt: a false positive hides a harmless string, a miss would show a key.
const RULES = [
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '[redacted key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[redacted token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[redacted token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[redacted jwt]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/((?:api[_-]?key|token|secret|password|passwd|authorization|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',;}]{6,}/gi, '$1[redacted]'],
  [/[?&](t|token|key|access_token)=[^&\s"']{8,}/gi, (m) => m.slice(0, m.indexOf('=') + 1) + '[redacted]'],
  [/\b[A-Fa-f0-9]{40,}\b/g, '[redacted hex]'],
];
export function redact(text) {
  let s = String(text ?? '');
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s;
}
