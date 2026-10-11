// stack decisions (M5): list, evaluate and probe. Evaluating with a remote model sends the example inputs to it, so that needs
// an explicit flag naming what leaves this computer. The key is never asked for, printed or stored here.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadBuiltins, LOADERS } from '../../packages/decisions/src/builtin.mjs';
import { evaluate } from '../../packages/decisions/src/eval.mjs';
import { functionProvider, openrouterProvider, openrouterKey } from '../../packages/decisions/src/providers.mjs';

const hashOf = (d) => createHash('sha256').update(JSON.stringify(d)).digest('hex').slice(0, 16);
const recFile = (state, id) => join(state, 'decisions', `eval-${id}.json`);
/** True only if the last passing evaluation was of exactly this definition (any edit invalidates it). */
export const evalPassed = (state) => (id, d) => { try { return JSON.parse(readFileSync(recFile(state, id), 'utf8')).definitionHash === hashOf(d); } catch { return false; } };

export async function run({ argv, state, repo, log, die }) {
  const [, sub, id] = argv, opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; }, flag = (n) => argv.includes(`--${n}`);
  const b = await loadBuiltins(repo), defs = new Map(b.definitions.map((d) => [d.id, d]));
  if (sub === 'list') { for (const d of defs.values()) log(`${d.id}  ${d.enabled ? 'enabled' : 'not enabled'}  ${evalPassed(state)(d.id, d) ? 'evaluation passed' : 'not proven'}  data: ${d.dataClass}  fallback: ${d.fallback.kind}  ${d.title}`); return; }

  if (sub === 'probe') {
    const key = openrouterKey(process.env, state); if (!key) return die('no OpenRouter key. Put it in the OPENROUTER_API_KEY environment variable or in a file named openrouter.key inside ' + join(state, 'secrets') + ' yourself; this tool never asks for it.');
    if (!flag('send-filenames')) return die('probe sends one sample file name to OpenRouter. Add --send-filenames to allow it.');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: opt('model') ?? 'typesafe/jev-1.13', temperature: 0, messages: [{ role: 'system', content: 'Choose one option for the file name. Options: ["Finance","Documents","Images and Logos","none"]. Answer with only JSON: {"choice": <option>, "confidence": <0 to 1>}.' }, { role: 'user', content: '{"name":"invoice-march.pdf"}' }] }) });
    log(`HTTP ${res.status}`); log((await res.text()).slice(0, 3000)); return log('\nThis is the raw answer. If it does not look like {"choice","confidence"} in choices[0].message.content, adjust parse() in packages/decisions/src/providers.mjs to match.');
  }

  if (sub === 'eval') {
    const d = defs.get(id); if (!d) return die(`unknown decision. Known: ${[...defs.keys()].join(', ')}`);
    const file = opt('labelled'); if (!file || !existsSync(file)) return die('usage: stack decisions eval <id> --labelled <file> [--provider rules|openrouter --send-filenames]');
    const items = LOADERS[d.eval.loader](file), which = opt('provider') ?? 'none';
    let provider;
    if (which === 'rules') provider = functionProvider(b.baselines[d.id]);
    else if (which === 'openrouter') {
      if (!flag(`send-${d.dataClass}`)) return die(`this sends ${d.dataClass} from ${items.length} examples to a remote model. Add --send-${d.dataClass} to allow it.`);
      provider = openrouterProvider({ key: openrouterKey(process.env, state), model: opt('model') });
    } else if (which !== 'none') return die('provider must be none, rules or openrouter');
    const r = await evaluate({ definition: d, items, provider, baseline: b.baselines[d.id] });
    if (flag('json')) return log(JSON.stringify(r, null, 2));
    log(`${r.decision}: ${r.labelled} labelled examples (${r.halves.tune} to tune on, ${r.halves.report} held out), fallback: ${r.fallback}`);
    log(`baseline (${r.fallback}): ${r.baseline.accuracyAll}% on everything, ${r.baseline.accuracyReport}% on the held-out half, ${r.baseline.wrong} wrong in total`);
    if (r.headroom) log(r.headroom);
    if (r.provider) { const p = r.provider.held_out; log(`provider: threshold ${Math.round(r.provider.thresholdUsed * 100)}% -> answers ${p.coverage}% of held-out cases, ${p.answerAccuracy}% of those correct; end to end ${p.endToEnd}%; calls failed ${r.provider.errorRate}%`); for (const k of r.provider.buckets) log(`  confidence ${Math.round(k.from * 100)}-${Math.round(k.to * 100)}%: ${k.n} cases, ${k.accuracy ?? '-'}% correct`); }
    for (const w of r.why) log(`  - ${w}`);
    log(r.passes ? 'RESULT: passes. It may be enabled.' : 'RESULT: does not pass' + (r.provider ? '' : ' (nothing evaluated)') + '. It stays off.');
    if (r.passes) { mkdirSync(join(state, 'decisions'), { recursive: true }); writeFileSync(recFile(state, d.id), JSON.stringify({ definitionHash: hashOf(d), passedAt: new Date().toISOString(), threshold: r.provider.thresholdUsed, labelled: r.labelled }, null, 1)); log('Evaluation recorded. Set "enabled": true in decisions/' + d.id + '.json to turn it on.'); }
    return;
  }
  die('usage: stack decisions list | eval <id> --labelled <file> [--provider none|rules|openrouter] | probe --send-filenames');
}
