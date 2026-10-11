// M1 step 0: verify the Paperclip API behaviours the reconciler depends on, on a SCRATCH instance only.
// Usage: node m1-api-verify.mjs [apiBase]   (default http://127.0.0.1:3199/api; refuses :3100)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:3199/api';
if (/:3100(\/|$)/.test(base)) throw new Error('refusing to run against the live instance');
const out = {};
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
};
const note = (k, v) => { out[k] = v; console.log(`\n## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`); };

// ---- setup
const co = (await call('POST', '/companies', { name: 'Verify' })).json; const cid = co.id;
const create = await call('POST', `/companies/${cid}/agents`, {
  name: 'A1', role: 'qa', title: 'T1', icon: 'bug', budgetMonthlyCents: 300, adapterType: 'claude_local',
  adapterConfig: { engine: 'cli', command: '/bin/true', timeoutSec: 60, model: 'm1', env: { X: '1' } },
  instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': 'v1' } },
});
const id = create.json.id;
const get = async () => (await call('GET', `/agents/${id}`)).json;
let a = await get();
note('A. agent create/get', { createStatus: create.status, topLevelKeys: Object.keys(a), adapterConfig: a.adapterConfig, runtimeConfig: a.runtimeConfig, metadata: a.metadata, hasUpdatedAt: 'updatedAt' in a });

// ---- B. metadata merge vs replace
await call('PATCH', `/agents/${id}`, { metadata: { a: 1 } });
await call('PATCH', `/agents/${id}`, { metadata: { b: 2 } });
note('B. metadata after {a:1} then {b:2}', (await get()).metadata);

// ---- C. adapterConfig semantics
await call('PATCH', `/agents/${id}`, { adapterConfig: { x: 1 } });
const c1 = (await get()).adapterConfig;
await call('PATCH', `/agents/${id}`, { adapterConfig: { env: { Y: '2' } } });
const c2 = (await get()).adapterConfig;
const rep = await call('PATCH', `/agents/${id}`, { adapterConfig: { engine: 'cli', command: '/bin/true', timeoutSec: 60, model: 'm2' }, replaceAdapterConfig: true });
const c3 = (await get()).adapterConfig;
note('C. adapterConfig', { afterPatch_x1_keepsModelAndEnv: { model: c1.model, env: c1.env, x: c1.x }, afterPatch_envY_envIs: c2.env, afterReplace: { status: rep.status, keys: Object.keys(c3), model: c3.model, env: c3.env, x: c3.x, instructionsKeptByServer: Object.keys(c3).filter((k) => k.startsWith('instructions')) } });

// ---- D. runtimeConfig heartbeat
await call('PATCH', `/agents/${id}`, { runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } } });
const d1 = (await get()).runtimeConfig;
await call('PATCH', `/agents/${id}`, { runtimeConfig: { heartbeat: { intervalSec: 600 } } });
const d2 = (await get()).runtimeConfig;
note('D. runtimeConfig', { afterFirst: d1, afterIntervalOnly_isMergeOrReplace: d2 });

// ---- E. instructions
const f1 = (await call('GET', `/agents/${id}/instructions-bundle/file?path=AGENTS.md`)).json;
const putOk = await call('PUT', `/agents/${id}/instructions-bundle/file`, { path: 'AGENTS.md', content: 'v2', baseRevisionId: f1.revision?.id });
const putStale = await call('PUT', `/agents/${id}/instructions-bundle/file`, { path: 'AGENTS.md', content: 'v3', baseRevisionId: f1.revision?.id });
const putNull = await call('PUT', `/agents/${id}/instructions-bundle/file`, { path: 'AGENTS.md', content: 'v3', baseRevisionId: null });
const hist = (await call('GET', `/agents/${id}/instructions-bundle/history`)).json;
const f2 = (await call('GET', `/agents/${id}/instructions-bundle/file?path=AGENTS.md`)).json;
note('E. instructions', { getFileKeys: Object.keys(f1), revision: f1.revision && Object.keys(f1.revision), contentHash: f1.contentHash ?? f1.revision?.contentHash,
  putWithCorrectBase: putOk.status, putWithStaleBase: { status: putStale.status, body: JSON.stringify(putStale.json).slice(0, 200) },
  putWithNullBaseWhenFileExists: { status: putNull.status, body: JSON.stringify(putNull.json).slice(0, 200) },
  historyShape: Array.isArray(hist) ? hist.length : Object.keys(hist), historySample: JSON.stringify(hist).slice(0, 500), contentNow: f2.content ?? f2.file?.content });
const revs = Array.isArray(hist) ? hist : (hist.revisions ?? hist.items ?? []);
if (revs.length) {
  const first = revs[revs.length - 1];
  const cur = (await call('GET', `/agents/${id}/instructions-bundle/file?path=AGENTS.md`)).json.revision?.id;
  const rs = await call('POST', `/agents/${id}/instructions-bundle/restore`, { path: 'AGENTS.md', revisionId: first.id ?? first.revisionId, baseRevisionId: cur });
  note('E2. restore oldest revision', { status: rs.status, contentAfter: (await call('GET', `/agents/${id}/instructions-bundle/file?path=AGENTS.md`)).json.content, revisionKeys: Object.keys(first) });
}

// ---- F. skills (import a tiny skill with the CLI, then sync)
const sd = mkdtempSync(join(tmpdir(), 'skill-')); const sk = join(sd, 'verify-skill'); mkdirSync(sk);
writeFileSync(join(sk, 'SKILL.md'), '---\nname: verify-skill\ndescription: scratch skill for API verification\n---\nbody\n');
let imp; try { imp = execFileSync('paperclipai', ['skills', 'import', sk, '-C', cid, '--api-base', base.replace(/\/api\/?$/, ''), '--json'], { encoding: 'utf8' }).slice(0, 300); } catch (e) { imp = 'CLI import failed: ' + String(e.message).slice(0, 200); }
const skills = (await call('GET', `/companies/${cid}/skills`)).json;
const list = Array.isArray(skills) ? skills : (skills.items ?? skills.skills ?? []);
const key = list.find((s) => (s.slug ?? s.name) === 'verify-skill')?.key ?? list[0]?.key;
const before = (await call('GET', `/agents/${id}/skills`)).json;
const s1 = await call('POST', `/agents/${id}/skills/sync`, { mode: 'replace', desiredSkills: key ? [key] : [] });
const after = (await call('GET', `/agents/${id}/skills`)).json;
const s2 = await call('POST', `/agents/${id}/skills/sync`, { mode: 'replace', desiredSkills: [] });
const after2 = (await call('GET', `/agents/${id}/skills`)).json;
note('F. skills', { cliImport: imp, companySkillShape: list[0] && Object.keys(list[0]), key, agentSkillsShape: before && Object.keys(before), syncReplaceStatus: s1.status, afterSync: JSON.stringify(after).slice(0, 300), emptyReplaceStatus: s2.status, afterEmpty: JSON.stringify(after2).slice(0, 200) });

// ---- G. routines + triggers
const rt = await call('POST', `/companies/${cid}/routines`, { title: 'R1', description: 'd', assigneeAgentId: id, priority: 'medium' });
const rid = rt.json.id;
const tg = await call('POST', `/routines/${rid}/triggers`, { kind: 'schedule', cronExpression: '0 9 * * 1', timezone: 'UTC', enabled: true });
const tid = tg.json.id ?? tg.json.trigger?.id;
const rget = (await call('GET', `/routines/${rid}`)).json;
const tpatch = await call('PATCH', `/routine-triggers/${tid}`, { cronExpression: '0 10 * * 1' });
const rpatch = await call('PATCH', `/routines/${rid}`, { description: 'd2' });
const rget2 = (await call('GET', `/routines/${rid}`)).json;
note('G. routines', { createStatus: rt.status, triggerStatus: tg.status, routineKeys: Object.keys(rget), triggersInRoutine: rget.triggers && rget.triggers.map((t) => ({ id: t.id, cron: t.cronExpression, tz: t.timezone })),
  triggerPatchStatus: tpatch.status, routinePatchStatus: rpatch.status, descriptionAfter: rget2.description, cronAfter: rget2.triggers?.[0]?.cronExpression });

console.log('\nDONE');
