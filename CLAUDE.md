# Setting up the AI factory (instructions for Claude)

This repo installs the company's AI factory for Claude Code on one laptop: the global rules (`org/_global/CLAUDE.md`), five subagents (`org/_agents/`), the shared skills and role standards (`skills/`, `org/<dept>/*.md`), and optionally the Hermes bridge to Odoo and Discord. The contract is [docs/ai-factory.md](docs/ai-factory.md). Every teammate runs their own copy on their own laptop; the repo keeps everyone's agents, standards and skills identical.

When someone opens Claude Code in this folder and asks to set it up, install it, update it or fix it, follow this file.

## Ground rules

- **Personal values and secrets never go into git.** `config.env` is git-ignored; keep it that way. Do not paste API keys, passwords, tokens or sign-in codes into files or chat yourself: the person types them into the prompts or files you point them to (`claude` login, `gh auth login`, Hermes's `.env`).
- **Ask before anything disruptive**: `wsl --shutdown`, restarting services, deleting files, changing Windows or macOS settings. Explain what it interrupts.
- **Nothing is written to Odoo without the person's approval in Discord.** Do not call Odoo write tools during setup.
- Commit to this repo only when the person asks, with their own git identity (never set `git config user.*`).

When the owner gives a new standing instruction ("from now on...", "always...", "never..."), add it to the file that teaches it (usually `org/_global/CLAUDE.md`, a role template or a skill) and to [docs/owner-rules.md](docs/owner-rules.md) in the same commit.

## Step 1: which machine

| `uname` / OS | Path |
|---|---|
| Windows 11 | Windows + WSL2. Follow "Windows" below and the README's Setup section |
| macOS | `mac/install.sh` and [docs/setup-mac.md](docs/setup-mac.md). macOS support is new and not yet proven on a real Mac; read the doc's known gaps first and tell the person |
| Linux | Run the `wsl/*.sh` scripts directly (they are plain Linux scripts); skip the Windows parts |

Check the requirements in the README (disk space, Claude subscription, GitHub account) before installing.

## Step 2: config.env

Start from the company template, then fill in the person's own values:

```bash
cp examples/team.env config.env
```

Ask the person for, and fill in (see [docs/team-setup.md](docs/team-setup.md) for what each one is):

| Key | Ask |
|---|---|
| `WSL_USER` (Windows) | their Linux user name in WSL |
| `PROJECTS_ROOT`, `PROJECT_CATEGORIES` | where their project folders live (Windows: `/mnt/d/Projects` style path), and the category folders under it |
| `GIT_AUTHOR` | the name or email on their commits |
| `TIMEZONE` | their time zone (IANA, e.g. `Asia/Karachi`) |
| `DEPARTMENTS` | which departments they run (default `engineering,operations`) |
| Bridge: `TIMESHEET_EMPLOYEE`, `STANDUP_NAME`, `DISCORD_*` | only if they use Hermes + Odoo + Discord: their exact Odoo employee name, the name on their standup, their Discord channel ids |

Leave company-wide values (company name, stack, schedules, skills) as the template has them unless the person says otherwise.

## Step 3: install

- Windows: `.\windows\collect-skills.ps1` (restores licensed skills that are not in git), then `.\install.ps1` (add `-SkipHermes` without the bridge).
- macOS: `./mac/install.sh`.

The installers are idempotent. Exit code 3 means a manual step is needed; it prints the list (GitHub login, Claude login). Tell the person exactly what to type and where, wait for them, then run the installer again. Do not try to do the logins yourself.

## Step 4: project context

Projects need no connecting: Claude Code works in the project folder the owner opens. If a project has a context skill in `project-skills/`, map it in `project-skills/projects.json`; the installer copies it into that project's `.claude/skills`.

## Step 5: verify

- `~/.claude/CLAUDE.md` exists (and `~/.claude-personal/CLAUDE.md` when that config dir exists).
- `~/.claude/agents` holds `engineer.md`, `code-reviewer.md`, `qa.md`, `docs.md`, `security-reviewer.md`.
- `~/.claude/skills` contains the repo's skills and the `role-<key>` skills (`wsl/60-sync-skills.sh --dry-run` lists them).
- With the bridge: Hermes posts in the person's Discord channel; `pending` in the approvals channel answers.

Report what was installed, what was skipped and any manual step still open.

## Updating

`git pull`, then `.\install.ps1 -OnlyOrg` (Windows) or `./mac/install.sh --only-org` (macOS) to re-render the rules, subagents and skills. Hand edits to the installed copies are overwritten; lasting changes go into this repo.

## When something is wrong

[docs/operations.md](docs/operations.md) has health checks for WSL and the Hermes bridge (its orchestrator sections are history).
