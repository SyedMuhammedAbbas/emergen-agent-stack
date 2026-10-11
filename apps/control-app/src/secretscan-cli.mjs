// Run the leak scanner from a shell (the app runs it inside WSL for WSL-side files and logs).
//   node secretscan-cli.mjs <dir> [<dir>...]       scan every file under the directories, paths shown relative to $HOME
//   node secretscan-cli.mjs --stdin <label>         scan text from stdin (for example journal output)
// Prints one JSON object { scanned, skipped, findings:[{file,line,kind}] }. Values are never printed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { scanFiles, scanText, walk } from './secretscan.mjs';

const [a, ...rest] = process.argv.slice(2);
if (!a) { console.error('usage: secretscan-cli.mjs <dir>... | --stdin <label>'); process.exit(2); }
let out;
if (a === '--stdin') out = { scanned: 1, skipped: 0, findings: scanText(readFileSync(0, 'utf8')).map((h) => ({ file: rest[0] ?? 'stdin', ...h })) };
else {
  const home = homedir(), files = [a, ...rest].flatMap((d) => walk(d));
  const r = scanFiles(files, { root: home, ignore: ['node_modules', '/.git/', '/secrets/', '/instances/default/.env'] });   // a Paperclip instance's own .env and secrets/ are expected secret locations (see the inventory)
  out = { ...r, findings: r.findings.map((f) => ({ ...f, file: '~/' + f.file })) };
}
console.log(JSON.stringify(out));
