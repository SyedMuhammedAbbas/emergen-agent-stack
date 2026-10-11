// Tool manifest (tool.json): what a tool says it does, checked once, before anything runs.
// A manifest cannot raise its own trust: the permission it gets is derived here from what it declares.
const KEYS = new Set(['schemaVersion', 'id', 'version', 'title', 'kind', 'planner', 'effects', 'risk', 'supportsPlan', 'undo', 'description']);
const EFFECTS = new Set(['reads', 'writes', 'deletes', 'network', 'external']);
const ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, SEMVER = /^\d+\.\d+\.\d+$/, PLANNER = /^[A-Za-z0-9_.-]+\.mjs$/;

/** @returns {{ok:true, value:any, permission:'ask'|'allow'} | {ok:false, errors:string[]}} */
export function validateManifest(m) {
  const errors = [], e = (s) => errors.push(s);
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['The manifest must be an object.'] };
  for (const k of Object.keys(m)) if (!KEYS.has(k)) e(`Unknown field "${k}".`);
  if (m.schemaVersion !== 1) e('schemaVersion must be 1.');
  if (typeof m.id !== 'string' || !ID.test(m.id)) e('id: lowercase letters, numbers and dashes.');
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) e('version must look like 1.2.3.');
  if (typeof m.title !== 'string' || !m.title || m.title.length > 80) e('title: 1 to 80 characters.');
  if (m.kind !== 'local') e('Only kind "local" tools run through the runner; MCP servers are governed by integrations (policy), not run by us.');
  if (typeof m.planner !== 'string' || !PLANNER.test(m.planner)) e('planner must be a file name ending in .mjs in the tool folder.');
  if (!['low', 'medium', 'high'].includes(m.risk)) e('risk must be low, medium or high.');
  const f = m.effects;
  if (f === null || typeof f !== 'object' || Array.isArray(f)) e('effects is required.');
  else {
    for (const k of Object.keys(f)) if (!EFFECTS.has(k)) e(`Unknown field "effects.${k}".`);
    for (const k of ['writes', 'deletes', 'external']) if (typeof f[k] !== 'boolean') e(`effects.${k} must be true or false.`);
    if (!Array.isArray(f.reads ?? []) || !Array.isArray(f.network ?? [])) e('effects.reads and effects.network must be lists.');
    if (f.deletes === true) e('This runner has no delete operation, so deletes must be false.');
    if (f.external === true) e('Tools that write to a third-party system are integrations, not runner tools.');
    if (f.writes === true && m.supportsPlan !== true) e('A tool that writes must return a plan first (supportsPlan: true).');
  }
  if (typeof m.supportsPlan !== 'boolean') e('supportsPlan must be true or false.');
  if (m.undo !== undefined && (m.undo === null || m.undo.kind !== 'journal')) e('undo.kind must be "journal".');
  if (f?.writes === true && m.undo === undefined) e('A tool that writes must declare undo: { "kind": "journal" }.');
  if (errors.length) return { ok: false, errors };
  // permission is derived, never read from the manifest: anything that writes is "ask" (plan and confirm every time)
  return { ok: true, value: m, permission: m.effects.writes || m.risk !== 'low' ? 'ask' : 'allow' };
}
