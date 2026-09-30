---
name: delivery-gate
description: Validation gate every task and milestone must pass before it is marked done or shown to a client. Use when finishing a task, reviewing a PR (QA / UX review), or preparing a client milestone delivery.
---

# Delivery Gate

Nothing incomplete, broken or unfriendly reaches a client. There are two gates.

## Gate 1: Task validation (every task, before "In review" -> "Done")

The implementing engineer self-checks, then QA independently re-checks. A task passes only when **every** line is true and evidenced (command output, screenshot, or file:line).

**Completeness**
- [ ] Every acceptance criterion in the issue is met. List each one with its evidence.
- [ ] No stubs, mock data, placeholder text, TODOs, disabled tests or commented-out code.
- [ ] Empty, loading, error and edge states are handled (no data, slow network, invalid input, permissions denied).

**Correctness**
- [ ] Full test suite, lint and type-check pass (paste the commands and summary lines).
- [ ] New behaviour has tests; bug fixes have a regression test.
- [ ] `{{ENGINEERING_SKILL}}` checklists `feature-complete.md` and `pre-merge.md` pass.

**UX (any user-facing change)**
- [ ] Walk the real flow in a browser/simulator (Playwright or the dev server). Attach screenshots at mobile (375px) and desktop widths.
- [ ] Follows `ui-ux-pro-max` and `apple-design`: clear hierarchy, consistent spacing/typography, obvious primary action, feedback on every action, no layout shift, no horizontal scroll on mobile.
- [ ] `accessibility-review`: keyboard reachable, visible focus, labels on inputs, contrast AA, reduced-motion respected.
- [ ] Copy follows `ux-copy` and `no-slop` (no em dashes, no filler, errors say what happened and what to do).

**Security / ops (when touched)**
- [ ] No secrets in code or logs; input validated server-side; authz checked on every new endpoint.
- [ ] Migrations are reversible and tested against a copy of real-shaped data.

Verdict comment format (QA and UX Reviewer):

```
QA verdict: PASS | FAIL
- Criteria: <n>/<n> met (list any unmet)
- Evidence: <commands run, screenshots>
- Blocking issues: <numbered list with repro steps, or "none">
```

Any unchecked box = FAIL. "Mostly works" is FAIL.

## Gate 2: Milestone delivery (before anything is sent to a client)

Owned by the Manager, checked by QA + UX Reviewer, released only after **board (human) approval**.

- [ ] Every issue in the milestone has QA PASS (and UX PASS if user-facing). No open FAIL, blocker or "in progress" items.
- [ ] End-to-end smoke test of the milestone's main user journeys on a staging build, with screenshots/recording.
- [ ] `{{ENGINEERING_SKILL}}` `production-ready.md` and `deploy-checklist` pass for anything being deployed.
- [ ] Release notes written for the client in plain language: what's new, how to try it, known limitations. Passes `no-slop`.
- [ ] Docs updated (README, env vars, runbook) by the Docs agent.
- [ ] Open a Paperclip approval request to the board with the milestone summary and links. Do not send, deploy to production, or mark delivered until the board approves.
