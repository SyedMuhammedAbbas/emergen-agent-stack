# 9. Phased roadmap

Rule for every milestone: **the existing `install.ps1 -OnlyOrg`, `org/` and `config.env` path keeps working until the milestone that replaces it passes its migration test.** No milestone is started before the previous acceptance tests pass. Sizes are rough effort for one developer with Claude Code (S ≈ days, M ≈ 1 to 2 weeks, L ≈ 3+ weeks); ⚠️ estimates, not commitments.

## M0 — Spikes (S)  *answers the questions the design depends on*

| | |
|---|---|
| Objective | Remove the three biggest unknowns before building. |
| Work | (1) Run Paperclip + Claude Code natively on Windows, no WSL. (2) Round-trip: `paperclipai company export` of the current company, import into a scratch instance, diff. (3) Measure idle RAM/CPU of Paperclip+Postgres, jev-router, OmniRoute. (4) Confirm which permission mode `claude_local` launches with. (5) Jev latency/accuracy on 100 labelled examples (needs the Use Cases Guide). |
| Acceptance | One page of results each; decisions recorded in the README. |
| Tests | Scripts committed under `spikes/` and re-runnable. |
| Output | Go/no-go on native Windows; whether `metadata` survives export/import; real idle cost. |

## M1 — Foundation and reconciler (L)

| | |
|---|---|
| Objective | Replace destructive sync with safe reconcile; one schema for config. |
| Features | JSON Schemas (agent, department/template, workspace, blueprint); `config.env` -> `workspace.yaml` importer (and generator back); Paperclip adapter with `stackKey`/`appliedHash` metadata, three-way plan, journal, snapshot, rollback; contract tests against recorded Paperclip responses; version pins file. |
| Depends on | M0 (1)(2). |
| Reuse | `org/` content, `40-org.sh` logic, `ids.json` (adopt existing ids), `lib.sh` render rules. |
| New | `packages/schemas`, `packages/reconciler`, `packages/adapter-paperclip`, CLI `stack plan|apply|rollback|drift`. |
| Challenges | Adopting the 18 live agents without recreating them; API drift; orphan rows. |
| Acceptance | On the current machine: `stack plan` shows **zero changes** against the live company; edit an agent in the Paperclip UI -> `stack apply` keeps the edit and reports it; template change applies; forced failure midway rolls back cleanly; no duplicate agents after 3 repeated applies. |
| Tests | Unit (schemas, hashing, three-way matrix), contract (recorded API), integration on a scratch Paperclip instance, a destructive-failure injection test. |
| Migration | Old `-OnlyOrg` stays; new CLI is read-only (`plan`) for one week of daily use before `apply` is trusted. |

## M2 — Control App shell and Service Manager (M)

| | |
|---|---|
| Objective | One local app to see and run everything. |
| Features | Daemon + token auth (from wizard); Home, Services, Models, Activity (read-only) screens; start/stop/update/doctor for Paperclip, jev-router, OmniRoute; pinned installs with checksum; secret store; backups; unified cost view. |
| Depends on | M1 schemas. |
| Reuse | Wizard server/UI/audit, `watchdog.sh` rules, `docs/operations.md` fixes as `doctor` checks. |
| Acceptance | Fresh Windows VM: one command installs pinned services; Home shows green; killing a service is detected and fixed by Doctor; no secret appears in any file or log (scanner test); UI audit passes at 360/768/1280. |
| Tests | Installer dry-run in CI, UI layout audit, secret-leak scanner, doctor fault-injection. |
| Migration | Existing install is detected and adopted, not reinstalled. |

## M3 — Onboarding and templates (M)

| | |
|---|---|
| Objective | Description -> approved blueprint -> applied workspace. |
| Features | Requirements schema; form intake, then free-text intake; compiler; validator (doc 04.4); preview with cost; approval hash; templates: `software-company`, `branding`, `freelance`, `personal-assistant`. |
| Depends on | M1, M2. |
| Acceptance | Five canned descriptions produce expected blueprints (golden files); invalid inputs are refused with a message; an approved blueprint applies on a fresh machine and passes verification; prompt-injection test strings in the description cannot change permissions. |
| Tests | Golden-file tests for the compiler, property tests for the validator, injection corpus. |

## M4 — Tools and Integrations runtime (M)

| | |
|---|---|
| Objective | Safe tools for personal and company use. |
| Features | Tool manifest + runner (roots, plan/confirm/undo, audit); migrate Downloads organiser; MCP host (stdio + HTTP) with per-tool allow/ask/off; Upwork and GitHub integrations; register integrations into Paperclip tool connections. |
| Acceptance | A mutating tool cannot run without a plan and confirmation; undo restores byte-identical files; a tool trying to write outside its roots is blocked; untrusted tool description cannot change its own policy. |
| Tests | Filesystem sandbox tests (path traversal, symlinks, junctions, long paths), undo round-trip, MCP malicious-description fixtures. |

## M5 — Decision service (S–M)  *needs the Use Cases Guide*

| | |
|---|---|
| Objective | Add Jev where it measurably beats rules. |
| Features | Decision definitions, thresholds, fallbacks, log, eval harness; first decision from the ranked list in doc 06. |
| Acceptance | Beats baseline by the margin in its definition on a held-out labelled set; Jev outage does not block any workflow. |

## M6 — Second framework / workflow graph (optional, M–L)

Only if a real need exists by then (e.g. n8n for graph workflows, OpenClaw/Hermes as gateway). Add the second adapter, then finalize the adapter interface. Desktop wrapper (Tauri vs Electron) decision also lives here, using measured numbers.

## Cross-cutting

- Backward compatibility test in every milestone: run old `install.ps1 -OnlyOrg --dry` equivalent and confirm the same agents result.
- Every milestone ends with a short migration note in `docs/` and a tagged release.
