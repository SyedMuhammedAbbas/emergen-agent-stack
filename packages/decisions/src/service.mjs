// decide(id, input) -> { choice | 'none', confidence, source, latencyMs, reason }
// A provider only ADVISES with a choice from the definition's closed list and a confidence. Anything else, a timeout, an error,
// a low confidence, a disabled definition or an unapproved data class falls back (rule / safe default / ask a person), so a
// provider being down or wrong never blocks the work. The result is never a permission or an approval.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateDefinition } from './definition.mjs';

const withTimeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

/**
 * @param {{ definitions: any[], providers: Record<string, {remote:boolean, decide:(req:any)=>Promise<{choice:string,confidence:number}>}>,
 *   baselines: Record<string,(input:any)=>string>, logDir?: string, allowedDataClasses?: string[], evalPassed?: (id:string, definition:any)=>boolean,
 *   providerName?: string, now?: ()=>number }} cfg
 */
export function createDecisionService({ definitions, providers, baselines = {}, logDir, allowedDataClasses = [], evalPassed = () => false, providerName = 'jev', now = Date.now }) {
  const defs = new Map();
  for (const d of definitions) { const v = validateDefinition(d); if (!v.ok) throw new Error(`Decision ${d?.id}: ${v.errors.join(' ')}`); defs.set(d.id, d); }
  const log = (rec) => { if (!logDir) return; try { mkdirSync(logDir, { recursive: true }); appendFileSync(join(logDir, 'calls.jsonl'), JSON.stringify(rec) + '\n'); } catch { /* logging must never break a decision */ } };

  function fallback(d, input, reason) {
    const f = d.fallback;
    if (f.kind === 'rule') { const c = baselines[d.id]?.(input); if (typeof c === 'string' && d.options.some((o) => o.id === c)) return { choice: c, confidence: 1, source: 'rule', reason }; }
    if (f.kind === 'safe-default') return { choice: f.default, confidence: 1, source: 'default', reason };
    return { choice: 'none', confidence: 0, source: 'human', needsHuman: true, reason };
  }

  return {
    ids: () => [...defs.keys()],
    async decide(id, input) {
      const d = defs.get(id); if (!d) throw new Error(`Unknown decision "${id}".`);
      const t0 = now(), done = (r) => { const out = { ...r, latencyMs: now() - t0 }; log({ at: new Date(t0).toISOString(), id, input: d.dataClass === 'private' ? { sha256: createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16) } : input, choice: out.choice, confidence: out.confidence, source: out.source, reason: out.reason, ms: out.latencyMs }); return out; };
      const provider = providers[providerName];
      if (!d.enabled) return done(fallback(d, input, 'decision is not enabled'));
      if (!provider) return done(fallback(d, input, 'no provider configured'));
      if (provider.remote && d.dataClass !== 'none' && !allowedDataClasses.includes(d.dataClass)) return done(fallback(d, input, `you have not approved sending ${d.dataClass} to a remote model`));
      if (!evalPassed(id, d)) return done(fallback(d, input, 'not proven yet: run the evaluation first'));
      let r;
      try { r = await withTimeout(provider.decide({ definition: d, input }), d.timeoutMs); } catch (e) { return done(fallback(d, input, `provider failed: ${String(e.message).slice(0, 80)}`)); }
      if (!r || typeof r.choice !== 'string' || !d.options.some((o) => o.id === r.choice) || typeof r.confidence !== 'number' || !(r.confidence >= 0 && r.confidence <= 1)) return done(fallback(d, input, 'provider answered outside the allowed options'));
      if (r.choice === 'none') return done(fallback(d, input, 'provider chose none'));
      if (r.confidence < d.threshold) return done(fallback(d, input, `confidence ${Math.round(r.confidence * 100)}% is below ${Math.round(d.threshold * 100)}%`));
      return done({ choice: r.choice, confidence: r.confidence, source: providerName });
    },
  };
}
