# Team setup

Every teammate runs their own AI factory on their own laptop. The repo makes them identical: same departments, agents, role standards and skills, so work done by anyone's agents (or by anyone in Claude Code directly) follows the same rules.

## Hand it to Claude

On a new laptop (Windows or Mac):

1. Install Claude Code and sign in.
2. `git clone https://github.com/SyedMuhammedAbbas/emergen-agent-stack.git agent-stack` (private repo: you need access).
3. Open Claude Code in that folder and say: **"Set up the AI factory from this repo."**

Claude follows [CLAUDE.md](../CLAUDE.md): it detects the OS, builds your `config.env` from `examples/team.env` by asking you for your personal values, runs the installer, and stops for the steps only you can do (logins and keys).

## Shared vs personal

| Shared (in the repo, same for everyone) | Personal (on your laptop only) |
|---|---|
| Departments and agents: `org/` | `config.env` (from `examples/team.env`) |
| Role standards: `org/<dept>/*.md`, `org/_partials/` | Claude login, GitHub login (`gh auth login`) |
| Skills: `skills/`, `org/<dept>/skills/`, `project-skills/` | Router key (`~/.config/jev-router/env`) |
| Bridge code: `hermes/` | Hermes `.env`: Odoo URL, database, your Odoo login and API key, Discord bot token |
| Installers: `install.ps1`, `windows/`, `wsl/`, `mac/` | Paperclip data (`~/.paperclip`), agent ids (`~/.agent-stack`) |
| Company values: top half of `examples/team.env` | Your project folders, Discord channel ids, Odoo employee name |

Licensed skills that cannot be in git (listed in `skills/THIRD_PARTY.md`) are restored from your own Claude install by `windows/collect-skills.ps1`; anything missing is skipped.

## Personal values in config.env

| Key | What to put |
|---|---|
| `WSL_USER` | Windows only: your Linux user in WSL (`wsl -d Ubuntu-24.04 whoami`) |
| `PROJECTS_ROOT` | Folder holding your projects, as the agents see it: `/mnt/d/Projects` on Windows+WSL, `/Users/<you>/Projects` on macOS |
| `PROJECT_CATEGORIES` | Category folders under it (`Emergen,Personal`). Personal work is never logged to Odoo |
| `GIT_AUTHOR` | The name or email on your commits |
| `TIMEZONE` | IANA zone, e.g. `Asia/Karachi` |
| `TIMESHEET_EMPLOYEE` | Bridge only: your exact Odoo employee name |
| `STANDUP_NAME` | Bridge only: your name on the standup post |
| `DISCORD_*_CHANNEL_ID` | Bridge only: your own channels (or run `windows/discord-channels.ps1`) |

## Keeping in sync

When the repo changes (new rule, new skill, new agent):

```
git pull
.\install.ps1 -OnlyOrg        # Windows
./mac/install.sh --only-org   # macOS
```

Lasting changes to agents, standards or skills are made in the repo through a pull request, so everyone gets them. Edits in the Paperclip UI are overwritten on the next sync.

## Your own Odoo and Discord

The bridge is optional. With it, each person has their own Hermes, Discord bot and channels, and approves their own Odoo changes; tickets in a shared Odoo project stay consistent because every agent follows the same `odoo-tickets` standard.
