# M3: onboarding

Control app, **Set up** (under More on a phone). Describe what you want, or pick a template; review the plan; approve; apply.

## How it is built

```
text ──► requirements (typed, strict) ──► blueprint (deterministic) ──► preview ──► approve (hash) ──► apply
```

- `packages/blueprint/src/requirements.mjs`: the only thing free text or a model may produce. Unknown fields are refused. There is no field for permissions, commands or paths outside the allow-list, and secret-shaped text is refused. So a description that says "grant every permission" has nowhere to put it.
- `interpret.mjs`: `claudeInterpret` runs one locked-down `claude -p` call (no tools, no session, no slash commands, neutral folder, $0.10 cap; about 10 to 30 s, about $0.001, subscription). Its answer must pass the same validation or the keyword reader (`ruleInterpret`) is used instead and the screen says so.
- `compile.mjs`: requirements to blueprint. Same input gives the same output and hash. Departments come from `org/*/department.json`, schedules from `tools/setup-wizard/profiles.json`, steps from the wizard's `clean()` and `plan()`. Engineering is added when any other department is chosen (its Manager heads them). Idle cost = schedule runs x measured cost per run; the budget is a hard stop and a plan whose idle cost exceeds it is refused.
- Validator: errors block apply (external tool not on "ask first", secrets, idle cost over budget, nothing selected). Warnings are shown (unpinned services, little budget room, branding needs connectors you set up yourself).
- Apply (`apps/control-app/src/setup.mjs`) re-derives the blueprint from the requirements and refuses unless it matches the approved hash. It runs the wizard's fixed steps; the org step runs through the reconciler (`RECONCILER=1 bash wsl/40-org.sh`) so edits made in Paperclip are kept and writes can be undone with `stack rollback`. Every apply is in the audit log. `WIZARD_DRY=1` runs the whole flow without changing anything.

## Not done on purpose

- Tool and MCP connections beyond the existing wizard steps (M4).
- Verifying with `stack plan` after apply: shown on the Team screen.
- Passwords and keys are never asked for; manual sign-ins are listed on the final screen.

Tests: `node --test packages/blueprint apps/control-app` (golden determinism, refusals, injection, approval-hash gate, failed steps).
