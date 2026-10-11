// Print request-body fields for the endpoints the reconciler uses. Usage: node m1-openapi.mjs [apiBase]
const base = process.argv[2] ?? 'http://127.0.0.1:3199/api';
const spec = await (await fetch(`${base}/openapi.json`)).json();
const deref = (s, seen = new Set()) => {
  if (!s || typeof s !== 'object') return s;
  if (s.$ref) { if (seen.has(s.$ref)) return { circular: s.$ref };
    const p = s.$ref.replace(/^#\//, '').split('/'); let o = spec; for (const k of p) o = o?.[k]; return deref(o, new Set([...seen, s.$ref])); }
  if (Array.isArray(s)) return s.map((x) => deref(x, seen));
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, deref(v, seen)]));
};
const brief = (s, depth = 0) => {
  if (!s) return '(none)';
  if (s.oneOf || s.anyOf) return (s.oneOf ?? s.anyOf).map((x) => brief(x, depth)).join(' | ');
  if (s.type === 'array') return `[${brief(s.items, depth + 1)}]`;
  if (s.enum) return `enum(${s.enum.join('|')})`;
  if (s.type === 'object' || s.properties) {
    if (depth > 1 || !s.properties) return s.additionalProperties ? 'object(map)' : 'object';
    return '{ ' + Object.entries(s.properties).map(([k, v]) => `${(s.required ?? []).includes(k) ? '*' : ''}${k}: ${brief(v, depth + 1)}`).join(', ') + ' }';
  }
  return s.type ?? 'any';
};
const want = [
  ['post', '/api/companies'], ['post', '/api/companies/{companyId}/agents'], ['patch', '/api/agents/{id}'],
  ['get', '/api/agents/{id}'], ['put', '/api/agents/{id}/instructions-bundle/file'], ['get', '/api/agents/{id}/instructions-bundle/history'],
  ['post', '/api/agents/{id}/instructions-bundle/restore'], ['get', '/api/agents/{id}/skills'], ['post', '/api/agents/{id}/skills/sync'],
  ['post', '/api/companies/{companyId}/routines'], ['get', '/api/companies/{companyId}/routines'],
];
for (const [m, p] of want) {
  const op = spec.paths[p]?.[m];
  if (!op) { console.log(`${m.toUpperCase()} ${p}: NOT FOUND`); continue; }
  const body = deref(op.requestBody?.content?.['application/json']?.schema);
  const ok = Object.entries(op.responses ?? {}).find(([c]) => /^2/.test(c));
  const res = deref(ok?.[1]?.content?.['application/json']?.schema);
  console.log(`\n${m.toUpperCase()} ${p}\n  body: ${brief(body)}\n  ${ok?.[0] ?? '?'}: ${brief(res)}`);
}
const routinePaths = Object.keys(spec.paths).filter((p) => /routine/i.test(p));
console.log('\nroutine paths:', routinePaths.join('  '));
