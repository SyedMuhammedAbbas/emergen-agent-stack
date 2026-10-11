// The requirements document: the ONLY thing free text (or a language model) is allowed to produce.
// Strict on purpose: unknown fields are refused, every value has a type and a limit, and there is no field for permissions,
// commands, paths outside the allow-listed ones, or secrets, so nothing a description says can widen what gets applied.
import { scanText } from '../../../apps/control-app/src/secretscan.mjs';

export const NAME = /^[^\r\n=]{1,80}$/;
export const CATEGORY = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,29}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const WINPATH = /^[A-Za-z]:\\[^<>:"|?*\r\n]*$/;
const SYSTEM_FOLDERS = /^[A-Za-z]:\\(windows|program files|program files \(x86\)|programdata|users\\[^\\]+\\appdata|\$recycle\.bin|system volume information)(\\|$)/i;
export const AUTONOMY = ['quiet', 'balanced', 'watchful'];
const KEYS = new Set(['schemaVersion', 'kind', 'name', 'goals', 'departments', 'tools', 'autonomy', 'budgetMonthlyUsd', 'personal', 'brand', 'unknowns']);
const PERSONAL = new Set(['organizer', 'categories', 'projectsRoot']);
const BRAND = new Set(['name', 'slug', 'website', 'linkedin', 'audience', 'tone', 'offer', 'channels']);

export class RequirementsError extends Error { constructor(errors) { super(errors.join(' ')); this.errors = errors; } }

/**
 * @param {unknown} input @param {{ departments:Record<string,any>, tools:{id:string}[] }} catalog
 * @returns {{ ok:true, value:any } | { ok:false, errors:string[] }}
 */
export function validateRequirements(input, catalog) {
  const errors = [], e = (m) => errors.push(m);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['The requirements must be an object.'] };
  for (const k of Object.keys(input)) if (!KEYS.has(k)) e(`Unknown field "${k}". Only the documented fields are accepted.`);
  if (input.schemaVersion !== 1) e('schemaVersion must be 1.');
  const kind = input.kind; if (!['company', 'personal', 'both'].includes(kind)) e('kind must be company, personal or both.');
  const str = (v, label, max, optional = true) => { if (v === undefined || v === '') { if (!optional) e(`${label} is required.`); return ''; } if (typeof v !== 'string' || v.length > max || /[\r\n]/.test(v)) { e(`${label}: one line of at most ${max} characters.`); return ''; } return v.trim(); };
  const list = (v, label, max, each) => { if (v === undefined) return []; if (!Array.isArray(v) || v.length > max) { e(`${label} must be a list of at most ${max} items.`); return []; } return v.map((x, i) => each(x, `${label} ${i + 1}`)).filter((x) => x !== ''); };

  const v = { schemaVersion: 1, kind };
  v.name = str(input.name, 'Company name', 80, kind === 'personal'); if (v.name && !NAME.test(v.name)) e('Company name: up to 80 characters, no line breaks or "=".');
  v.goals = list(input.goals, 'Goals', 10, (x, l) => str(x, l, 200));
  v.unknowns = list(input.unknowns, 'Open questions', 10, (x, l) => str(x, l, 200));
  const depts = list(input.departments, 'Departments', 20, (x, l) => { if (typeof x !== 'string' || !Object.hasOwn(catalog.departments, x)) { e(`${l}: "${String(x).slice(0, 40)}" is not a department this stack has.`); return ''; } return x; });
  v.departments = [...new Set(depts)];
  const toolIds = new Set(catalog.tools.map((t) => t.id));
  v.tools = [...new Set(list(input.tools, 'Tools', 20, (x, l) => { if (typeof x !== 'string' || !toolIds.has(x)) { e(`${l}: "${String(x).slice(0, 40)}" is not a tool this stack offers.`); return ''; } return x; }))];
  v.autonomy = input.autonomy ?? 'balanced'; if (!AUTONOMY.includes(v.autonomy)) e(`autonomy must be one of ${AUTONOMY.join(', ')}.`);
  const b = input.budgetMonthlyUsd ?? 100; if (typeof b !== 'number' || !Number.isFinite(b) || b < 5 || b > 10000) e('The monthly budget must be a number from 5 to 10000 (US dollars).'); v.budgetMonthlyUsd = b;

  const p = input.personal ?? {};
  if (typeof p !== 'object' || Array.isArray(p)) e('personal must be an object.');
  else {
    for (const k of Object.keys(p)) if (!PERSONAL.has(k)) e(`Unknown field "personal.${k}".`);
    const root = str(p.projectsRoot, 'Projects folder', 200);
    if (root && !WINPATH.test(root)) e('Projects folder: enter a full Windows path such as C:\\Abbas.'); else if (root && SYSTEM_FOLDERS.test(root)) e('Projects folder: that is a system folder; pick one of your own.');
    v.personal = { organizer: p.organizer === true, categories: list(p.categories, 'Folder names', 20, (x, l) => { if (typeof x !== 'string' || !CATEGORY.test(x.trim())) { e(`${l}: use letters, numbers, spaces, dots, dashes or underscores (30 characters max).`); return ''; } return x.trim(); }), projectsRoot: root };
    if (p.organizer !== undefined && typeof p.organizer !== 'boolean') e('personal.organizer must be true or false.');
  }

  if (input.brand !== undefined && input.brand !== null) {
    const br = input.brand;
    if (typeof br !== 'object' || Array.isArray(br)) e('brand must be an object or null.');
    else {
      for (const k of Object.keys(br)) if (!BRAND.has(k)) e(`Unknown field "brand.${k}".`);
      const bn = str(br.name, 'Brand name', 80, false);
      v.brand = { name: bn, slug: str(br.slug, 'Brand folder name', 40), website: str(br.website, 'Brand website', 300), linkedin: str(br.linkedin, 'Brand LinkedIn', 300), audience: str(br.audience, 'Brand audience', 300), tone: str(br.tone, 'Brand tone', 300), offer: str(br.offer, 'Brand offer', 300),
        channels: list(br.channels, 'Brand channels', 10, (x, l) => str(x, l, 40)) };
      if (v.brand.slug && !SLUG.test(v.brand.slug)) e('Brand folder name: lowercase letters, numbers and dashes (3 to 40 characters).');
    }
  } else v.brand = null;

  // consistency
  if (kind === 'personal' && v.departments.length) e('A personal workspace has no departments; choose "company" or "both" to add them.');
  if ((kind === 'company' || kind === 'both') && !v.departments.length) e('A company needs at least one department.');
  if (v.brand && !v.departments.includes('branding')) e('A brand profile needs the branding department.');
  for (const t of catalog.tools.filter((x) => v.tools.includes(x.id) && x.requires)) for (const r of t.requires) if (!v.departments.includes(r)) e(`${t.title} needs the ${r} department.`);

  // secrets never belong in a description (typed into a field, or smuggled in by a model)
  const flat = JSON.stringify(v);
  if (scanText(flat.replace(/","/g, '\n')).length) e('Something here looks like a password or key. Never type secrets into setup; each service asks for them in its own sign-in.');
  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}
