# Emergen agent stack

An AI engineering team that runs on one Windows machine and starts on its own at logon:

- **Paperclip** runs 10 Claude Code agents as an org: Manager, CTO, Frontend, Backend, DevOps and SecOps Engineers, QA, UX Reviewer, Docs, and an Estimator.
- **jev-router** picks Haiku, Sonnet or Opus per turn for the three engineers whose task difficulty varies.
- **Hermes** (Discord bot, already connected to Odoo) turns Odoo tickets into agent tasks, relays agent questions to Discord, and posts a daily digest you approve before anything is written back to Odoo.

## How work flows

```
Odoo task tagged agent-ready ──(Hermes, every 15 min)──> Paperclip issue [ODOO-123] -> Manager
Discord "new project: X" + requirements ──(Hermes)──> Paperclip issue -> Estimator
                                                         │
Manager routes: Frontend / Backend / DevOps / SecOps  (risky work: CTO brief first)
                                                         │
Engineer: branch + PR + self-check (delivery gate) -> in_review
                                                         │
QA (every task) + UX Reviewer (user-facing) + SecOps (risky) -> PASS / FAIL
                                                         │
Every agent ends a run with a "Run summary" comment (Odoo ID, PR, verdict, hours, stage)
                                                         │
18:45 daily ──(Hermes)──> Discord digest ──> you: approve 1,3 / edit 2 hours=1.5 / reject 4
                                                         │
approve ──> Odoo timesheet + stage + chatter note          reject ──> back to Manager
```

Questions an agent can't answer alone (for example "is this an Emergen or Personal project?") are posted as `**Question for board:**`, relayed to Discord, and answered with `answer EME-12 <reply>`.

Milestones are never sent to a client without passing Gate 2 of `skills/emergen-delivery-gate` and a board approval in Paperclip.

## What runs where

| Piece | Where | Started by |
|---|---|---|
| Paperclip (http://localhost:3100) | WSL, systemd user service `paperclipai.service` | WSL boot (linger) |
| jev-router (:4000, live view http://127.0.0.1:4100) | WSL, systemd user service `jev-router.service` | WSL boot |
| Agent workers (Claude Code) | WSL, spawned by Paperclip | Assignments, mentions, Manager heartbeat (30 min) |
| WSL itself | Windows task `WSL-Agents-Keepalive` | Windows logon |
| Hermes gateway (Discord + cron) | Windows task `Hermes_Gateway` (created by Hermes) | Windows logon |
| Gateway watchdog | Windows task `Hermes-Gateway-Watchdog` | Every 15 min |
| Odoo intake + question relay | Hermes cron `agent-intake` | Every 15 min |
| Daily digest | Hermes cron `agent-digest` | 18:45 local, Mon-Sat |

## Requirements

- Windows 11 with WSL2 and a distro installed (`wsl --install -d Ubuntu-24.04` in an admin PowerShell, then create the Linux user).
- **At least 5 GB free on C:** (20 GB recommended). The WSL disk lives on C:; if C: fills up, Linux switches its disk to read-only.
- A Claude subscription (Claude Code login) for the agents.
- A Jev key for jev-router: a TypeSafe key (console.typesafe.ai) or an OpenRouter key with credits.
- GitHub account for the agents' branches and PRs.
- For the Odoo/Discord part: Hermes installed on Windows with its Discord gateway set up (`hermes gateway setup`, `hermes gateway install`) and `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` in `%LOCALAPPDATA%\hermes\.env`.

## Setup

Run everything from a normal (non-admin) PowerShell in the repo folder.

**1. Configure**

```powershell
git clone https://github.com/SyedMuhammedAbbas/emergen-agent-stack.git D:\Projects\Emergen\agent-stack
cd D:\Projects\Emergen\agent-stack
Copy-Item config.example.env config.env
notepad config.env
```

Fill in at least `WSL_USER`, `SKILLS_SOURCE`, `DISCORD_CHANNEL_ID` (right-click the channel in Discord with Developer Mode on, "Copy Channel ID") and `TIMESHEET_EMPLOYEE` (exact Odoo employee name).

**2. Collect the third-party skills**

```powershell
.\windows\collect-skills.ps1
```

Copies the skills listed in `skills/THIRD_PARTY.md` from your Claude installs into `SKILLS_SOURCE`. Install any it reports missing, then run it again (or continue without them).

**3. Install**

```powershell
.\install.ps1
```

The installer is idempotent. It stops with exit code 3 and a list when something needs you. The first run will ask for these, in an Ubuntu terminal (`wsl -d Ubuntu-24.04`):

```bash
source ~/.bashrc
gh auth login
claude                  # log in with your Claude account, then /exit
jev-router setup --models claude --service systemd --no-claude-settings
```

For `jev-router setup`, paste a TypeSafe key, or leave it empty and paste an OpenRouter key.

Then run `.\install.ps1` again. It finishes with:

- Paperclip running as a service, company and 10 agents created with their instructions and skills,
- Windows tasks registered,
- the Hermes bridge installed, Odoo tags `agent-ready` / `agent-synced` created, and both cron jobs scheduled.

If the installer changed `%UserProfile%\.wslconfig`, run `wsl --shutdown` once (this also restarts Docker Desktop) so the memory and idle settings apply.

**4. Check**

Open http://localhost:3100: the org chart should show all 10 agents. Tag a small Odoo task `agent-ready`; within 15 minutes it appears in Paperclip and a notice is posted in Discord.

Use `.\install.ps1 -SkipHermes` to set up only the agents, without Odoo/Discord.

## Everyday use

| You want to | Do |
|---|---|
| Give the agents an Odoo ticket | Add the `agent-ready` tag to the task |
| Start a new client project | In the Discord channel: `new project: <name>` followed by the requirements (text or files). The Estimator asks Emergen or Personal, then writes `D:\Projects\<Emergen or Personal>\<name>\` with the requirements and an estimation `.xlsx` |
| Give an agent a direct task | Paperclip: create an issue and assign it (or assign to Manager and let it route) |
| Add instructions mid-task | Comment on the issue; @-mention an agent to wake it |
| Answer an agent's question | Discord: `answer EME-12 <reply>`, or reply on the issue |
| Approve the day's work | Discord: `approve 1,3`, `edit 2 hours=1.5 stage=Testing`, `reject 4 <reason>`, `pending` |
| Watch agents work | Paperclip issue page (live run transcript) and agent page (run history, cost); router decisions at http://127.0.0.1:4100 |

## Changing the org

| Change | Edit | Apply |
|---|---|---|
| Models, budgets, skills per agent, add/remove agents | `agents/org.json` | `.\install.ps1 -OnlyOrg` |
| An agent's instructions | `agents/<key>.md` (shared parts in `agents/_partials/`) | `.\install.ps1 -OnlyOrg` |
| Emergen skills | `skills/<name>/SKILL.md` | `.\install.ps1 -OnlyOrg` |
| Third-party skills | update them in Claude, then `.\windows\collect-skills.ps1` | `.\install.ps1 -OnlyOrg` |
| Hermes bridge / digest logic | `hermes/` | `.\windows\hermes-bridge.ps1` |
| Odoo project -> Paperclip project mapping | `project_map` in `%LOCALAPPDATA%\hermes\scripts\agent_ops.config.json` | picked up on the next intake |

Edits made directly in the Paperclip UI to agent instructions or skills are overwritten by the next `-OnlyOrg` run. Make lasting changes here.

## Repository layout

```
install.ps1                 entry point (Windows)
config.example.env          settings template -> config.env (git-ignored)
agents/org.json             agent roster: role, model, router, budget, skills, reporting line
agents/<key>.md             instruction templates; {{common}} {{summary}} {{eng-rules}} come from agents/_partials/
skills/                     Emergen skills + THIRD_PARTY.md
wsl/10-base.sh              (root) apt packages, systemd, linger
wsl/20-tools.sh             Node 24, Claude Code, Paperclip, jev-router, Playwright Chromium
wsl/25-browser-deps.sh      (root) Chromium system libraries
wsl/30-services.sh          logins check, Paperclip service + PATH drop-in, jev-router
wsl/40-org.sh               company, skills import, agents, instructions, skill assignment
windows/wsl-host.ps1        .wslconfig + WSL keepalive task
windows/hermes-bridge.ps1   Hermes scripts, skill, config, Odoo tags, cron jobs, gateway watchdog
windows/collect-skills.ps1  gathers third-party skills into SKILLS_SOURCE
hermes/agent_ops.py         Odoo <-> Paperclip bridge (intake, digest, approve/edit/reject, answer, newproject)
docs/operations.md          health checks, troubleshooting, backups
```

State that is **not** in git: `config.env`, `~/.emergen-agent-stack/ids.json` in WSL (Paperclip ids), Paperclip's database in `~/.paperclip`, jev-router keys in `~/.config/jev-router/env`, Hermes secrets in `%LOCALAPPDATA%\hermes\.env`.

See [docs/operations.md](docs/operations.md) for health checks and troubleshooting.
