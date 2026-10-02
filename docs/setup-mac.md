# Setup on macOS

> **Not yet tested on a Mac.** The macOS scripts were written and syntax-checked on Windows; nobody has run them on
> macOS yet. Expect rough edges, and check the [unverified points](#unverified-points) first if something fails.

On macOS the agents run natively: no Linux VM. Paperclip, the watchdog and jev-router run as launchd user agents, and
the same bash scripts that set up WSL on Windows do the work. `wsl/` is the shared Linux/macOS layer (the folder name
is historical); macOS-only branches in it are guarded with `[ "$(uname)" = Darwin ]`, and `mac/` holds the macOS entry
points and launchd helpers.

## Prerequisites

- macOS 13 (Ventura) or newer, Apple silicon or Intel.
- [Homebrew](https://brew.sh). The installer never installs it for you; if it is missing it prints this command:

  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```

- At least 20 GB free on the startup disk (worktrees, node_modules, Paperclip's database).
- A Claude subscription for Claude Code, a Jev key for jev-router (TypeSafe, or OpenRouter with credits), and a GitHub
  account the agents can open PRs with (same as on Windows, see the README).
- For the bridge only: [Hermes](https://github.com/NousResearch/hermes-agent) installed natively (default home
  `~/.hermes`) with its Discord gateway set up, and `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` in
  `~/.hermes/.env`.

macOS ships bash 3.2; the shared scripts need bash 4+. The installer installs Homebrew's bash and runs them with it.
If you run a script from `wsl/` by hand with `/bin/bash`, it re-runs itself under Homebrew bash.

## 1. Configure

```bash
git clone https://github.com/SyedMuhammedAbbas/emergen-agent-stack.git agent-stack
cd agent-stack
cp config.example.env config.env
open -e config.env
```

Same keys as on Windows (see the README), with these differences:

| Key | On macOS |
|---|---|
| `WSL_DISTRO`, `WSL_USER`, `WSL_MEMORY` | Ignored. Leave them as they are. |
| `PROJECTS_ROOT` | An absolute macOS path, e.g. `/Users/<you>/Projects`. Values are not shell-expanded, so no `~`. The installer refuses a `/mnt/...` path. |
| `SKILLS_SOURCE` | Empty, or an absolute macOS path. |
| `HERMES_HOME` | Optional; default `~/.hermes`. |
| `DISK_MIN_FREE_GB`, `DISK_RESUME_FREE_GB` | Checked against the startup volume (`/`) instead of `C:`. |
| `PAPERCLIP_RUN_ARGS` | macOS only, optional. See [Paperclip service](#paperclip-service). |

Third-party skills: `windows/collect-skills.ps1` has no macOS version yet. Copy the skills listed in
`skills/THIRD_PARTY.md` into `skills/` yourself (from `~/.claude/skills` or a teammate's checkout), or continue
without them; agents list missing skills in the `40-org.sh` output.

## 2. Install

```bash
./mac/install.sh                # add --skip-hermes if you don't use the Odoo/Discord bridge
```

It is idempotent and does, in order:

1. Checks for Homebrew and `config.env`, and that `PROJECTS_ROOT` is a macOS path.
2. `brew install` git, jq, gh, python and bash (only what is missing; never upgrades), and `openpyxl` for the
   Estimator's `.xlsx` (`pip --user`).
3. `wsl/20-tools.sh`: nvm and Node 24, Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`, into
   `~/.local/bin`), `paperclipai` (npm, with the `@embedded-postgres/darwin-arm64` or `darwin-x64` install script
   allowed), jev-router, Playwright Chromium.
4. `wsl/30-services.sh`: checks the logins, onboards Paperclip and runs it as a launchd user agent.
5. `wsl/40-org.sh`: company, skills, agents, instructions, routines, the Claude Code Stop hook, the staleness watchdog
   (launchd), and `wsl/60-sync-skills.sh` (skills into `~/.claude/skills` and project folders).
6. `mac/hermes-bridge.sh`, if Hermes is found at `HERMES_HOME`.

### Manual steps

When something needs you, it stops with exit code 3 and a list. On the first run that is, in a Terminal:

```bash
gh auth login
claude                  # log in with your Claude account, then /exit
jev-router setup --models claude --no-claude-settings
```

For `jev-router setup`, paste a TypeSafe key, or leave it empty and paste an OpenRouter key. On macOS setup installs
its own launchd agent (`io.github.dirien.jev-router`). Then run `./mac/install.sh` again.

### After `git pull`

```bash
./mac/install.sh --only-org
```

Skips tools and services and only re-runs `wsl/40-org.sh`: agents, instructions and skills from `org/` and `skills/`.
It is the macOS form of `.\install.ps1 -OnlyOrg`.

## 3. Check

Open http://localhost:3100: the org chart shows the agents. With the bridge, tag a small Odoo task `agent-ready`;
within 15 minutes it appears in Paperclip and a notice is posted in Discord.

## Working on a project

```bash
# your existing checkouts, linked to Odoo project 91
./mac/connect-project.sh --name NeuraX --base staging --odoo-project-id 91 \
    --path ~/Projects/Emergen/NeuraX/neurax-backend --path ~/Projects/Emergen/NeuraX/neurax-app

# or fresh clones into ~/projects/<name>/
./mac/connect-project.sh --name NeuraX --base staging --repo Emergen-Tech/neurax-backend
```

Same behaviour as `connect-project.ps1` (see the README): it runs `wsl/50-connect-project.sh` and, with
`--odoo-project-id` or `--odoo-project <name>`, adds the project to the bridge's `project_map`. Agents work in git
worktrees under `~/projects/<name>/.worktrees`. On macOS the Windows/WSL git settings (`core.fileMode false`,
`core.checkStat minimal`, ...) are not applied to your checkouts.

## Hermes bridge

```bash
./mac/hermes-bridge.sh
```

Run by the installer when Hermes is installed; run it yourself after installing Hermes later, or after changing the
bridge settings in `config.env`. It mirrors `windows/hermes-bridge.ps1`:

1. Copies `hermes/agent_ops.py` and one `agent_<command>.py` cron entry point per job into `~/.hermes/scripts`.
2. Installs the `agent-ops` skill into `~/.hermes/skills/productivity/agent-ops`, with the placeholders filled and the
   Windows paths in the template rewritten to POSIX ones (`venv/bin/python`).
3. Writes `~/.hermes/scripts/agent_ops.config.json` from `~/.agent-stack/ids.json` and `config.env`, keeping
   `project_map`, then runs `agent_ops.py init`.
4. Disables the write tools of Hermes's `odoo` MCP server, so Hermes can only read Odoo.
5. Creates or updates the cron jobs `agent-intake`, `agent-questions`, `agent-proposals`, `agent-digest`,
   `agent-standup`, `agent-diskguard`.
6. Lets Hermes answer without @mention, with the agent-ops skill, in your interactive channels.
7. Checks that a launchd agent runs the Hermes gateway. On Windows a separate scheduled task restarts the gateway;
   on macOS launchd's `KeepAlive` does that, so run `hermes gateway install` if the check warns.

Restart the gateway after the first run so the config changes apply.

Not ported yet: `windows/discord-channels.ps1` and `windows/connect-hermes.ps1`. For Discord channels, create them
yourself and put their ids in `config.env` (`DISCORD_*_CHANNEL_ID`), then run `./mac/hermes-bridge.sh`; or run the
helper by hand:

```bash
cp hermes/discord_setup.py ~/.hermes/scripts/
~/.hermes/hermes-agent/venv/bin/python ~/.hermes/scripts/discord_setup.py <guild id>   # prints KEY=value lines for config.env
```

## What runs where

| Piece | Where | Started by |
|---|---|---|
| Paperclip (http://localhost:3100) | launchd agent `io.agent-stack.paperclip`, or the agent `paperclipai onboard --install-service` installed (the label is saved in `~/.agent-stack/paperclip.launchd-label`) | login (`RunAtLoad`), restarted on exit (`KeepAlive`) |
| jev-router (:4000, live view http://127.0.0.1:4100) | launchd agent `io.github.dirien.jev-router` (written by `jev-router setup`) | login |
| Staleness watchdog | launchd agent `io.agent-stack.watchdog`, runs `~/.agent-stack/watchdog.sh` every `WATCHDOG_INTERVAL_MIN` (10) min | launchd |
| Agent workers (Claude Code) | spawned by Paperclip, `~/.local/bin/claude` | assignments, @-mentions, Manager heartbeat |
| Project repos | your checkouts, or `~/projects/<project>/<repo>` | `mac/connect-project.sh` |
| Bridge (optional) | Hermes cron jobs, Hermes gateway's own launchd agent | Hermes gateway |

Log files:

| Log | Path |
|---|---|
| Paperclip (our launchd agent) | `~/Library/Logs/agent-stack/paperclip.log` |
| Paperclip first onboarding | `~/Library/Logs/agent-stack/paperclip-onboard.log` |
| Watchdog | `~/.agent-stack/watchdog.log` (and `~/Library/Logs/agent-stack/watchdog.err.log`) |
| jev-router | `~/.local/state/jev-router/router.log`, `~/Library/Logs/jev-router/router.err.log` |
| Hermes bridge state | `~/.hermes/state/agent_ops/` |

## Status and logs

```bash
launchctl print gui/$(id -u)/io.agent-stack.paperclip | grep -E 'state|pid|last exit'
launchctl print gui/$(id -u)/io.agent-stack.watchdog  | grep -E 'state|last exit|run interval'
launchctl print gui/$(id -u)/io.github.dirien.jev-router | grep -E 'state|pid'
curl -s http://127.0.0.1:3100/api/health
paperclipai doctor
jev-router doctor
tail -f ~/Library/Logs/agent-stack/paperclip.log
~/.agent-stack/watchdog.sh --dry-run
tail -20 ~/.agent-stack/watchdog.log

# restart Paperclip
launchctl kickstart -k gui/$(id -u)/$(cat ~/.agent-stack/paperclip.launchd-label)

# bridge
hermes gateway status
hermes cron list
cd ~/.hermes/scripts && ../hermes-agent/venv/bin/python agent_ops.py pending
```

Backups and upgrades: as in [operations.md](operations.md) (`paperclipai db:backup`, `paperclipai update`,
`claude update`). After `npm install -g @ediri/jev-router@latest`, restart it with
`launchctl kickstart -k gui/$(id -u)/io.github.dirien.jev-router`. After a Node upgrade (`nvm install`), run
`./mac/install.sh` again so the launchd agents get the new Node path.

## Uninstall

```bash
# services
for l in io.agent-stack.paperclip io.agent-stack.watchdog; do
  launchctl bootout gui/$(id -u)/$l 2>/dev/null; rm -f ~/Library/LaunchAgents/$l.plist
done
# if Paperclip installed its own agent instead, its label is in ~/.agent-stack/paperclip.launchd-label
jev-router uninstall

# skills this repo installed into Claude Code (others are left alone), and the Stop hook
while read -r s; do [ -n "$s" ] && rm -rf ~/.claude/skills/"$s"; done < ~/.claude/skills/.agent-stack-managed
rm -f ~/.claude/skills/.agent-stack-managed ~/.claude/hooks/wait-for-background.sh
jq 'del(.hooks.Stop)' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json

# CLIs
npm uninstall -g paperclipai @ediri/jev-router

# data: this deletes Paperclip's database, agents and run history, and the ids the scripts use
rm -rf ~/.paperclip ~/.agent-stack ~/Library/Logs/agent-stack
```

Bridge: remove the `agent-*` jobs with Hermes's cron commands (`hermes cron list`), and
`~/.hermes/scripts/agent_*.py`, `~/.hermes/scripts/agent_ops.config.json`,
`~/.hermes/skills/productivity/agent-ops`. Homebrew packages, nvm and Claude Code are left installed.

## Paperclip service

On Linux, `paperclipai onboard --yes --install-service` installs a systemd user service. It is not known yet whether
it supports launchd. `mac/launchd.sh` handles both cases:

- It runs onboarding in the background. If a launchd agent mentioning Paperclip appears in `~/Library/LaunchAgents`,
  that one is used, and its `PATH` is set (the macOS form of the Linux `path.conf` drop-in).
- Otherwise it writes `~/Library/LaunchAgents/io.agent-stack.paperclip.plist`, which runs
  `<path to paperclipai> run` in `$HOME`, with `PATH=~/.local/bin:<nvm node>:<brew>/bin:<brew>/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  `RunAtLoad` and `KeepAlive`. If onboarding kept a server running in the foreground, it is stopped first so that
  launchd owns Paperclip. If `run` is not the right command, set `PAPERCLIP_RUN_ARGS` in `config.env`, delete the
  plist, and re-run `./mac/install.sh`.

The Linux git-scan timeout drop-in is not needed: it exists for repos read over the WSL file bridge.

## Unverified points

Check these on the first real Mac install:

1. Whether `paperclipai onboard --install-service` supports launchd, and whether `onboard --yes` without a service
   keeps the server running in the foreground.
2. `paperclipai run` as the foreground server command for our launchd agent.
3. That the Stop hook finds the `claude` process with `ps -o comm=` (or its first argument).
4. That `hermes gateway install` writes a launchd agent with `KeepAlive`, and the platform name Hermes expects in a
   skill's `platforms:` front matter (`macos` is assumed).
5. That Claude Code started by launchd can read its login from the macOS Keychain (it runs in your GUI session, so it
   should).
