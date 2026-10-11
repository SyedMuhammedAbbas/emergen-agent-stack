# 1. Repository audit

Snapshot: `main` at `e794cd2` (same as `origin/main`), audited 2026-10-11. Markers: ✅ verified by reading the code or running it on this PC, ⚠️ not verified.

How I verified: I read the scripts below, and I installed the whole stack on a fresh Windows 11 PC today (WSL Ubuntu 24.04, 18 agents). Everything marked "ran" happened on this machine.

## 1.1 What is in the repository

| Area | Files / lines | What it is |
|---|---|---|
| Installers | `install.ps1` (47), `connect-project.ps1` (66), `windows/` (6 files, 395), `wsl/` (12 files, 1,080), `mac/` (4 files, 497) | Windows host steps call WSL scripts; macOS runs the same `wsl/` scripts natively |
| Org definition | `org/` (31 files, 899) | `company.json`, one `department.json` per department, one markdown file per agent, shared partials |
| Skills | `skills/` (41 skill dirs, 257 tracked files), `project-skills/` (5 files) | Shared skills, vendored third-party skills, per-project context skills |
| Hermes bridge | `hermes/` (5 files, 1,474; `agent_ops.py` alone is 1,313 lines) | Odoo and Discord bridge, run by Hermes cron jobs |
| Docs | `docs/` (7 files, 612) | Operations, team setup, departments, owner rules, Discord message style, macOS, OmniRoute |
| Added 2026-10-11 | `tools/downloads-organizer`, `tools/setup-wizard`, `mods/paperclip-crew`, `wsl/45-omniroute.sh` | Not part of the original system; they are the first pieces of the new product |
| CI and tests | No `.github/`; the only tests are the ones written today plus vendored skills' own tests | The installers have no automated tests |

## 1.2 Architecture today

```
Windows host (PowerShell)
  install.ps1 -> windows/lib.ps1 (Read-Config, Invoke-WslScript) -> wsl.exe -d <distro> -- bash wsl/NN-*.sh
        |
        v
WSL Ubuntu (systemd user services)
  paperclipai.service   Paperclip server :3100 + embedded PostgreSQL :54329 (data in ~/.paperclip)
  jev-router.service    :4000 proxy, :4100 live view; picks a Claude tier per human turn
  agent-watchdog.timer  every 10 min: wsl/watchdog/watchdog.sh
  (added today) omniroute.service :20128
        |
        |  Paperclip spawns Claude Code workers ("claude_local" adapter), each in its own git worktree
        |  3 engineer agents get ANTHROPIC_BASE_URL=http://127.0.0.1:4000 (company.json routerEnv); the other agents call Claude directly
        v
Claude Code (native Linux build in ~/.local/bin) with hooks: wsl/hooks/wait-for-background.sh (Stop), device-guard.sh (PreToolUse)

Windows-native Hermes  (%LOCALAPPDATA%\hermes)
  cron jobs -> hermes/agent_job.py -> agent_ops.py -> Paperclip REST (WSL via localhost) + Odoo XML-RPC + Discord
```

State lives in four places: `config.env` (repo, git-ignored), `~/.agent-stack/ids.json` and `org.rendered.json` (WSL), `~/.paperclip/` (Paperclip's own database and files, 1.6 GB here), and `%LOCALAPPDATA%\hermes\` (Hermes home with `.env` and `agent_ops.config.json`).

## 1.3 Feature status

| Capability | Status | Evidence |
|---|---|---|
| Paperclip company, departments, agents, skills, routines from `org/` | ✅ Complete, ran today | `wsl/40-org.sh` sections company, skills, agents, routines; 18 agents created |
| Agent hierarchy and delegation | ✅ Complete | `reportsTo` in each `department.json`, resolved to ids in `40-org.sh` |
| Per-issue git worktrees, approvals-first rules | ✅ By Paperclip plus rules text | `wsl/50-connect-project.sh` sets workspaces; rules in `org/_partials/common.md` (24 rules) |
| Model routing by task difficulty | ✅ Complete for Claude only | `routerEnv` in `org/company.json`; `jev-router` config tiers fast, balanced, frontier |
| Stall watchdog | ✅ Complete | `wsl/watchdog/watchdog.sh` (stale after 15 min, 3 restarts per 6 h, then escalates to the Watchdog agent) |
| Disk guard (WSL disk lives on C:) | ⚠️ Present, not exercised | `agent_ops.py` `cmd_diskguard` (line 1093), Hermes cron every 5 min |
| Stop and device-guard hooks for agents | ✅ Installed today | `wsl/hooks/*.sh`, merged into `~/.claude/settings.json` by `40-org.sh` |
| Skill sync to Claude Code (WSL and Windows) and project folders | ✅ Complete | `wsl/60-sync-skills.sh`, manifest `.agent-stack-managed` removes only what it installed |
| Hermes bridge: Odoo intake, digest, approvals, proposals, standup, Discord | ⚠️ Not verified here | Needs Odoo and Discord credentials this PC does not have; code reviewed (`agent_ops.py` functions `cmd_intake`, `cmd_digest`, `approve`, `cmd_propose`, `execute_proposal`) |
| Odoo is read-only for Hermes; writes need a Discord approve | ✅ By design in code | `windows/hermes-bridge.ps1` excludes the odoo MCP write tools; `agent_ops.py` `execute_proposal` |
| macOS | ⚠️ Untested | `mac/install.sh` says "NOT YET TESTED ON A MAC" |
| Linux native | ⚠️ Not a supported path | `CLAUDE.md` says run the `wsl/*.sh` scripts directly |
| Unified UI, workspaces beyond one company, tools marketplace, framework manager | ❌ Missing | Only the wizard added today and the Paperclip UI exist |

## 1.4 How configuration flows

1. `config.env` is one flat `KEY=value` file with about 45 keys (`config.example.env`, `examples/team.env`, `examples/emergen.env`).
2. **Three separate parsers read it:** `windows/lib.ps1` `Read-Config`, `wsl/lib.sh` `load_config`, and the Python inside `wsl/lib.sh` `render_file`. None validates types or required keys beyond two (`WSL_DISTRO`, `WSL_USER`).
3. `build_org` in `wsl/lib.sh` merges `org/company.json` and each enabled `org/<dept>/department.json` into `~/.agent-stack/org.rendered.json`; `render_file` fills `{{KEY}}` placeholders and `{{partial}}` includes into each agent's markdown.
4. `40-org.sh` applies that to Paperclip by REST and CLI and records the Paperclip ids in `~/.agent-stack/ids.json`.
5. Observed agent schema (union of fields in every `department.json`): `key, name, role, title, icon, model, router, reportsTo, budgetCents, heartbeat, skills, maxConcurrentRuns`, plus an optional `routine {title, cronEnv, description}`. This is a small, Paperclip-shaped schema, not a general agent definition.

## 1.5 Dependencies, and how they are installed

| Dependency | How installed | Pinned? |
|---|---|---|
| nvm 0.40.3, Node 24 | `curl ... \| bash` from GitHub, then `nvm install 24` (`wsl/20-tools.sh`) | nvm yes; Node major only |
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | No |
| Paperclip | `npm i -g paperclipai@latest` (installed 2026.1005.0, which is also npm's latest tag) | No |
| jev-router | `npm i -g @ediri/jev-router@latest` (installed 1.6.0) | No |
| Playwright Chromium | `npx playwright@latest install` | No |
| OmniRoute (added today) | `npm i -g omniroute` (3.8.51) | No |
| Hermes | External, installed by the user; the bridge needs `venv\Scripts\python.exe` on Windows | n/a |
| Odoo, Discord, GitHub | Credentials the user supplies; `gh auth login` | n/a |

## 1.6 Reusable components

- `org/` agent and department definitions and the 24 shared rules: the substance of the "Emergen software company" template.
- `wsl/40-org.sh` upsert logic (match by saved id, then by name) as the starting point for a proper reconciler.
- `wsl/60-sync-skills.sh` manifest-based install; safe to keep.
- `wsl/watchdog/watchdog.sh` as a model for health policies.
- `hermes/agent_ops.py` classes `Paperclip` (line 110) and `Odoo` (line 153) as thin clients.
- `tools/downloads-organizer` (rules plus watcher plus tests) as the first "tool".
- `tools/setup-wizard` (server, plan/validate/apply pattern, preview mode, layout audit) as the seed of the app shell.
- `mods/paperclip-crew` for monitoring in Claude's UI.

## 1.7 Limitations and technical debt

Each item has evidence from the code or from today's install.

1. **Sync overwrites instead of reconciling.** `40-org.sh` replaces every agent's instructions on each run; `docs/departments.md` says edits in the Paperclip UI are overwritten. Any UI-driven configuration would be destroyed by the next `-OnlyOrg`. This is the blocker for a UI-first product.
2. **API drift breaks the sync silently.** The newer Paperclip requires `baseRevisionId` on instruction updates; the old call failed ("instructions update failed") and I had to patch `40-org.sh`. Nothing detects such contract changes before a run.
3. **Non-transactional apply.** A run that died halfway left six duplicate agents ("Brand Lead 2" and so on); `ids.json` tracked the second set. Deleting the first set then left orphan rows (budget policies, grants, memberships) that **crashed Paperclip at startup** ("Agent not found") until I removed them from its database by hand. Paperclip's own deletes do not clean those references.
4. **Unpinned installs.** `@latest` and `curl | bash` mean two machines can end up different, and a compromised upstream would run unreviewed.
5. **Three config parsers, no schema, secrets in plain files.** `config.env`, `~/.config/jev-router/env` (mode 0600), Hermes `.env`. No central secret store.
6. **WSL coupling.** Windows steps shell into `wsl.exe`. On this PC WSL shut itself down whenever no terminal was open, taking Paperclip down several times; the intended fix (a Windows scheduled task, `windows/wsl-host.ps1`) is blocked in a restricted session. Repos on `/mnt/c` need a 60-second git-scan timeout drop-in (`wsl/30-services.sh`). The disk guard exists because WSL's disk lives on C:.
7. **Cost control does not cover subscription runs.** Paperclip reported about $1.24 of run cost while its per-agent spend counters stayed at $0, so budgets in `department.json` do not stop spending for subscription-billed runs.
8. **Brittle contracts in prose.** The bridge finds work by regex on agent comments (`agent_ops.py` `parse_summary`, line 354, and the `Run summary` heading). Agent wording changes can silently break the Odoo digest. (Today I had to keep non-engineering agents from using that heading for exactly this reason.)
9. **Company-specific assumptions in shared rules.** `org/_partials/common.md` mentions Odoo stages, staging branches and Flutter; every agent, including new departments, receives it.
10. **`agent_ops.py` is a 1,313-line monolith** mixing intake, approvals, Odoo writes, disk guard and standup behind one CLI.
11. **No observability layer.** Logs are spread over `journalctl`, `watchdog.log`, the jev-router log and Hermes; there is no single view of runs, decisions and cost.
12. **No tests or CI for the installers.**

## 1.8 Security risks

- Plain-text secrets in three locations (item 5); a leaked `config.env` would expose Discord ids and Odoo employee names, and the Hermes `.env` holds the Odoo API key and bot token.
- `curl | bash` execution from the internet (item 4).
- Agents execute with the owner's identity on real repositories; the safeguards are prose rules plus two hooks. ⚠️ I did not verify which permission mode Paperclip's `claude_local` adapter launches Claude Code with; that determines how much the hooks and rules actually constrain. This is an open question for the design (see README).
- Prompt injection: ticket text from Odoo and web pages the agents read flows into agent context; the only mitigation is instruction text.
- The Paperclip API runs in `local_trusted` mode (no authentication) on loopback; any local process can call it. Acceptable on a single-user PC, not for shared machines.

## 1.9 Migration concerns

- The existing `org/` plus `config.env` must keep working unchanged until a new path is proven (`install.ps1 -OnlyOrg` is used daily).
- `ids.json` maps template keys to Paperclip ids; a reconciler must adopt existing ids, not recreate agents (recreating loses run history and, as seen above, can corrupt the database).
- Hermes cron jobs and `agent_ops.config.json` hold ids and a `project_map`; they must be regenerated from the same source of truth, not edited by hand twice.
- The Odoo ticket synchronisation contract (comment formats, `agent-ready` tag, approval commands) is relied on by daily use and must not change without a compatibility shim.
