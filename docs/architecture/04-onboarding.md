# 4. Workflow-first onboarding

Goal: the user describes how they work in plain language; the app proposes a workspace (agents, tools, integrations, schedule, budget); the user reviews and approves; the reconciler applies it. Nothing is installed or written before approval.

## 4.1 Pipeline

```
 words  ->  Intake  ->  Requirements  ->  Blueprint  ->  Validate  ->  Preview  ->  Approve  ->  Apply  ->  Verify
 (NL)       (LLM)       (typed JSON)      (compiler)     (rules)       (diff UI)    (human)      (reconciler) (read back)
```

| Stage | Who does it | Output | Failure behaviour |
|---|---|---|---|
| Intake | One LLM call (or a form for users who prefer it) | `Requirements` JSON | Schema-invalid output is retried once, then the form fallback is shown |
| Compile | **Deterministic code**, not an LLM | `Blueprint` from templates plus requirements | Unknown need -> "no template", asks the user, never invents an agent silently |
| Validate | Rules (4.4) | list of errors and warnings | Errors block Apply |
| Preview | UI | Human-readable diff: agents, tools, cost per month, services to install | none |
| Approve | The user | signed approval record (hash of the blueprint) | Apply refuses if the hash differs |
| Apply | Reconciler (doc 03, 3.4) | journal plus snapshot | stop and offer rollback |
| Verify | Reconciler reads state back | pass/fail per object | A failed verification keeps the journal for support |

Design choice: **the LLM only turns words into a typed requirements object and explains things. It never emits agent definitions, commands or config that get applied.** Templates are code-reviewed; LLM text is not. This is what keeps the output reproducible and safe against prompt injection in pasted content.

## 4.2 Requirements (intake output)

```json
{
  "schemaVersion": 1,
  "kind": "business | personal | both",
  "name": "Emergen",
  "goals": ["ship client software", "post on LinkedIn weekly", "manage Upwork proposals"],
  "workflows": [
    { "id": "wf-1", "summary": "Client ticket in Odoo becomes a PR with tests", "trigger": "odoo.ticket.tagged",
      "steps": ["triage", "implement", "qa review", "human approval", "merge"], "humanApproval": ["merge"] }
  ],
  "tools": ["github", "odoo", "discord", "upwork"],
  "preferences": { "budgetMonthlyUsd": 100, "subscriptions": ["claude"], "autonomy": "ask-first",
                   "platform": "windows", "privacy": "local-only-where-possible" },
  "unknowns": ["which repos?", "which Discord channels?"]
}
```

`unknowns` is mandatory output: anything the model could not determine is listed and turned into follow-up questions instead of being guessed.

## 4.3 Blueprint (compiler output)

The blueprint is the single desired-state document. Full schema in doc 05; shape:

```json
{
  "schemaVersion": 1, "workspace": { "id": "emergen", "kind": "company", "orchestrator": "paperclip" },
  "departments": [ { "key": "engineering", "template": "software-company@3", "overlay": { } } ],
  "agents":      [ { "key": "engineering/qa", "from": "template", "overrides": { "heartbeat": "off" } } ],
  "workflows":   [ { "id": "ticket-to-pr", "engine": "paperclip-routine", "nodes": [ ], "edges": [ ] } ],
  "tools":       [ { "id": "github", "kind": "mcp", "permissions": [ "repo:read", "repo:write:ask" ] } ],
  "routing":     { "profiles": [ ] },
  "budget":      { "monthlyUsd": 100, "hardStop": true },
  "services":    [ { "id": "paperclip", "version": "2026.1005.0" }, { "id": "jev-router", "version": "1.6.0" } ],
  "approvals":   { "blueprintHash": null }
}
```

## 4.4 Validation rules

Hard errors (block apply):

1. Schema valid; all ids unique; every `reportsTo` and edge target exists; no cycles in the org or the workflow graph.
2. Every agent has at least one runtime profile whose service is installed or scheduled to be installed.
3. Every tool permission is within the workspace policy; any `write`/`delete`/`send` permission on an external system is `ask` unless the user explicitly chose otherwise on the preview screen.
4. Every referenced secret exists in the secret store or has a pending "connect" step; no literal secrets in the blueprint (scanner rejects key-shaped strings).
5. Service versions are pinned; ports do not collide.
6. Projected idle cost (all heartbeats and routines) fits the budget with at least 30% headroom for work.
7. Filesystem roots exist and are not system folders.

Warnings (shown, not blocking): agent with no tools, tool nobody uses, a department with a manager and one worker, schedule that overlaps another, disk below the guard threshold, subscription plan that cannot cover the projected volume.

## 4.5 Examples

| Description | Result |
|---|---|
| "I run a software agency; tickets arrive in Odoo; I approve merges in Discord." | company workspace from `software-company` template, Hermes bridge on, GitHub and Odoo tools, approval on merge |
| "Organise my Downloads and tell me when disk is low." | personal workspace, no orchestrator, tool `downloads-organizer` (watch), tool `disk-guard`; no services except the app |
| "Post to LinkedIn weekly and answer Upwork invites." | company workspace with `branding` and `freelance` templates; Upwork connector; posting is `ask` |
| Vague: "automate my business" | no blueprint; the app asks the three questions that decide the template: what do you sell, who does the work, what must never happen without you |

## 4.6 What to reuse and what to build

| Reuse | Build |
|---|---|
| Wizard server, token, preview mode, layout audit (`tools/setup-wizard`) | Requirements schema and the intake call |
| `org/` as the first template | Compiler, validator, preview diff |
| `suggestions.json` pattern (curated ideas from research) | Template picker with search |
| Paperclip company export/import for snapshots | Reconciler and journal |

MVP scope: intake can be a **form plus optional free text**; the LLM step is optional in milestone 1 because templates already cover the known cases. Free-text intake ships in milestone 3 once the schema has proven itself.
