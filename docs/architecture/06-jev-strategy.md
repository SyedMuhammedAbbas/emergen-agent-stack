# 6. Jev integration strategy

Status: **based on the "Jev Use Cases Guide" (RoboNuggets, 11 pages, 19 use cases), received 2026-10-11.** Scores below are my judgment for *this* stack. The guide's numbers ("up to 200x faster, 400x cheaper", "227 transcripts in 13 s for 7 cents", "1,700 emails for 18 cents", "Jev 5 s vs Opus 30 s") are the author's own test claims and are ⚠️ **unverified here**; nothing in this document has been measured on our data yet.

## 6.1 What the guide establishes

- Jev can only **decide**, in three shapes: true/false, a choice from a menu, or a 1 to 10 score. It cannot write a sentence. Best setup per the guide: "Jev decides, Claude writes, a person sees the tricky ones." (Consistent with doc 02.)
- It reports **confidence**; the guide's pattern is a threshold (example 60%) below which a person decides, and a **None/Other** option so it is never forced to pick.
- It recommends **validating on labelled examples** before trusting it: split about 200 labelled items in half, tune on one half, report on the other, and look at accuracy per confidence level (use case 08).
- Access is through **OpenRouter** (model name `typesafe/jev-1.13` in the guide). That answers the earlier "how do I get a key": an OpenRouter key from your own account, which you already pay $5 a month for. You type the key into the secret store yourself; I never need to see it. ⚠️ I have not checked which key `jev-router` already uses.
- The guide notes OpenAI announced a "Decisions API" with the same idea (unverified here). Design consequence: the Decision service must be **provider-agnostic**; Jev is the first backend, not a hard dependency.

## 6.2 The 19 use cases scored for this stack

Scores 1 to 5, higher is better for us (Cost, Simplicity and Safety are inverted: 5 = cheap, simple, low-risk). **Rank score = 2 × Usefulness + the other five** (max 35).

| # | Use case | U | Latency | Cost | Simple | Reliab. | Safety | Rank | Fit for us |
|---|---|---|---|---|---|---|---|---|---|
| 08 | Verify Jev's results | 5 | 5 | 5 | 4 | 5 | 5 | **34** | **Prerequisite.** The eval harness; nothing else ships without it |
| 19 | Find your own Jev use cases | 4 | 5 | 5 | 5 | 3 | 5 | **31** | One-off discovery over our past sessions; cheap |
| 09 | Pick the right skill | 5 | 4 | 5 | 3 | 4 | 4 | **30** | ~45 shared skills, 17 per agent, `find-skills`; closed set with a None option; advisory only |
| 11 | Jev in front of AI agents | 5 | 5 | 5 | 3 | 3 | 4 | **30** | Pre-filter Upwork invites, Odoo tickets, inbox before an agent spends tokens |
| 02 | Triage inquiries with a confidence cut-off | 4 | 5 | 5 | 4 | 3 | 4 | 29 | Route Odoo tickets to a department; the threshold pattern is reusable everywhere |
| 17 | Smart features for any app | 3 | 5 | 5 | 5 | 4 | 4 | 29 | Folder choice for the Downloads organiser's unknown files; wizard suggestions |
| 10 | Pick the right model | 3 | 5 | 5 | 3 | 3 | 4 | 26 | **Already built** for Claude by `jev-router`; extend the idea to OmniRoute tiers only |
| 16 | Chatbot with zero LLM calls | 2 | 5 | 5 | 3 | 4 | 5 | 26 | "Which doc answers this?" inside the Control App help; later |
| 07 | Find buyers in your comments | 3 | 4 | 4 | 3 | 3 | 4 | 24 | Orrisian/LinkedIn engagement; needs Apify (extra service and cost) |
| 14 | Search images by content | 3 | 4 | 4 | 2 | 3 | 5 | 24 | Designer/Video asset library; needs captions first |
| 04 | Clip a long video | 3 | 3 | 4 | 2 | 3 | 5 | 23 | Video Generator agent; needs transcription |
| 05 | Score and profile customers | 2 | 4 | 5 | 3 | 2 | 3 | 21 | No customer database in this stack today |
| 06 | Backlinks for site / second brain | 2 | 3 | 4 | 3 | 3 | 4 | 21 | Only if orrisian.com content grows |
| 13 | Semantic find-in-page | 1 | 4 | 4 | 3 | 3 | 5 | 21 | Browser tool, not infrastructure |
| 12 | Chrome extension that folds slop | 1 | 5 | 4 | 2 | 3 | 4 | 20 | Consumer idea; hides content on false positives |
| 01 | Jev in Google Sheets | 1 | 4 | 4 | 2 | 4 | 5 | 19 | We use Odoo, not Sheets |
| 03 | Competitor ad analysis | 1 | 4 | 4 | 2 | 3 | 4 | 19 | Branding could use it much later |
| 15 | Live checker for speech | 2 | 2 | 3 | 1 | 3 | 4 | 17 | Needs live transcription; per-sentence calls |
| 18 | Self-building web pages | 1 | 3 | 4 | 2 | 2 | 3 | 16 | Product idea, not our platform |

Reading the table: the top of the list is **infrastructure we would reuse many times** (a harness, a thresholded decision, a closed-set picker). The bottom is **stand-alone apps** a user could ask an agent to build; they are not part of the operating system and I would leave them out of the product.

## 6.3 How it fits the architecture

One component, the **Decision service** (doc 03), exposing `decide(decisionId, input, options) -> { choice | "none", confidence, source: "jev"|"rule"|"human", latencyMs }`.

Each decision is a registered definition, following the guide's four habits:

| Habit (guide p. 3) | Field in the definition |
|---|---|
| Give Jev a way out | `options` must include `none` / `other`; validation rejects a definition without one |
| Send the unsure ones to a person | `threshold` and `fallback` (`rule`, `safe-default`, or `ask-human`); below it, or on error/timeout, the fallback runs |
| Check before you trust it | `eval` section: labelled set path, split, minimum accuracy and margin over the baseline; a decision cannot be enabled until the harness passes |
| Jev decides, Claude writes | A decision only returns a choice; any text is produced by a different step |

Rules that stay from earlier design: Jev output is **advice**, never a permission grant or approval; inputs that leave the machine are declared with a `dataClass`; Jev being down never blocks work.

Where each top use case lands:

| Use case | Wiring |
|---|---|
| 08 Verify | `stack decisions eval <id>`: replay the labelled set, accuracy per confidence bucket, disagreement list; the same data feeds the UI |
| 09 Skill picker | A `UserPromptSubmit`-style hook (the Claude mod "skill suggestions" shows the mechanism) sends task + skill names/descriptions; returns a *suggested* skill or none. Tested on past tasks. ⚠️ Whether a hook may add context before the model picks a skill needs a small spike |
| 11 / 02 Triage | Hermes intake (Odoo tickets) and the Upwork Scout first pass call `decide` with a closed category set; below threshold goes to the human queue that already exists (Discord approvals) |
| 17 Closed-set pick | Downloads organiser: rules first, Jev only for the files rules leave in "unsorted"; the existing move log and undo make mistakes cheap |
| 10 Model choice | Unchanged for Claude (`jev-router`); OmniRoute tiers chosen by the Decision service for non-Claude runtimes |

## 6.4 MVP recommendation

1. **Build use case 08 first** (the eval harness) together with the Decision-service skeleton.
2. **First live decision: 17 on the Downloads organiser.** Reason: free labelled data exists today. The move logs from the cleanup (`downloads-moved.csv`, `layout-moves.csv`, `qualifi-moved.csv`, `repos-moved.csv` in `C:\Abbas\_data-audit\logs`) record where hundreds of real files ended up, so accuracy can be measured on day one, mistakes are reversible (undo log), and no agent or external system is involved. First measurement: what share of files the current rules leave unsorted (if it is tiny, Jev adds little and we move on).
3. **Second: 09 (skill picker)** and **11 (Upwork/ticket pre-filter)**, once the harness has proven the loop; both need labelled examples collected from real use first.
4. Run **19** once, cheaply, on past sessions to find decisions we have not thought of.
5. Everything else in the table is parked.

Acceptance for any decision going live: beats its baseline (rules or "always ask a person") by the margin in its definition on a **held-out** half of the labelled set, at the chosen threshold; falls back correctly when Jev is unreachable; every call is logged.

## 6.5 Still unverified

Latency, accuracy and cost on our data (everything in the guide is the author's claim); behaviour near the 32K context limit; whether Jev can be self-hosted (data leaves the machine today via OpenRouter); rate limits; the exact meaning of the `Noul` primitive mentioned in earlier research (the guide does not use it); which key `jev-router` currently uses.
