# 6. Jev integration strategy (PROVISIONAL)

**Status: blocked on input.** The prompt refers to a "Jev Use Cases Guide" with 19 use cases. I searched this machine and the repository and did not find it. I will not invent the 19 cases. **Please send the guide** (file or link); until then this document covers only what I verified about Jev and what I can say independent of the guide. Sections 6.4 to 6.6 are the template I will fill in once I have it.

## 6.1 What Jev is (verified from public docs, doc 02)

TypeSafe's System One: a small model family exposing three primitives over `POST /v1/systemone`: **Choice** (pick one of N options), **Score** (rate options), **Noul**. Text in, structured answer out; it does not generate text. Listed at roughly $0.042 per million input tokens on OpenRouter, 32K context. Calibration is only at group level (its confidence is not a per-answer guarantee). `jev-router` (Apache-2.0) is a separate open-source proxy that uses it to choose a Claude tier per human turn.

⚠️ Not verified: latency and accuracy on our tasks, behaviour on long inputs near 32K, rate limits, exact Noul semantics.

## 6.2 Where Jev belongs and where it does not

Fits: **short classification and selection with a closed option set**, where a wrong answer is cheap or reversible, and where an explicit "none/unsure" option exists.

Does not fit: anything needing generation, long documents, multi-step reasoning, or any decision whose error causes data loss, spend or external action. **Jev may never grant a permission or approve an action.** A Jev output is advice that rules or a human confirm.

## 6.3 Candidate uses I can state without the guide (hypotheses, to be reconciled with the 19)

| Candidate | Why plausible | Main risk |
|---|---|---|
| Model tier per task (already done by jev-router for Claude) | Proven pattern in this repo | Only moves up; no learning from outcomes |
| Task triage: which department/agent gets an incoming ticket | Closed set, cheap, reversible (re-assign) | Mis-route delays work; mitigated by "unsure -> manager" |
| Downloads organiser: which folder for an unknown file | Closed set, undo exists | Wrong folder; mitigated by plan/confirm/undo |
| Approval-risk hint: score a proposed action as low/medium/high for the preview | Advisory only | Must never lower the level a rule set |
| Duplicate/near-duplicate decision between two items | Binary choice | False merge; always ask for deletes |
| Skill/tool selection from a catalogue | Closed set, large catalogue | Hidden prompt-injection in tool descriptions |

## 6.4 Evaluation template (to be completed per use case)

For each of the 19 cases, one row, scored 1 to 5 (5 = best for us; risk and complexity inverted):

| # | Use case | Usefulness | Latency fit | Cost | Complexity | Reliability | Risk | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|

Method: usefulness = how often the decision occurs and what a correct answer saves; latency = fits an interactive step (< 1 s) or a background step; reliability = accuracy on a **labelled sample from our own data** (minimum 100 examples per case) against a trivial baseline (rules or "always manager").

## 6.5 Integration design (independent of which cases win)

One component, the **Decision service**, wraps Jev:

```
decide(decisionId, input, options) -> { choice | "none", confidence, source: "jev"|"rule"|"human", latencyMs }
```

- Each decision is a registered definition: options, prompt/format, a **confidence threshold**, a **fallback** (rule, safe default, or ask a human), and a **log** entry per call.
- Below threshold or on timeout/error, the fallback runs; Jev being down must never block work.
- Thresholds are set from the evaluation sample, not guessed; a decision ships only if it beats its baseline by a margin recorded in the definition.
- Eval harness (`stack decisions eval <id>`) replays logged and labelled cases and prints accuracy by confidence bucket; the UI shows the same.
- Privacy: inputs sent to Jev's hosted API leave the machine. Definitions declare `dataClass`; anything above `public/low` is redacted or routed to a local rule. ⚠️ Whether Jev can be self-hosted is unverified.

## 6.6 MVP recommendation (provisional)

1. Keep jev-router for Claude tier choice unchanged.
2. Build the Decision service with **one** low-risk decision first (candidates: file-folder choice for the organiser, or ticket triage), with eval harness and fallback, to prove the loop end to end.
3. Add further decisions only after the first beats its baseline on our data.

This ranking will change when I see the 19 cases; I will not commit to a case list before then.
