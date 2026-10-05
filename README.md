# Agent stack

An AI factory that runs on one laptop (Windows + WSL today; macOS in [beta](docs/setup-mac.md)) and starts on its own at logon. Every teammate runs their own copy; this repo keeps everyone's agents, standards and skills identical ([team setup](docs/team-setup.md)).

**Quickest setup:** clone the repo, open Claude Code in it and say "Set up the AI factory from this repo". Claude follows [CLAUDE.md](CLAUDE.md).

- **Paperclip** runs Claude Code agents as an org, grouped in [departments](docs/departments.md): **Engineering** (Manager, CTO, Frontend, Backend, DevOps and SecOps Engineers, QA, UX Reviewer, Docs, Estimator), **Operations** (Timekeeper, Watchdog) and a **Branding** template (Brand Lead, Social Media Writer, Video Producer) you can switch on.
- **jev-router** picks Haiku, Sonnet or Opus per turn for the three engineers whose task difficulty varies.
- **Optional: Hermes bridge.** If you run [Hermes](https://github.com/NousResearch/hermes-agent) with Odoo and Discord, tickets tagged in Odoo become agent tasks, agent questions arrive in Discord, and a daily digest asks you to approve work before timesheets are written back to Odoo.

Everything specific to one company lives in `config.env` (not committed) and in the skills you plug in. `examples/emergen.env` is a complete real-world configuration.

## How work flows

```
Ticket (Odoo tag, Discord "new project:", or a Paperclip issue you create)
        │
Manager routes: Frontend / Backend / DevOps / SecOps   (risky work: CTO brief first)
        │
Engineer works in its own git worktree of the project repo -> branch + PR + self-check -> in_review
        │
QA (every task) + UX Reviewer (user-facing) + SecOps (risky)  ->  PASS / FAIL
        │
Run summary comment on every run (ticket id, PR, verdict, hours, proposed stage)
        │
Daily digest (bridge) -> you approve / edit / reject -> timesheets + stage + note in Odoo
```

**Nothing is written to Odoo without your approval in Discord.** Intake only reads Odoo. Every Odoo change (timesheets, new tickets, stage moves, notes) is posted to Discord first, as a digest item or a numbered 📝 proposal, and written only after you reply `approve N`. `windows/hermes-bridge.ps1` also disables the write tools of Hermes's `odoo` MCP server, so Hermes itself can only read Odoo.

Agents never merge, push to the main branch, or deploy to production. Questions they can't answer alone are posted as `**Question for board:**` and relayed to you. A milestone is never sent to a client without passing Gate 2 of `skills/delivery-gate` and your approval in Paperclip.

## What runs where

| Piece | Where | Started by |
|---|---|---|
| Paperclip (http://localhost:3100) | WSL, systemd user service `paperclipai.service` | WSL boot (linger) |
| jev-router (:4000, live view http://127.0.0.1:4100) | WSL, systemd user service `jev-router.service` | WSL boot |
| Agent workers (Claude Code) | WSL, spawned by Paperclip | Assignments, @-mentions, Manager heartbeat |
| Project repos | WSL `~/projects/<project>/<repo>` | `connect-project.ps1` |
| WSL itself | Windows task `WSL-Agents-Keepalive` | Windows logon |
| Bridge (optional) | Hermes cron `agent-intake` (15 min), `agent-digest` (daily) + task `Hermes-Gateway-Watchdog` | Hermes gateway |

## Requirements

- Windows 11 with WSL2 and a distro (`wsl --install -d Ubuntu-24.04` in an admin PowerShell, then create the Linux user).
- **At least 5 GB free on C:** (20 GB recommended). The WSL disk lives on C:; if C: fills up, Linux switches it to read-only.
- A Claude subscription for Claude Code (the agents' worker).
- A Jev key for jev-router: TypeSafe (console.typesafe.ai) or an OpenRouter key with credits.
- A GitHub account the agents can open PRs with.
- An engineering-standards skill for your team (see [Skills](#skills)). `skills/emergen-engineering` is an example you can copy and rewrite.
- For the bridge only: Hermes on Windows with its Discord gateway set up, and `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` in `%LOCALAPPDATA%\hermes\.env`.

## Setup

Run everything from a normal (non-admin) PowerShell in the repo folder.

**1. Configure**

```powershell
git clone https://github.com/SyedMuhammedAbbas/emergen-agent-stack.git agent-stack
cd agent-stack
Copy-Item config.example.env config.env
notepad config.env
```

Teammates start from `examples/team.env` instead (company values filled in, personal ones blank). Required: `WSL_USER`, `COMPANY_NAME`, `STACK`, `ENGINEERING_SKILL`, `PROJECTS_ROOT`, `PROJECT_CATEGORIES`, `DEPARTMENTS`. For the bridge also `DISCORD_CHANNEL_ID` (Discord Developer Mode, right-click the channel, "Copy Channel ID") and `TIMESHEET_EMPLOYEE` (exact Odoo employee name).

**2. Collect third-party skills**

```powershell
.\windows\collect-skills.ps1
```

Restores the licensed skills that are not in git (listed in `skills/THIRD_PARTY.md`) from your Claude installs into `skills/`. Install any it reports missing and run it again, or continue without them.

**3. Install**

```powershell
.\install.ps1              # add -SkipHermes if you don't use the Odoo/Discord bridge
```

The installer is idempotent. When something needs you, it stops with exit code 3 and a list. On the first run that is, in an Ubuntu terminal (`wsl -d Ubuntu-24.04`):

```bash
source ~/.bashrc
gh auth login
claude                  # log in with your Claude account, then /exit
jev-router setup --models claude --service systemd --no-claude-settings
```

For `jev-router setup`, paste a TypeSafe key, or leave it empty and paste an OpenRouter key. Then run `.\install.ps1` again. If it changed `%UserProfile%\.wslconfig`, run `wsl --shutdown` once so the memory and idle settings apply (this also restarts Docker Desktop).

**4. Check**

Open http://localhost:3100: the org chart shows the agents of every department in `DEPARTMENTS`. With the bridge, tag a small Odoo task `agent-ready`; within 15 minutes it appears in Paperclip and a notice is posted in Discord.

## Working on a project

Agents need a repo to work in. Connect each project once, either with your existing local checkouts or with fresh clones:

```powershell
# your checkouts on D:, linked to Odoo project 91
.\connect-project.ps1 -Name NeuraX -Base staging -OdooProjectId 91 `
    -LocalPath D:\Projects\Emergen\NeuraX\neurax-backend, D:\Projects\Emergen\NeuraX\neurax-dashboard, D:\Projects\Emergen\NeuraX\neurax-app

# or fresh clones inside WSL
.\connect-project.ps1 -Name NeuraX -Base staging -OdooProjectId 91 -Repo Emergen-Tech/neurax-backend, Emergen-Tech/neurax-app
```

| Parameter | Meaning |
|---|---|
| `-Name` | Paperclip project name |
| `-LocalPath` | Your existing git checkouts (Windows paths); several allowed |
| `-Repo` | GitHub `owner/repo` or git URL to clone into WSL instead; several allowed |
| `-Base` | Branch agents branch from and open PRs against (default: each repo's default branch) |
| `-OdooProjectId` | Odoo project id. Tickets tagged `agent-ready` there go to this Paperclip project, and the Timekeeper logs your time for these repos against it (`-OdooProject <name>` also works) |

What it does: creates the Paperclip project with the Manager as lead, attaches each repo as a workspace, and turns on isolated git worktrees: every issue gets its own folder and branch under `~/projects/<name>/.worktrees` in WSL. With `-LocalPath` the agents share your repo's history and branches (you see their branches locally) but never touch your working files. Re-running it updates without duplicating anything.

**Main tasks and sub-tasks.** Tag an Odoo main task `agent-ready`: it becomes a parent issue the Manager splits into sub-issues. Tagged Odoo sub-tasks nest under their main task's issue. When sub-tasks are missing in Odoo, the Manager has Ops (Hermes) propose them under the main task, with its milestone, assigned to you; you approve in Discord.

Then give the agents work in any of these ways:

| You want to | Do |
|---|---|
| Hand over an existing ticket | Tag the Odoo task `agent-ready` (bridge), or create an issue in the Paperclip project |
| Let the team plan it | Assign the issue to the **Manager**; it splits the work and routes it |
| Give one agent a specific job | Assign the issue to that agent directly |
| Steer work in progress | Comment on the issue; @-mention an agent to wake it |
| Answer an agent's question | Discord `answer EME-12 <reply>` (bridge) or reply on the issue |
| Review and merge | Agents open PRs; you review and merge on GitHub |
| Approve the day's work | Discord `approve 1,3`, `edit 2 hours=1.5 stage=Testing`, `reject 4 <reason>`, `pending` (bridge) |
| Change something in Odoo | Ask Hermes in Discord ("log 3h on task 28034 for yesterday", "create a ticket for X and log 2h"). It replies with a 📝 proposal; `approve N` writes it |
| Start a brand-new client project | Discord `new project: <name>` with the requirements (bridge), or a Paperclip issue titled `New project: <name>` assigned to the Estimator. It asks which category, then writes `<PROJECTS_ROOT>/<category>/<name>/` with the requirements and an estimation `.xlsx` |
| Watch agents work | Paperclip issue page (live transcript), agent page (runs, cost), http://127.0.0.1:4100 (router decisions) |

## Your daily routine (bridge)

| When (config.env) | What | Where |
|---|---|---|
| `STANDUP_SCHEDULE`, default 11:30 Mon-Sat | Standup text to copy: **Completed** (previous working day's timesheets), **Working on** (your tasks in active stages), **Blockers** (tasks in a blocked/on-hold stage), each with `#ticket` and project | #standup |
| `TIMESHEET_SCHEDULE`, default 18:30 Mon-Sat | The **Timekeeper** agent reads your commits across `PROJECTS_ROOT` for the day, matches them to Odoo tasks (creating sub-tasks under the right main task and milestone, assigned to you, when none exists), splits `DAILY_HOURS` across them, and posts one 📝 proposal | #approvals |
| `DIGEST_SCHEDULE`, default 18:45 Mon-Sat | Digest of the agents' own work, plus any open proposals | #approvals |
| Any time | Reply `approve N` / `reject N`; only then is Odoo written | #approvals |
| Every 5 min | **Disk guard**: below `DISK_MIN_FREE_GB` (4) free on C: it pauses all agents and alerts you, because WSL's disk file lives on C: and turns read-only when C: fills. Above `DISK_RESUME_FREE_GB` (6) it resumes them and restarts the tasks it interrupted | #agent-questions |

Personal projects (the Personal category) are never logged to Odoo. To backfill a missed day, assign an issue "Daily timesheets YYYY-MM-DD" to the Timekeeper, or ask Hermes in #approvals.

## Discord channels

```powershell
.\windows\discord-channels.ps1 -GuildId <your server id>
```

Creates an **Agent Ops** category with `#approvals`, `#agent-questions`, `#standup`, `#agent-activity` and `#new-projects` (reusing any that exist), saves their ids in `config.env`, points every Hermes job at the right one, and lets Hermes answer in the channels you type in without an @mention. The bot needs the **Manage Channels** permission (Server Settings, Roles, the bot's role). Without it, create the channels yourself and put their ids in `config.env` (`DISCORD_*_CHANNEL_ID`), then run `.\windows\hermes-bridge.ps1`.

## Hermes as an agent in Paperclip (optional)

Besides the bridge, Hermes can join the org as **Ops (Hermes)**, so the Manager can assign it Odoo lookups, Odoo change proposals and Discord announcements. Run it yourself (it generates a local API key and never prints it):

```powershell
.\windows\connect-hermes.ps1
```

1. The first run switches WSL to mirrored networking so Paperclip (in WSL) can reach Hermes on `127.0.0.1:8642`, and exits. Run `wsl --shutdown` (this restarts the agents and Docker Desktop), wait a minute, run it again.
2. The second run enables Hermes's API server on loopback only, restarts the gateway, and creates the agent reporting to the Manager.

Ops (Hermes) follows the same rule: it only proposes Odoo changes; you approve them in Discord.

## Skills and role standards (one source for every tool)

This repo is the single source of skills and role standards. The same files drive the Paperclip agents and Claude Code (or any tool that reads `.claude/skills`), so every role works the same way in every project, whoever or whatever does the work.

| What | Where | Installed to |
|---|---|---|
| General skills (ours + vendored) | `skills/` | Paperclip, Claude Code in WSL and on Windows (`~/.claude/skills`) |
| Role standards | `org/<dept>/*.md` + `org/_partials/`, `org/<dept>/_partials/` | Paperclip agent prompts, and `role-<key>` skills in Claude Code (generated, never edited by hand) |
| Department-only skills | `org/<dept>/skills/` | Same as general skills, for the departments in `DEPARTMENTS` |
| Project context | `project-skills/<name>/`, mapped in `project-skills/projects.json` | Paperclip (all agents via `EXTRA_SKILLS`) and that project's folder `.claude/skills` |

`wsl/60-sync-skills.sh` does the install (run by `40-org.sh`, or on its own after editing a skill; `--dry-run` to preview). It only replaces or removes skills it installed (tracked in `.agent-stack-managed`), never your other skills.

| Our skills | Purpose |
|---|---|
| `no-slop` | No invented APIs or results, no em dashes, no AI filler in code or docs |
| `delivery-gate` | Task and milestone validation checklists |
| `qa-evidence` | Screenshots/recordings proving an Odoo ticket is fixed, approved before they reach Odoo |
| `project-estimation` | Requirements to project folder and estimation workbook |
| `daily-timesheets` | End-of-day timesheet proposal |
| `test-integrity` | Tests written from the requirement and proven to fail when the behaviour breaks (red before green, mutation testing on changed code); QA reviews them independently |
| `tool-vetting` | Safety checklist and board approval before installing any package, tool, script, extension or skill |
| `odoo-tickets` | How tickets are written (titles, descriptions a non-engineer can follow, structure) and how a messy Odoo project is cleaned up through approved proposals |
| your engineering standards (`ENGINEERING_SKILL`) | Stack standards and checklists every engineer follows. `emergen-engineering` is an example |

Third-party skills, their sources and licenses: `skills/THIRD_PARTY.md`. Proprietary or unlicensed ones stay out of git (`skills/.gitignore`) and are restored on a new machine by `windows/collect-skills.ps1`.

To add a project: write `project-skills/<name>-context/SKILL.md`, map it in `projects.json`, add it to `EXTRA_SKILLS`, run `40-org.sh`.

Skills in `skills/` can use `{{COMPANY_NAME}}`, `{{STACK}}`, `{{ENGINEERING_SKILL}}`, `{{PROJECTS_ROOT}}`, `{{PROJECTS_ROOT_WINDOWS}}` and `{{PROJECT_CATEGORIES}}`; they are filled from `config.env` when installed.

## Changing the org

| Change | Edit | Apply |
|---|---|---|
| Models, budgets, skills per agent, add or remove agents | `org/<dept>/department.json` | `.\install.ps1 -OnlyOrg` |
| An agent's instructions | `org/<dept>/<key>.md` (shared parts in `org/_partials/` and `org/<dept>/_partials/`) | `.\install.ps1 -OnlyOrg` |
| Add or switch on a department | `org/<dept>/`, `DEPARTMENTS` in config.env ([docs/departments.md](docs/departments.md)) | `.\install.ps1 -OnlyOrg` |
| Your skills | `skills/<name>/SKILL.md` | `.\install.ps1 -OnlyOrg` |
| Third-party skills | update them in Claude, then `.\windows\collect-skills.ps1` | `.\install.ps1 -OnlyOrg` |
| Bridge logic | `hermes/` | `.\windows\hermes-bridge.ps1` |

Edits made in the Paperclip UI to agent instructions or skills are overwritten by the next `-OnlyOrg` run; make lasting changes here.

## Repository layout

```
CLAUDE.md                   setup playbook Claude follows on a new laptop
install.ps1                 entry point (Windows)
connect-project.ps1         attach repos to a Paperclip project (+ optional Odoo link)
config.example.env          settings template -> config.env (git-ignored)
examples/team.env           company values filled in, personal ones blank (teammates start here)
examples/emergen.env        the owner's complete configuration
org/company.json            skills every agent gets, router settings
org/<dept>/department.json  a department's agents: role, model, router, budget, skills, reporting line
org/<dept>/<key>.md         instruction templates; {{common}} {{summary}} from org/_partials/, {{eng-rules}} etc. from org/<dept>/_partials/
skills/                     shared skills + THIRD_PARTY.md
project-skills/             one context skill per project + projects.json (project folder mapping)
wsl/10-base.sh              (root) apt packages, systemd, linger
wsl/20-tools.sh             Node 24, Claude Code, Paperclip, jev-router, Playwright Chromium
wsl/25-browser-deps.sh      (root) Chromium system libraries
wsl/30-services.sh          logins check, Paperclip service + PATH drop-in, jev-router
wsl/40-org.sh               company, skills, agents, instructions, skill assignment
wsl/50-connect-project.sh   clone repos, Paperclip project, workspaces, worktree policy
wsl/60-sync-skills.sh       skills + role-<key> skills into Claude Code and project folders
wsl/watchdog/, wsl/hooks/   stalled-task watchdog, stop hook for agents
windows/wsl-host.ps1        .wslconfig + WSL keepalive task
windows/hermes-bridge.ps1   bridge scripts, Hermes skill, config, Odoo tags, cron jobs, gateway watchdog
windows/collect-skills.ps1  gathers third-party skills into SKILLS_SOURCE
windows/connect-hermes.ps1  optional: Hermes as the "Ops (Hermes)" Paperclip agent
windows/discord-channels.ps1  Agent Ops category + channels, ids into config.env
hermes/agent_ops.py         Odoo <-> Paperclip bridge (intake, digest, standup, propose, approve/edit/reject, odoo lookups, answer, newproject)
hermes/agent_job.py         cron entry point, installed once per job as agent_<command>.py
docs/operations.md          health checks, troubleshooting, backups
docs/team-setup.md          shared vs personal, handing the setup to Claude, keeping in sync
docs/discord-messages.md    how every Discord message is written (all projects, bridge, Hermes and agents)
docs/departments.md         turning on, adding and changing departments
```

Not in git: `config.env`, WSL `~/.agent-stack/` (Paperclip ids), Paperclip's database in `~/.paperclip`, jev-router keys in `~/.config/jev-router/env`, Hermes secrets in `%LOCALAPPDATA%\hermes\.env`.

See [docs/operations.md](docs/operations.md) for health checks and troubleshooting.
