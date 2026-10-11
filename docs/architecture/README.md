# Architecture proposal: Universal Local-First AI Operating System

Status: **proposal for review. Nothing here is implemented, committed, pushed or deployed.** Markers: ✅ verified on this PC / in the code, ⚠️ assumed or not verified.

| # | Document |
|---|---|
| 1 | [Repository audit](01-repo-audit.md) |
| 2 | [Technology research](02-research.md) |
| 3 | [Recommended architecture](03-architecture.md) |
| 4 | [Workflow-first onboarding](04-onboarding.md) |
| 5 | [Plugin and schema specs](05-schemas.md) |
| 6 | [Jev integration strategy](06-jev-strategy.md) (**provisional, needs the Use Cases Guide**) |
| 7 | [UI/UX plan](07-ui-ux.md) |
| 8 | [Technology stack](08-tech-stack.md) |
| 9 | [Phased roadmap](09-roadmap.md) |
| 10 | [Repository structure](10-repo-structure.md) |

## Executive summary

Build **one local Control App** (Node/TypeScript daemon, SQLite, web UI) that adds what is missing today: onboarding, a safe reconciler, service management, a tools runtime, a decision service around Jev, a secret store, and one activity/cost view. **Keep Paperclip as the system of record for company work** instead of building a second control plane. Start with one adapter (Paperclip), add others only when a real use appears.

## Where I push back on the brief

1. **A "Core Control Plane" duplicates Paperclip.** It already has tasks, org, approvals, budgets, routines, templates, export/import and a 728-path API ✅. Mirroring it recreates the sync problems this repo already suffers from.
2. **"Framework-independent agent definitions" for many frameworks is premature.** Herdr is a terminal runtime, Hermes and OpenClaw are runtimes/gateways, n8n/Activepieces/Sim are workflow engines, Dify and AnythingLLM are apps. They are different roles, not interchangeable orchestrators (doc 02). One adapter first; the interface is finalised after the second.
3. **The model path cannot be one router.** Anthropic does not support routing Claude Code to non-Claude models through a gateway ✅ (doc 02). Claude Code stays on jev-router; other runtimes use OmniRoute; never chained.
4. **Jev is a classifier, not a brain.** Choice/Score over a closed set, text-only, group-level calibration. It can advise routing and triage; it must never grant permissions or approve actions. It earns each use by beating a baseline on our data.
5. **n8n cannot be bundled** (Sustainable Use License); Dify is poor for this (no multi-tenant, logo clause). Integrate, don't embed.
6. **An LLM must not emit the config that gets applied.** It fills a typed requirements form; deterministic templates and a validator produce the blueprint.
7. **No visual workflow builder in the MVP.** It is the most expensive item and existing engines already provide one.
8. **"Network egress control per agent" is not enforceable on Windows** without a sandbox; the plan promises disclosure and permissions instead.
9. **The biggest risk is not features, it is the current sync model** (it overwrites UI edits, applies non-transactionally, and corrupted Paperclip once). The reconciler (M1) comes before any UI.

## Key decisions requested

| # | Decision | My recommendation |
|---|---|---|
| D1 | Paperclip stays the company control plane | Yes |
| D2 | Web-app first, desktop wrapper decided after M3 with measurements | Yes |
| D3 | M0 spikes first (native Windows Paperclip, export/import round trip, idle cost, permission mode) | Yes, before any build |
| D4 | SQLite for the app, Windows Credential Manager for secrets | Yes |
| D5 | Roadmap order M1 reconciler -> M2 shell -> M3 onboarding -> M4 tools -> M5 decisions | Yes |

## Open questions for you

1. **Please provide the "Jev Use Cases Guide" (19 use cases).** I could not find it on this machine or in the repo, and I will not invent them. Doc 06 is provisional until then.
2. Is the Control App for you only, or will other teammates install it (affects auth, updates, support burden)?
3. Is native Windows (no WSL) a goal, or is WSL acceptable if it is managed reliably?
4. Which matters more first: company workspace polish, or the personal tools (organiser, assistants)?
5. Is any data you handle subject to rules that forbid sending prompts to hosted services (affects Jev/OpenRouter use)?

## Unverified items to settle in M0

Native-Windows Paperclip; whether agent `metadata` survives export/import; which permission mode `claude_local` uses; idle RAM/CPU; Jev latency, accuracy and self-hosting; `node:sqlite` stability on Node 24; maintained secret-store module; Hermes bridge (needs Odoo/Discord credentials); macOS path (untested).

## What I did in this session (for transparency)

Created only these files under `docs/architecture/` (untracked in git). No existing file was modified for this proposal, no services were changed, nothing was pushed.
