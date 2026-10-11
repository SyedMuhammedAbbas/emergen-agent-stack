# 14. M2 plan: the Control App (shell, services, visibility)

Status: **plan for approval, nothing built.** Basis: doc 09 (M2 entry), docs 03/07/08, the M0/M1 results, and a read of `tools/setup-wizard` (server 111 lines, actions 167, UI 407, tests) and the known-problems list in `docs/operations.md`. ✅ verified, ⚠️ to verify in step 0.

## 1. Goal

One local app that answers three questions without a terminal: **is everything running, what is it costing, what needs me?** It also takes over the daily chores that today need PowerShell and WSL commands: starting, stopping and diagnosing the services, and viewing the reconciler's plan.

**Non-goals for M2:** onboarding from a description (M3), tools and MCP runtime (M4), Jev decisions (M5), a visual workflow builder, remote access or accounts, a desktop wrapper (Tauri/Electron decision stays after M3), changing how agents run. The app never edits Paperclip data directly; it uses the same API and `stack` CLI as today.

## 2. Decisions this plan makes (change them if you disagree)

| # | Decision | Why |
|---|---|---|
| D1 | **The app runs on Windows, not in WSL.** It reaches WSL through `wsl.exe` (as `stack.cmd` already does) and the services through their localhost ports | The app's main job is to show that WSL or a service is down. If it lived in WSL it would die with it. It also needs Windows-only things: the scheduled task, `.wslconfig`, disk space, Defender state |
| D2 | **Evolve `tools/setup-wizard` into `apps/control-app`** (plain Node `http`, no framework, vanilla JS UI) | The wizard already has the hard parts, tested: loopback bind, one-time token, Host check, JSON-only bodies, choices-not-commands, preview mode, layout audit. Keep them |
| D3 | **Files, not SQLite, in M2.** JSON and JSON-lines under `%LOCALAPPDATA%\AgentStack\` | This is a change from doc 08. Windows Node here is 20.17 (no `node:sqlite`), a native module is a new install risk, and M2 only needs small logs and a cost cache. Move to SQLite when a query needs it (M3+) |
| D4 | **Node 20+ compatible code** (no Node 24-only APIs) | The Windows machine has Node 20.17; WSL has 24 |
| D5 | **Secrets: an inventory and leak scanner in M2, not a secret store** | Today's secrets are few and live in known files (jev-router env, Hermes `.env`, OmniRoute, `gh`/Claude logins). A scanner proves nothing leaks into git, logs or app state. A store (Credential Manager) can follow when M3/M4 add integrations that need one |
| D6 | **No pinned-install/checksum work in M2** | Doc 09 listed it here; it is a separate piece (versions + checksums for Paperclip, jev-router, OmniRoute, Claude Code) with its own risks. Proposed as M2.6, optional |

## 3. What is reused

| From | Reused as |
|---|---|
| `tools/setup-wizard` server/ui/tests/`dev/ui-audit.js` | The app shell, auth, layout audit |
| `apps/cli/stack.mjs` + `packages/*` | The Team screen reads `stack plan --json`; the app never re-implements planning |
| `stack doctor`, `docs/operations.md` fixes | Seeds of the Services doctor checks |
| `tools/scratch-paperclip` | A safe target for service start/stop tests |
| `windows/wsl-host.ps1`, watchdog timer | Keepalive and watchdog status shown, not rewritten |
| Paperclip `/api/health`, `heartbeat-runs` (cost in `usageJson.costUsd`, `billingType`) | Cost and activity data (✅ fields seen in M0; ⚠️ pagination) |

## 4. Screens in M2

| Screen | Content | Writes? |
|---|---|---|
| **Home** | One status line (all good / n problems), service tiles, spend this month vs budget, "needs you" list (approvals waiting, agents in error, plan items needing a decision), last 5 events | no |
| **Services** | Paperclip, jev-router, OmniRoute, Hermes gateway, WSL, keepalive task, watchdog timer: state, port, uptime, memory, last log lines. Buttons: Start, Stop, Restart, Run doctor | yes (confirmed, logged) |
| **Team** | The reconciler's plan per agent: ok, update, keeping a live edit, needs a decision, with field-level diff; links to the agent in Paperclip. Read-only in M2 | no (apply stays in the CLI) |
| **Cost** | Month to date from Paperclip runs, by agent and department; subscription runs shown separately from API-billed; projection to month end; budget line (default $100) | no |
| **Activity** | Recent runs and approvals across agents, filter by agent/status, link out to Paperclip | no |
| **Models** | The two routing paths (jev-router for Claude, OmniRoute for others), health, tiers; no editing | no |

Visual design: the calm operational direction from doc 07. A short design pass (palette, type, layout wireframes, dark mode) comes **before** building M2.1 and is shown to you first.

## 5. Services layer

A `service` is a small declarative record, not code per service:

```js
{ id, title, kind: 'wsl-systemd'|'windows-task'|'process',
  unit, port, health: { url|port|cmd }, start, stop, logs, dependsOn, startPolicy }
```

- `wsl-systemd` services (Paperclip, jev-router, OmniRoute, watchdog timer) are controlled with `wsl.exe -d <distro> -- systemctl --user …`; status from `systemctl show`, health from the port.
- `windows-task` (keepalive, Hermes gateway) uses `schtasks`/`Get-ScheduledTask`.
- The allow-list of actions per service is fixed in code; the browser only sends `{service, action}`.
- **Doctor** = a list of checks, each `{id, title, run() -> ok|warn|fail + fix?}`. Checks from known problems (all of which happened on this PC): WSL down; keepalive missing; Paperclip unreachable from Windows; port clash on 3100/54329; C: below 5 GB; WSL memory near cap; Claude not logged in (WSL and Windows); `claude` missing from the service PATH; jev-router down; `ids.json` missing; reconciler contract drift (`stack doctor`); symlink privilege (tested from Node, never PowerShell); orphan Postgres processes holding a data path (native case). A **fix** is only offered when it is safe and reversible (restart a service, rewrite a drop-in); anything else shows the exact command for you to run.
- Every state-changing action writes an audit line (who, what, result) to `%LOCALAPPDATA%\AgentStack\audit.jsonl`.

## 6. Data and polling

- A background poller in the app (every 10 s for health, 60 s for runs/cost) feeds the UI through one `/api/state` endpoint; the UI polls that, no websockets in M2.
- Cost: read `heartbeat-runs` since the 1st of the month, cache per-run cost in `cost-cache.json` (run id → cost, agent, billing type, finished time) so the next refresh only fetches new runs.
- Paperclip's own spent-counters ignore subscription runs (✅ M0/M1 findings), so the app sums run costs itself and labels the source.
- Nothing is sent off the machine.

## 7. Security

Same boundary as the wizard: bind `127.0.0.1`, random token in the URL (kept in `sessionStorage`), Host header check, JSON only, no command strings from the browser, request size cap. New for M2: state-changing endpoints require the token **and** a confirmation field the UI only sends after the user confirms, and are rate-limited; the audit log never contains secret values; the secret scanner (below) runs in the test suite.

**Secret scanner:** a function that lists known secret locations (paths only, never contents), and scans git-tracked files, the app's own state/logs and the journal for key-shaped strings (`sk-…`, `ghp_…`, JWT, long hex/base64 next to words like key/token/secret). It reports file and line, never the value.

## 8. Work breakdown

| Step | Work | Size | Depends on |
|---|---|---|---|
| **0** | Verify: approvals/runs endpoints and pagination, cost fields over a month of runs, `systemctl` control latency via `wsl.exe`, health of each service from Windows, schtasks status read without admin | S | none |
| **M2.1** | Design pass (you approve); app skeleton from the wizard; state poller; Home + Services (read-only health) | M | 0 |
| **M2.2** | Team screen from `stack plan --json` | S | M2.1 |
| **M2.3** | Service control (start/stop/restart), audit log, doctor with safe fixes | M | M2.1 |
| **M2.4** | Cost and Activity screens, cost cache | M | 0, M2.1 |
| **M2.5** | Models screen, secret inventory and scanner, backups (button runs `paperclipai db:backup` and lists results) | S–M | M2.1 |
| **M2.6** *(optional)* | Pinned versions + checksums for managed services (`services.lock.json` already pins Paperclip for the reconciler) | M | none |

Rough total 3 to 4 weeks (⚠️ an estimate). Order: 0, M2.1, M2.3 (the part you will feel daily), then M2.4, M2.2, M2.5.

## 9. Acceptance criteria and tests

| Criterion | Test |
|---|---|
| Home reflects reality in under 2 s and turns red within ~10 s of a service dying | Scripted: stop the scratch Paperclip unit, assert the tile state change; stop and start it from the app |
| Service control works and is safe | Integration against the scratch unit (same code path as the live units); a request without token/confirmation is refused; unknown `{service, action}` is refused; audit line written for each action |
| Doctor finds seeded faults | Fault injection list: unreachable port, wrong version, missing keepalive (mock the task query), low disk (mock), port clash; each produces the expected finding and, where offered, a fix that clears it |
| Cost matches Paperclip | Compare the app's month total with the sum of `usageJson.costUsd` from the API for the same period; subscription runs flagged |
| No secrets leak | Scanner test over repo, app state, logs and journals finds none; seeded fake keys are found |
| UI holds at 360, 768 and 1280 px, no overlap or horizontal scroll | `dev/ui-audit.js` extended to every screen, run in the test suite |
| Read-only screens cannot change anything | Static check: only the Services and Backup handlers contain write paths; all go through the audited action runner |
| Wizard and `stack` CLI still work | Their existing tests pass unchanged; `setup.cmd` still opens the wizard |

## 10. Risks

| Risk | Mitigation |
|---|---|
| `wsl.exe` calls are slow or wake a stopped distro | Cache results; a `down` WSL is a reported state, never a command that starts it unless you press Start |
| The app itself must keep running | Start at logon via a scheduled task (same mechanism as the keepalive); a visible "app uptime" tile |
| Scope growth into a general dashboard | The screen list above is the scope; anything else is M3+ |
| Cost numbers confuse (subscription vs API) | Two labelled totals and the source of each number on the page |
| Service control touches live agents | Stop/restart of Paperclip warns when runs are active (read from the API) and asks for confirmation |

## 11. Decisions and questions for you

1. Approve the plan, or change scope. In particular: is **Team (read-only plan view)** wanted in M2, or after?
2. Agree D1 (Windows-hosted) and D3 (files, not SQLite for now)?
3. Should the app start at logon (a scheduled task) or only when you open it (`app.cmd`)?
4. Monthly budget default for the Cost screen: **$100** (your stated limit), with an alert at 80%?
5. Do you want M2.6 (pinned installs and checksums) inside M2 or separate?
