// M1 step 0, part 2: skills with a real imported skill, instruction history, env redaction. SCRATCH only.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const origin = process.argv[2] ?? 'http://127.0.0.1:3199'; const base = origin + '/api';
if (/:3100$/.test(origin)) throw new Error('refusing to run against the live instance');
const scratch = process.env.SCRATCH_DIR ?? join(homedir(), '.agent-stack', 'scratch');
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j }; };
const note = (k, v) => console.log(`\n## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);

const cid = (await call('POST', '/companies', { name: 'V2' })).json.id;
// two skills in the company managed dir (the only place the import accepts)
const managed = join(scratch, 'instances', 'default', 'skills', cid);
for (const n of ['skill-a', 'skill-b']) { const d = join(managed, n); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${n}\ndescription: scratch ${n}\n---\nbody ${n}\n`);
  try { execFileSync('paperclipai', ['skills', 'import', d, '-C', cid, '--api-base', origin, '--json'], { encoding: 'utf8' }); } catch (e) { note('import failed ' + n, String(e.message).slice(0, 300)); } }
const list = (await call('GET', `/companies/${cid}/skills`)).json; const L = Array.isArray(list) ? list : (list.items ?? list.skills ?? []);
const keyOf = (s) => L.find((x) => x.slug === s)?.key;
const A = keyOf('skill-a'), B = keyOf('skill-b');
note('skills in company', L.map((s) => ({ key: s.key, slug: s.slug, sourceType: s.sourceType })));

const ag = (await call('POST', `/companies/${cid}/agents`, { name: 'S1', role: 'qa', title: 'T', icon: 'bug', adapterType: 'claude_local',
  adapterConfig: { engine: 'cli', command: '/bin/true', env: { SECRET_LIKE: 'abc', PLAIN: 'visible?' } }, instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': 'one' } } })).json;
const id = ag.id; const sk = async () => { const j = (await call('GET', `/agents/${id}/skills`)).json; return j.desiredSkills; };
note('skills: initial desired', await sk());
const sync = async (mode, keys) => { const r = await call('POST', `/agents/${id}/skills/sync`, { mode, desiredSkills: keys }); return { mode, keys: keys.map((k) => k?.split('/').pop()), status: r.status, now: (await sk()).map((k) => k.split('/').pop()) }; };
note('skills: add A', await sync('add', [A]));
note('skills: add B', await sync('add', [B]));
note('skills: replace [A]', await sync('replace', [A]));
note('skills: remove A', await sync('remove', [A]));
note('skills: replace []', await sync('replace', []));
const cr = await call('POST', `/companies/${cid}/agents`, { name: 'S2', role: 'qa', title: 'T', icon: 'bug', adapterType: 'claude_local', adapterConfig: { engine: 'cli', command: '/bin/true' }, desiredSkills: [A, B] });
note('skills: set at agent create via desiredSkills', { status: cr.status, now: (await call('GET', `/agents/${cr.json.id}/skills`)).json.desiredSkills?.map((k) => k.split('/').pop()) });

// instruction history: after writes, with and without path
const f = (await call('GET', `/agents/${id}/instructions-bundle/file?path=AGENTS.md`)).json;
await call('PUT', `/agents/${id}/instructions-bundle/file`, { path: 'AGENTS.md', content: 'two', baseRevisionId: f.revision.id });
const h1 = (await call('GET', `/agents/${id}/instructions-bundle/history`)).json;
const h2 = (await call('GET', `/agents/${id}/instructions-bundle/history?path=AGENTS.md`)).json;
const bundle = (await call('GET', `/agents/${id}/instructions-bundle`)).json;
note('instruction history', { noPath: JSON.stringify(h1).slice(0, 200), withPath: JSON.stringify(h2).slice(0, 300), bundleKeys: Object.keys(bundle) });
const diff = await call('GET', `/agents/${id}/instructions-bundle/diff`);
note('instruction diff endpoint', { status: diff.status, sample: JSON.stringify(diff.json).slice(0, 200) });

// env redaction: any way to read values back?
const one = (await call('GET', `/agents/${id}`)).json.adapterConfig.env;
const cfgEndpoints = [`/agents/${id}/configuration`, `/agents/${id}/config`, `/agents/${id}/config-revisions`, `/agents/${id}/adapter-config`];
const probes = {}; for (const p of cfgEndpoints) { const r = await call('GET', p); probes[p] = { status: r.status, sample: JSON.stringify(r.json).slice(0, 160) }; }
note('env read-back', { fromGetAgent: one, otherEndpoints: probes });
const spec = (await (await fetch(base + '/openapi.json')).json()).paths;
note('agent-related paths with config/reveal/secret', Object.keys(spec).filter((p) => /agents\/\{id\}/.test(p) && /config|reveal|secret|env|revision/i.test(p)));
console.log('\nDONE');
