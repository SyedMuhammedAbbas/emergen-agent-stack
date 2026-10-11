import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, scanFiles, walk } from '../src/secretscan.mjs';
import { redact } from '../src/redact.mjs';

// Fake secrets, built from parts so no real-looking key sits in this file as one literal.
const SK = 'sk-' + 'ant-api03-' + 'AbCdEfGhIjKlMnOpQrStUv', GH = 'gh' + 'p_' + '1234567890abcdefghijABCDEFGHIJ', JWT = 'eyJhbGciOiJIUzI1NiJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0.' + 'dBjftJeZ4CVPmB92K27uhbUJU1p1r';
const PEM = '-----BEGIN ' + 'RSA PRIVATE KEY-----', HEX = 'a'.repeat(8) + 'f'.repeat(40);

test('finds each kind with its line number, and never returns the secret itself', () => {
  const text = ['# config', `ANTHROPIC_API_KEY=${SK}`, 'ok line', `token: ${GH}`, `auth header: Bearer abcdef0123456789xyz`, JWT, PEM, 'password = "hunter22xyz"', `url?access_token=abcdef123456789`].join('\n');
  const r = scanText(text);
  assert.deepEqual([...new Set(r.map((x) => x.line))].sort((a, b) => a - b), [2, 4, 5, 6, 7, 8, 9]);   // a line can match two rules (key + assignment)
  assert.ok(r.find((x) => x.line === 2).kind.length > 0);
  const dump = JSON.stringify(r);
  for (const s of [SK, GH, JWT, 'hunter22xyz', 'abcdef123456789']) assert.ok(!dump.includes(s.slice(4, 24)), 'the result must not contain the secret');
});

test('placeholders, already-redacted values and code are not findings', () => {
  const clean = ['password=[redacted]', 'token: ${TOKEN}', 'api_key=your_key_here', 'secret: <fill me in>', 'API_KEY=changeme', 'key=%USERPROFILE%', 'token=null', 'password: getPassword(user)', 'authorization: ***REDACTED***', 'token=xxxxxxxxxxxx', 'ANTHROPIC_BASE_URL=http://127.0.0.1:4000'].join('\n');
  assert.deepEqual(scanText(clean), []);
  assert.deepEqual(scanText(redact(`k=${SK} and token=abcdef123456`)), []);                // the redactor's own output is clean
});

test('code that generates or reads a value is not a secret (found in the real repo), but real assignments still are', () => {
  const code = ["token = crypto.randomBytes(16).toString('hex')", 'const url = `http://127.0.0.1:${port}/?t=${token}`', 'api_key = os.environ.get("GEMINI_API_KEY") or None', 'client = genai.Client(api_key=api_key)', 'password: z.string().min(8)', 'GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")'].join('\n');
  assert.deepEqual(scanText(code), []);
  assert.equal(scanText('api_key = "qwerty123456"').length, 1);                      // has digits: a real-looking value
  assert.equal(scanText('http://x/?t=abcdef0123456789').length, 1);
  assert.equal(scanText('password: ' + 'Aa1!' + 'Zz9?kjhg').length, 1);
});

test('a bare 40-hex string (a git hash, a checksum) is not flagged; next to a secret word it is', () => {
  assert.deepEqual(scanText(`commit ${HEX}\nsha256 ${HEX}`), []);
  assert.equal(scanText(`signing secret ${HEX}`)[0].kind, 'Long hex string');
});

test('files: ignored paths, binaries and big files are skipped; findings carry relative paths', () => {
  const d = mkdtempSync(join(tmpdir(), 'ss-'));
  for (const p of ['src', 'test', 'fixtures', 'node_modules/x']) mkdirSync(join(d, p), { recursive: true });
  writeFileSync(join(d, 'src', 'leak.env'), `K=${SK}\n`); writeFileSync(join(d, 'src', 'fine.txt'), 'nothing here\n');
  writeFileSync(join(d, 'test', 'a.txt'), `K=${SK}\n`); writeFileSync(join(d, 'fixtures', 'b.json'), `{"k":"${SK}"}`); writeFileSync(join(d, 'src', 'a.test.mjs'), `K=${SK}\n`);
  writeFileSync(join(d, 'node_modules/x', 'c.js'), `K=${SK}\n`); writeFileSync(join(d, 'src', 'img.png'), SK); writeFileSync(join(d, 'src', 'big.txt'), 'x'.repeat(2_000_000) + SK);
  const r = scanFiles(walk(d), { root: d });
  assert.deepEqual(r.findings.map((f) => `${f.file}:${f.line}`), ['src/leak.env:1']); assert.equal(r.scanned, 2); assert.ok(r.skipped >= 5);
  assert.ok(!JSON.stringify(r).includes('AbCdEfGh'));
});

test('the CLI scans directories and stdin and prints values nowhere', () => {
  const d = mkdtempSync(join(tmpdir(), 'ssc-')); writeFileSync(join(d, 'x.env'), `K=${SK}\nclean=1\n`);
  const cli = fileURLToPath(new URL('../src/secretscan-cli.mjs', import.meta.url));
  const a = execFileSync(process.execPath, [cli, d], { encoding: 'utf8', env: { ...process.env, HOME: tmpdir(), USERPROFILE: tmpdir() } });
  assert.equal(JSON.parse(a).findings.length, 1); assert.ok(!a.includes('AbCdEfGh'));
  const b = execFileSync(process.execPath, [cli, '--stdin', 'journal'], { input: `line\nPASSWORD=${'q1'.repeat(6)}\n`, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(b).findings, [{ file: 'journal', line: 2, kind: 'Secret assignment' }]); assert.ok(!b.includes('q1q1'));
});
