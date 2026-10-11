# M5: decision service and evaluation harness

`packages/decisions`. Jev-style "pick from a closed list" decisions, provider-agnostic, with the proof step built in.

## What exists

- **Definition** (`decisions/<id>.json`, validated by `definition.mjs`): closed `options` that must include `none`, a `threshold`, a `fallback` (`rule`, `safe-default`, `ask-human`), a `dataClass` (what leaves this computer when a remote model is used), a timeout, and the bar it must clear (`eval`). `enabled` is `false` until proven.
- **Service** (`service.mjs`): `decide(id, input)` returns `{ choice | none, confidence, source: jev|rule|default|human, latencyMs, reason }`. A provider only advises. Disabled, unproven, no provider, unapproved data class, timeout, error, a choice outside the list, `none`, or confidence under the threshold: all fall back. A provider being down never blocks work. Every call is logged to `~/.agent-stack/decisions/calls.jsonl` (inputs of class `private` as a hash only).
- **Harness** (`eval.mjs`, use case 08): replays labelled examples, splits them in two by a hash of the example (stable, independent of order), tunes the threshold on one half, reports on the other: accuracy of the answers it gives, coverage, end-to-end accuracy against the fallback, accuracy per confidence bucket, disagreements, failure rate. It passes only if the held-out half clears the definition's own bar. A pass is recorded against a hash of the definition; editing the definition invalidates it.
- **Providers** (`providers.mjs`): a function provider (rules, tests) and an OpenRouter provider. The key is read from `OPENROUTER_API_KEY` or `~/.agent-stack/secrets/openrouter.key` that you create; nothing here asks for, prints or stores it.
- CLI: `stack decisions list | eval <id> --labelled <file> [--provider none|rules|openrouter] | probe`. Evaluating against a remote model requires `--send-filenames` (or the class the definition names), so it is always clear what leaves the machine.

## First decision: Downloads folder (`decisions/downloads-folder.json`)

Measured on the 103 labelled moves in `C:\Abbas\_data-audit\downloads-moved.csv`:

| | |
|---|---|
| Rules agree with the label | 98 of 103 (95.1%); 93.3% on the held-out half |
| Files the rules leave in `Misc` | 1 |
| Most a perfect model could fix | 5 files, 4.9 points |

**Reading:** this set cannot show Jev adding value. The rules were written to reproduce these very moves, so the rule baseline is circular (inflated), and the headroom that is left is five files. Per the doc 06 plan ("if it is tiny, Jev adds little and we move on"), the decision stays **off**. What would change that: new labels from real use, i.e. the organiser's later placements plus your corrections, on files that arrived after the rules were written. The harness is ready for them (`--labelled` takes the same CSV format).

## Not done, and why

- **No evaluation against Jev.** There is no OpenRouter key on this machine and I did not ask for one. The OpenRouter adapter's contract is **unverified**: it asks for a JSON `{choice, confidence}` in the message and treats anything else as a failure (which falls back). `stack decisions probe --send-filenames` makes one call and prints the raw reply so the real shape can be checked and `parse()` adjusted. I could not extract the guide's text to read its example, so I did not guess.
- **The organiser does not call the service yet.** It stays rules-only until a decision passes.
- No UI screen for decisions: there is nothing to show until a decision is evaluated.
- Use cases 09 (skill picker) and 11 (triage) need labelled examples from real use first.

Tests: `node --test packages/decisions` (definition rules, every fallback path, data-class gate, private logging, harness on a good model, a confidently wrong model, a model no better than rules, failures, too little data, stable split, adapter failing safe, the real definition against `rules.js`).
