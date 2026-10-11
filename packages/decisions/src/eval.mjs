// The evaluation harness (Jev use case 08): replay labelled examples, tune the threshold on one half, report on the other.
// A decision may only go live when the held-out half passes the definition's own bar. Pure: the provider and baseline are injected.
import { createHash } from 'node:crypto';

const GRID = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
const BUCKETS = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.0001]];
const half = (input) => parseInt(createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 8), 16) % 2 ? 'B' : 'A'; // stable: a label never changes sides
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * @param {{ definition:any, items:{input:any,label:string}[], provider?:{decide:(r:any)=>Promise<{choice:string,confidence:number}>}, baseline?:(input:any)=>string, concurrency?:number }} a
 */
export async function evaluate({ definition, items, provider, baseline, concurrency = 4 }) {
  const need = definition.eval.minLabelled;
  const labels = new Set(definition.options.map((o) => o.id));
  const clean = items.filter((i) => i && labels.has(i.label));
  const dropped = items.length - clean.length;
  const rows = clean.map((it) => ({ ...it, half: half(it.input), base: baseline ? baseline(it.input) : null, prov: null, error: null }));

  if (provider) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (next < rows.length) {
        const r = rows[next++];
        try { const out = await Promise.race([provider.decide({ definition, input: r.input }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), definition.timeoutMs))]); if (out && labels.has(out.choice) && typeof out.confidence === 'number') r.prov = { choice: out.choice, confidence: out.confidence }; else r.error = 'outside the options'; } catch (e) { r.error = String(e.message).slice(0, 60); }
      }
    }));
  }

  const A = rows.filter((r) => r.half === 'A'), B = rows.filter((r) => r.half === 'B');
  const human = definition.fallback.kind === 'ask-human';
  const baseOf = (r) => (definition.fallback.kind === 'safe-default' ? definition.fallback.default : r.base);
  const answered = (r, t) => r.prov && r.prov.choice !== 'none' && r.prov.confidence >= t;
  const stats = (set, t) => {
    const ans = set.filter((r) => answered(r, t)), ok = ans.filter((r) => r.prov.choice === r.label).length;
    const fb = set.filter((r) => !answered(r, t)), fbOk = human ? null : fb.filter((r) => baseOf(r) === r.label).length;
    return { n: set.length, answered: ans.length, answeredCorrect: ok, coverage: pct(ans.length, set.length), answerAccuracy: pct(ok, ans.length),
      endToEnd: human ? null : pct(ok + fbOk, set.length), humanShare: human ? pct(fb.length, set.length) : null };
  };
  const baselineAcc = human ? null : pct(rows.filter((r) => r.half === 'B' && baseOf(r) === r.label).length, B.length);
  const baselineAll = human ? null : pct(rows.filter((r) => baseOf(r) === r.label).length, rows.length);

  const rep = { decision: definition.id, labelled: clean.length, droppedUnknownLabels: dropped, halves: { tune: A.length, report: B.length }, fallback: definition.fallback.kind,
    baseline: { accuracyAll: baselineAll, accuracyReport: baselineAcc, wrong: human ? null : rows.filter((r) => baseOf(r) !== r.label).length }, provider: null, passes: false, why: [] };
  if (rows.length < need) rep.why.push(`Only ${rows.length} usable labelled examples; the definition asks for at least ${need}.`);
  if (!provider) { rep.why.unshift('No provider was evaluated: this is the baseline alone.'); if (!human) rep.headroom = `Even a perfect model could fix at most ${rep.baseline.wrong} of ${rows.length} (${pct(rep.baseline.wrong, rows.length)} points).`; return rep; }

  // tune on A: the lowest threshold whose answered accuracy meets the bar (and has enough answers to mean something)
  const bar = definition.eval.minAnswerAccuracy;
  const tuned = GRID.find((t) => { const s = stats(A, t); return s.answered >= 5 && s.answerAccuracy / 100 >= bar; }) ?? null;
  const threshold = tuned ?? definition.threshold;
  const onB = stats(B, threshold);
  rep.provider = { errors: rows.filter((r) => r.error).length, errorRate: pct(rows.filter((r) => r.error).length, rows.length), tunedThreshold: tuned, thresholdUsed: threshold, atDefinitionThreshold: stats(B, definition.threshold), held_out: onB,
    buckets: BUCKETS.map(([lo, hi]) => { const s = B.filter((r) => r.prov && r.prov.choice !== 'none' && r.prov.confidence >= lo && r.prov.confidence < hi); return { from: lo, to: Math.min(1, hi), n: s.length, accuracy: pct(s.filter((r) => r.prov.choice === r.label).length, s.length) }; }),
    disagreements: B.filter((r) => r.prov && (r.prov.choice !== r.label || baseOf(r) !== r.label) && r.prov.choice !== baseOf(r)).slice(0, 20).map((r) => ({ input: r.input, label: r.label, provider: r.prov.choice, confidence: r.prov.confidence, baseline: human ? null : baseOf(r) })) };

  const E = definition.eval;
  if (tuned === null) rep.why.push(`No threshold reached ${Math.round(bar * 100)}% accuracy on the tuning half.`);
  if (onB.answerAccuracy === null || onB.answerAccuracy / 100 < bar) rep.why.push(`Held-out accuracy of the answers it gives is ${onB.answerAccuracy ?? 'n/a'}%, below ${Math.round(bar * 100)}%.`);
  if ((onB.coverage ?? 0) / 100 < E.minCoverage) rep.why.push(`It answers ${onB.coverage ?? 0}% of cases; the definition wants at least ${Math.round(E.minCoverage * 100)}%.`);
  if (!human && ((onB.endToEnd ?? 0) - (baselineAcc ?? 0)) / 100 < E.minMarginOverBaseline - 1e-9) rep.why.push(`End to end ${onB.endToEnd}% against a baseline of ${baselineAcc}%: the margin is under ${E.minMarginOverBaseline * 100} points.`);
  if (rep.provider.errorRate > 10) rep.why.push(`${rep.provider.errorRate}% of calls failed.`);
  if (rows.length < need) { /* already explained */ }
  rep.passes = rep.why.length === 0;
  return rep;
}
