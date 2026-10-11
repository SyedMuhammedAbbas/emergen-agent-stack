// A decision definition: a closed choice with a way out, a threshold, a fallback, and what must be proven before it may go live.
// Follows the four habits from the Jev guide (doc 06): give it a way out, send unsure ones to a person, check before trusting, Jev decides / Claude writes.
const KEYS = new Set(['schemaVersion', 'id', 'title', 'kind', 'options', 'threshold', 'fallback', 'dataClass', 'timeoutMs', 'eval', 'enabled', 'description']);
const EVAL = new Set(['loader', 'minAnswerAccuracy', 'minMarginOverBaseline', 'minCoverage', 'minLabelled']);
const ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, OPT = /^[A-Za-z0-9_][A-Za-z0-9 _.&-]{0,39}$/;
export const DATA_CLASSES = ['none', 'filenames', 'text', 'private'];

export function validateDefinition(d) {
  const errors = [], e = (s) => errors.push(s), num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return { ok: false, errors: ['A definition must be an object.'] };
  for (const k of Object.keys(d)) if (!KEYS.has(k)) e(`Unknown field "${k}".`);
  if (d.schemaVersion !== 1) e('schemaVersion must be 1.');
  if (typeof d.id !== 'string' || !ID.test(d.id)) e('id: lowercase letters, numbers and dashes.');
  if (d.kind !== 'choice') e('Only kind "choice" exists (a pick from a closed list).');
  if (typeof d.title !== 'string' || !d.title) e('title is required.');
  const ids = Array.isArray(d.options) ? d.options.map((o) => o?.id) : [];
  if (!Array.isArray(d.options) || d.options.length < 2 || d.options.length > 40 || ids.some((i) => typeof i !== 'string' || !OPT.test(i))) e('options: 2 to 40 entries, each with a short plain id.');
  else { if (new Set(ids).size !== ids.length) e('options contain a duplicate.'); if (!ids.includes('none')) e('options must include "none": the model must always have a way out.'); }
  if (!num(d.threshold, 0.5, 0.99)) e('threshold must be between 0.5 and 0.99.');
  const f = d.fallback;
  if (!f || !['rule', 'safe-default', 'ask-human'].includes(f.kind)) e('fallback.kind must be rule, safe-default or ask-human.');
  else if (f.kind === 'safe-default' && !ids.includes(f.default)) e('fallback.default must be one of the options.');
  if (!DATA_CLASSES.includes(d.dataClass)) e(`dataClass must be one of ${DATA_CLASSES.join(', ')} (what leaves this computer when a remote model is used).`);
  if (!num(d.timeoutMs, 100, 30000)) e('timeoutMs must be 100 to 30000.');
  const v = d.eval;
  if (!v || typeof v !== 'object') e('eval is required: a decision cannot go live without proof on labelled examples.');
  else {
    for (const k of Object.keys(v)) if (!EVAL.has(k)) e(`Unknown field "eval.${k}".`);
    if (typeof v.loader !== 'string') e('eval.loader is required.');
    if (!num(v.minAnswerAccuracy, 0.5, 1)) e('eval.minAnswerAccuracy must be 0.5 to 1.');
    if (!num(v.minMarginOverBaseline, 0, 1)) e('eval.minMarginOverBaseline must be 0 to 1.');
    if (!num(v.minCoverage, 0, 1)) e('eval.minCoverage must be 0 to 1.');
    if (!Number.isInteger(v.minLabelled) || v.minLabelled < 20) e('eval.minLabelled must be at least 20.');
  }
  if (typeof d.enabled !== 'boolean') e('enabled must be true or false.');
  return errors.length ? { ok: false, errors } : { ok: true, value: d };
}
