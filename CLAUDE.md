# Setting up the AI factory (instructions for Claude)

This repo installs the company's AI factory on one laptop: a Paperclip org of Claude Code agents grouped in departments (`org/`), the shared skills and role standards (`skills/`, `org/<dept>/*.md`), and optionally the Hermes bridge to Odoo and Discord. Every teammate runs their own copy on their own laptop; the repo keeps everyone's agents, standards and skills identical.

When someone opens Claude Code in this folder and asks to set it up, install it, update it or fix it, follow this file.

## Ground rules

- **Personal values and secrets never go into git.** `config.env` is git-ignored; keep it that way. Do not paste API keys, passwords, tokens or sign-in codes into files or chat yourself: the person types them into the prompts or files you point them to (`claude` login, `gh auth login`, the router key prompt, Hermes's `.env`).
- **Ask before anything disruptive**: `wsl --shutdown`, restarting services, deleting files, changing Windows or macOS settings. Explain what it interrupts.
- **Nothing is written to Odoo without the person's approval in Discord.** Do not call Odoo write tools during setup.
- Commit to this repo only when the person asks, with their own git identity (never set `git config user.*`).

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

The installers are idempotent. Exit code 3 means a manual step is needed; it prints the list (GitHub login, Claude login, router key). Tell the person exactly what to type and where, wait for them, then run the installer again. Do not try to do the logins yourself.

## Step 4: connect projects

For each project the person works on: `connect-project.ps1` (Windows) or `wsl/50-connect-project.sh` (see the README "Working on a project"). If a project has a context skill in `project-skills/`, map it in `project-skills/projects.json` and list it in `EXTRA_SKILLS`.

## Step 5: verify

- http://localhost:3100 shows the company with the agents of every department in `DEPARTMENTS`.
- `~/.claude/skills` contains the repo's skills and the `role-<key>` skills (`wsl/60-sync-skills.sh --dry-run` lists them).
- With the bridge: Hermes posts in the person's Discord channel; `pending` in the approvals channel answers.

Report what was installed, what was skipped and any manual step still open.

## Updating

`git pull`, then `.\install.ps1 -OnlyOrg` (Windows) or `./mac/install.sh --only-org` (macOS) to re-apply agents, instructions and skills. Edits made in the Paperclip UI are overwritten; lasting changes go into this repo (see [docs/departments.md](docs/departments.md) for agents and departments).

## When something is wrong

[docs/operations.md](docs/operations.md) has health checks and the known problems (stalled tasks, disk guard, WSL memory, workspace errors) with their fixes.
