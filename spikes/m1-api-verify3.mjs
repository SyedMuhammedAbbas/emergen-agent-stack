// M1 step 0, part 3: Paperclip's own agent config revisions + rollback, and env redaction. SCRATCH only.
const origin = process.argv[2] ?? 'http://127.0.0.1:3199'; const base = origin + '/api';
if (/:3100$/.test(origin)) throw new Error('refusing to run against the live instance');
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j }; };
const note = (k, v) => console.log(`\n## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);
const cid = (await call('POST', '/companies', { name: 'V3' })).json.id;
const id = (await call('POST', `/companies/${cid}/agents`, { name: 'C1', role: 'qa', title: 'T0', icon: 'bug', adapterType: 'claude_local',
  adapterConfig: { engine: 'cli', command: '/bin/true', model: 'm0', env: { K: 'v0' } } })).json.id;
await call('PATCH', `/agents/${id}`, { title: 'T1', adapterConfig: { model: 'm1', env: { K: 'v1' } } });
await call('PATCH', `/agents/${id}`, { title: 'T2', adapterConfig: { model: 'm2', env: { K: 'v2' } } });
const revs = (await call('GET', `/agents/${id}/config-revisions`)).json;
note('config-revisions list', { count: revs.length, keys: revs[0] && Object.keys(revs[0]), sample: JSON.stringify(revs[0]).slice(0, 700) });
const cur = (await call('GET', `/agents/${id}`)).json;
const target = revs[revs.length - 1];
const detail = (await call('GET', `/agents/${id}/config-revisions/${target.id}`)).json;
note('one revision', JSON.stringify(detail).slice(0, 900));
const rb = await call('POST', `/agents/${id}/config-revisions/${target.id}/rollback`, {});
const after = (await call('GET', `/agents/${id}`)).json;
note('rollback to oldest', { status: rb.status, body: JSON.stringify(rb.json).slice(0, 200), titleNow: after.title, modelNow: after.adapterConfig.model, envNow: after.adapterConfig.env, titleBefore: cur.title });
console.log('\nDONE');
