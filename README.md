# Agent stack

The company's AI factory, native to Claude Code. Every teammate runs their own copy; this repo keeps everyone's rules, subagents, role standards and skills identical ([team setup](docs/team-setup.md)). The contract it implements is [docs/ai-factory.md](docs/ai-factory.md).

**Quickest setup:** clone the repo, open Claude Code in it and say "Set up the AI factory from this repo". Claude follows [CLAUDE.md](CLAUDE.md).

- **One entry point:** the Claude Desktop / Claude Code chat. The main session coordinates; there is no orchestrator service, dashboard or mandatory command.
- **Global rules:** `~/.claude/CLAUDE.md`, rendered from `org/_global/CLAUDE.md`: routing, delegation, approvals, models.
- **Five subagents** in `~/.claude/agents/`: `engineer`, `code-reviewer`, `qa`, `docs`, `security-reviewer` (from `org/_agents/`). Each reply starts with `STATUS: READY | BLOCKED` or `VERDICT: PASS | CHANGES`.
- **Role standards** as `role-<key>` skills (backend, frontend, devops, qa, ux, docs, secops, cto, estimator, timekeeper), from `org/<dept>/*.md`.
- **Optional `/factory`** skill for large multi-part features: job folder, worktree, spec, build, parallel review, bounded rework, hand-off. Never merges.
- **Optional Hermes bridge.** With [Hermes](https://github.com/NousResearch/hermes-agent), Odoo and Discord: Odoo changes are queued as proposals and written only after you reply `approve N` in Discord; daily digest and standup.

Everything specific to one company lives in `config.env` (not committed) and in the skills you plug in. `examples/emergen.env` is a complete real-world configuration.

**Nothing is written to Odoo without your approval in Discord.** `windows/hermes-bridge.ps1` also disables the write tools of Hermes's `odoo` MCP server, so Hermes itself can only read Odoo. Agents never merge, push to staging/main or deploy to production; protected actions are held by an approval hook.

## Requirements

- Windows 11 with WSL2 and a distro (`wsl --install -d Ubuntu-24.04` in an admin PowerShell, then create the Linux user). WSL runs the renderer (`wsl/60-sync-skills.sh`).
- A Claude subscription for Claude Code, and a GitHub account.
- An engineering-standards skill for your team. `skills/emergen-engineering` is an example you can copy and rewrite.
- For the bridge only: Hermes on Windows with its Discord gateway set up, and `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` in `%LOCALAPPDATA%\hermes\.env`.

## Setup

Run everything from a normal (non-admin) PowerShell in the repo folder.

```powershell
git clone https://github.com/SyedMuhammedAbbas/emergen-agent-stack.git agent-stack
cd agent-stack
Copy-Item examples\team.env config.env; notepad config.env   # or config.example.env
.\windows\collect-skills.ps1     # restores licensed skills that are not in git
.\install.ps1                    # add -SkipHermes if you don't use the Odoo/Discord bridge
```

Required in `config.env`: `WSL_USER`, `COMPANY_NAME`, `STACK`, `ENGINEERING_SKILL`, `PROJECTS_ROOT`, `PROJECT_CATEGORIES`, `DEPARTMENTS`; for the bridge also `DISCORD_CHANNEL_ID` and `TIMESHEET_EMPLOYEE` (exact Odoo employee name). The installer is idempotent; exit code 3 means a login is needed (`gh auth login`, `claude`), then run it again.

## Changing rules, agents and skills

| Change | Edit | Apply |
|---|---|---|
| Global rules | `org/_global/CLAUDE.md` | `.\install.ps1 -OnlyOrg` |
| A subagent | `org/_agents/<name>.md` (frontmatter: name, description, tools, model, maxTurns, skills) | `.\install.ps1 -OnlyOrg` |
| A role standard | `org/<dept>/<key>.md`, shared parts in `org/_partials/` and `org/<dept>/_partials/`; the list of roles in `org/<dept>/department.json` | `.\install.ps1 -OnlyOrg` |
| Your skills | `skills/<name>/SKILL.md` | `.\install.ps1 -OnlyOrg` |
| A project's context | `project-skills/<name>-context/SKILL.md`, mapped in `project-skills/projects.json` | `.\install.ps1 -OnlyOrg` |
| Bridge logic | `hermes/` | `.\windows\hermes-bridge.ps1` |

`-OnlyOrg` runs `wsl/60-sync-skills.sh` (`--dry-run` to preview). It only replaces or removes skills and agents it installed (tracked in `.agent-stack-managed`), and only overwrites a `CLAUDE.md` it generated. Skills can use `{{COMPANY_NAME}}`, `{{STACK}}`, `{{ENGINEERING_SKILL}}`, `{{PROJECTS_ROOT}}`, `{{PROJECTS_ROOT_WINDOWS}}`, `{{PROJECT_CATEGORIES}}` and `{{AGENT_OPS}}`, filled from `config.env` when installed. Third-party skills, their sources and licenses: `skills/THIRD_PARTY.md`.

## Your daily routine (bridge)

| When (config.env) | What | Where |
|---|---|---|
| `STANDUP_SCHEDULE` | Standup text to copy: Completed, Working on, Blockers, each with `#ticket` | #standup |
| On request ("timesheets for today") | The `daily-timesheets` skill reads your commits, matches them to Odoo tasks and queues one proposal | #approvals |
| `DIGEST_SCHEDULE` | Digest of open proposals | #approvals |
| Any time | Reply `approve N` / `reject N`; only then is Odoo written. Ask Hermes in Discord for Odoo lookups or changes | #approvals |

Discord channels: `.\windows\discord-channels.ps1 -GuildId <your server id>` creates the Agent Ops category and saves the channel ids in `config.env`.

## Repository layout

```
CLAUDE.md                   setup playbook Claude follows on a new laptop
install.ps1                 entry point (Windows); mac/install.sh on macOS
config.example.env          settings template -> config.env (git-ignored)
examples/                   team.env (company values) and emergen.env (the owner's configuration)
org/_global/CLAUDE.md       the user-level rules file
org/_agents/*.md            the five subagents
org/<dept>/                 role standards (department.json lists them) + partials
skills/                     shared skills (incl. factory) + THIRD_PARTY.md
project-skills/             one context skill per project + projects.json
wsl/10-base.sh, 20-tools.sh, 25-browser-deps.sh, 30-services.sh   WSL packages, Node, Claude Code, Playwright, logins
wsl/60-sync-skills.sh       renders and installs skills, role skills, subagents and CLAUDE.md
wsl/hooks/                  device guard and MCP policy hooks
windows/wsl-host.ps1        .wslconfig memory limit
windows/hermes-bridge.ps1   bridge scripts, Hermes skill, config, cron jobs (proposals, digest, standup), gateway watchdog
windows/collect-skills.ps1  gathers third-party skills
hermes/                     agent_ops.py (Odoo proposals, approvals, digest, standup, lookups) and its cron entry point
docs/ai-factory.md          the owner's contract
```

Not in git: `config.env`, Hermes secrets in `%LOCALAPPDATA%\hermes\.env`.

Some older docs (`docs/operations.md`, `docs/setup-mac.md`, `docs/departments.md`, `docs/reconciler.md`, `docs/architecture/`) and the `apps/`, `packages/` and `tools/` code still describe the retired orchestrator setup; treat them as history.
