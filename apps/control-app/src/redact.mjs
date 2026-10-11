// Mask anything that looks like a secret before text leaves the machine's logs and reaches the browser or the audit log.
// Deliberately blunt: a false positive hides a harmless string, a miss would show a key.
// The same rules drive the leak scanner (secretscan.mjs), so what is masked and what is flagged cannot drift apart.
export const RULES = [
  { kind: 'API key', re: /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, to: '[redacted key]' },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, to: '[redacted token]' },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, to: '[redacted token]' },
  { kind: 'AWS key id', re: /\bAKIA[0-9A-Z]{16}\b/g, to: '[redacted key]' },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, to: '[redacted jwt]' },
  { kind: 'Bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, to: 'Bearer [redacted]' },
  { kind: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, to: '[redacted private key]' },
  { kind: 'Secret assignment', re: /((?:api[_-]?key|token|secret|password|passwd|authorization|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',;}]{6,}/gi, to: '$1[redacted]', valueGroup: true },
  { kind: 'Token in URL', re: /[?&](t|token|key|access_token)=[^&\s"']{8,}/gi, to: (m) => m.slice(0, m.indexOf('=') + 1) + '[redacted]' },
  { kind: 'Long hex string', re: /\b[A-Fa-f0-9]{40,}\b/g, to: '[redacted hex]', needsContext: true },
];

export function redact(text) {
  let s = String(text ?? '');
  for (const r of RULES) s = s.replace(r.re, r.to);
  return s;
}
