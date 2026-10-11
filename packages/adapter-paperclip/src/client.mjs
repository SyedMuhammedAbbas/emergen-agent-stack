// The only module that talks to Paperclip. Behaviours below were observed on a scratch instance, see
// docs/architecture/13-m1-api-findings.md (metadata and runtimeConfig PATCH replace; adapterConfig merges shallowly;
// replaceAdapterConfig is never used; env values are redacted on read; instruction writes need the current revision).
// There is deliberately NO delete method: M1 never deletes anything in Paperclip.
import { normText } from '../../reconciler/src/canonical.mjs';
import { BUILTIN_SKILL } from '../../reconciler/src/desired.mjs';

export class PaperclipError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status} ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 600));
    this.status = status; this.body = body; this.code = body?.code ?? body?.details?.code;
  }
}

export class Paperclip {
  /** @param {string} origin e.g. http://127.0.0.1:3100   @param {{ fetch?: typeof fetch }} [opts] */
  constructor(origin, { fetch: f = globalThis.fetch } = {}) { this.base = origin.replace(/\/+$/, '').replace(/\/api$/, '') + '/api'; this.fetch = f; }

  async #call(method, path, body, { allow = [] } = {}) {
    const r = await this.fetch(this.base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!r.ok && !allow.includes(r.status)) throw new PaperclipError(method, path, r.status, json);
    return { status: r.status, json };
  }

  async health() { return (await this.#call('GET', '/health')).json; }
  async companies() { return (await this.#call('GET', '/companies')).json; }
  async agents(cid) { return (await this.#call('GET', `/companies/${cid}/agents`)).json; }
  async agent(id) { return (await this.#call('GET', `/agents/${id}`)).json; }
  async companySkills(cid) { const j = (await this.#call('GET', `/companies/${cid}/skills`)).json; return Array.isArray(j) ? j : (j.items ?? j.skills ?? []); }
  async agentSkillKeys(id) { return (await this.#call('GET', `/agents/${id}/skills`)).json.desiredSkills ?? []; }

  /** @returns {Promise<{ content:string, contentHash:string, revisionId:string|null } | null>} null when the agent has no file yet */
  async instructions(id) {
    const { status, json } = await this.#call('GET', `/agents/${id}/instructions-bundle/file?path=AGENTS.md`, undefined, { allow: [404] });
    if (status === 404) return null;
    return { content: json.content ?? '', contentHash: json.contentHash, revisionId: json.revision?.id ?? null };
  }

  // ---- writes -------------------------------------------------------------------------------------------------
  createAgent(cid, body) { return this.#call('POST', `/companies/${cid}/agents`, body).then((r) => r.json); }
  /** Partial update. Never sends replaceAdapterConfig. adapterConfig merges shallowly (env is replaced as a whole). */
  patchAgent(id, body) {
    if ('replaceAdapterConfig' in body) throw new Error('replaceAdapterConfig is forbidden: it drops the server-owned instructions* keys');
    return this.#call('PATCH', `/agents/${id}`, body).then((r) => r.json);
  }
  /** runtimeConfig is replaced per top-level key, and heartbeat as a whole: read, change, write everything back. */
  async setHeartbeat(id, heartbeat) {
    const cur = (await this.agent(id)).runtimeConfig ?? {};
    return this.patchAgent(id, { runtimeConfig: { ...cur, heartbeat } });
  }
  /** metadata is replaced wholesale: merge into what is there so other keys survive. */
  async setMetadata(id, patch) {
    const cur = (await this.agent(id)).metadata ?? {};
    const next = { ...cur, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];   // undefined removes a key
    return this.patchAgent(id, { metadata: next });
  }
  /** Reads the current revision right before writing; a 409 means someone edited meanwhile: caller re-plans. */
  async putInstructions(id, content) {
    const cur = await this.instructions(id);
    return this.#call('PUT', `/agents/${id}/instructions-bundle/file`, { path: 'AGENTS.md', content, baseRevisionId: cur?.revisionId ?? null }).then((r) => r.json);
  }
  // ---- routines (a scheduled issue for an agent: the routine plus its schedule trigger)
  async routines(cid) { const j = (await this.#call('GET', `/companies/${cid}/routines`)).json; return Array.isArray(j) ? j : (j.items ?? j.routines ?? []); }
  async routine(id) { const r = await this.#call('GET', `/routines/${id}`, undefined, { allow: [404] }); return r.status === 404 ? null : r.json; }
  createRoutine(cid, body) { return this.#call('POST', `/companies/${cid}/routines`, body).then((r) => r.json); }
  patchRoutine(id, body) { return this.#call('PATCH', `/routines/${id}`, body).then((r) => r.json); }
  createTrigger(rid, body) { return this.#call('POST', `/routines/${rid}/triggers`, body).then((r) => r.json); }
  patchTrigger(tid, body) { return this.#call('PATCH', `/routine-triggers/${tid}`, body).then((r) => r.json); }
  syncSkills(id, mode, keys) { return this.#call('POST', `/agents/${id}/skills/sync`, { mode, desiredSkills: keys }).then((r) => r.json); }

  // ---- read model ---------------------------------------------------------------------------------------------
  /**
   * Live agents as projections comparable with the desired ones (env = sorted key names, skills = slugs).
   * @param {string} cid @param {{ idToKey?: (id:string, name:string)=>string }} [opts]
   */
  async readLive(cid, { ids = {}, nameToKey = {} } = {}) {
    return this.readAll(await this.context(cid, ids, nameToKey));
  }
  /** Skill slug lookup and id->key resolution, built once per run (re-reads of single agents reuse it). */
  async context(cid, ids = {}, nameToKey = {}) {
    const [agents, skills] = await Promise.all([this.agents(cid), this.companySkills(cid)]);
    const slugOf = new Map(skills.map((s) => [s.key, s.slug])), keyOf = new Map(skills.map((s) => [s.slug, s.key]));
    const idsRev = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    const byId = new Map(agents.map((a) => [a.id, a]));
    const extra = new Map();   // key of agents created during this run
    const idToKey = (id) => extra.get(id) ?? byId.get(id)?.metadata?.stack?.key ?? idsRev[id] ?? nameToKey[byId.get(id)?.name] ?? `?${id}`;
    return { agents, slugOf, keyOf, idToKey, remember: (id, key) => extra.set(id, key) };
  }
  /** Every agent in the context, as projections. */
  readAll(ctx) { return Promise.all(ctx.agents.map((a) => this.#normalise(a, ctx))); }
  async readOne(id, ctx) { return this.#normalise(await this.agent(id), ctx); }
  async #normalise(a, ctx) {
    return normaliseAgent(a, { instructions: await this.instructions(a.id), skillKeys: await this.agentSkillKeys(a.id), slugOf: ctx.slugOf, idToKey: ctx.idToKey });
  }
}

/** Pure: raw API objects -> the projection shape used by the planner. Exported for the fixture/contract tests. */
export function normaliseAgent(a, { instructions, skillKeys, slugOf, idToKey }) {
  const ac = a.adapterConfig ?? {}, hb = a.runtimeConfig?.heartbeat;
  const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    id: a.id, name: a.name, role: a.role, title: a.title, icon: a.icon, budgetMonthlyCents: a.budgetMonthlyCents,
    reportsTo: a.reportsTo ? idToKey(a.reportsTo) : null,
    model: ac.model ?? null,
    env: Object.keys(ac.env ?? {}).sort(),            // values come back as "***REDACTED***"
    command: ac.command, timeoutSec: ac.timeoutSec,
    heartbeat: hb ? pick(hb, ['enabled', 'intervalSec', 'maxConcurrentRuns']) : undefined,
    skills: (skillKeys ?? []).map((k) => slugOf.get(k) ?? k).filter((s) => s !== BUILTIN_SKILL).sort(),
    instructions: instructions ? normText(instructions.content) : '',
    instructionRevisionId: instructions?.revisionId ?? null,
    stack: a.metadata?.stack ?? null, metadata: a.metadata ?? null, status: a.status, updatedAt: a.updatedAt,
  };
}

/** Pure: a Paperclip routine (with its triggers) -> the projection used by the planner. */
export function normaliseRoutine(r, idToKey) {
  const trig = (r.triggers ?? []).find((x) => (x.kind ?? 'schedule') === 'schedule') ?? null;
  return { id: r.id, title: r.title, description: r.description ?? '', assignee: r.assigneeAgentId ? idToKey(r.assigneeAgentId) : null,
    cron: trig?.cronExpression, timezone: trig?.timezone, enabled: trig ? trig.enabled !== false : undefined, triggerId: trig?.id ?? null };
}
