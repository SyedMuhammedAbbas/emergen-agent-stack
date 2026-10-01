# Operations

## Health checks

In Ubuntu (`wsl -d Ubuntu-24.04`):

```bash
paperclipai service status          # "active": true, health ok
paperclipai doctor
jev-router doctor                   # "Ready." at the end; OpenAI/Ollama warnings are expected for Claude-only
systemctl --user status paperclipai jev-router
```

In PowerShell:

```powershell
wsl -l -v                                        # distro Running
hermes gateway status                            # Gateway process running
hermes cron list                                 # agent-intake, agent-digest active
hermes cron runs <job-id>                        # recent runs of one job
Get-ScheduledTask WSL-Agents-Keepalive, Hermes_Gateway, Hermes-Gateway-Watchdog | Select TaskName, State
```

Test the bridge without writing anything:

```powershell
$py = "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\python.exe"
cd "$env:LOCALAPPDATA\hermes\scripts"
& $py agent_ops.py init             # Odoo login, tags, employee, Paperclip reachable
& $py agent_ops.py pending
& $py agent_ops.py approve 1 --dry-run
```

## Stalled tasks (watchdog)

`agent-watchdog.timer` (Ubuntu, every 10 min) runs `~/.agent-stack/watchdog.sh`. For agents that are not paused it:

- resets an agent stuck in `error` to `idle` when nothing is running for it;
- restarts a task that no live run is working on: `in_progress` untouched for 15 min, `todo` for 15 min while its agent has a free slot, or `blocked` by Paperclip's run recovery (never a task blocked on a `**Question for board:**`). The restart is a board comment on the task, which wakes the assignee with the task bound to the run. A bare `paperclipai agent heartbeat:invoke` starts a run with no task, and Paperclip then refuses that run's comments ("Cross-issue writes need a run"), so the result is lost.
- after 3 restarts of the same task within 6 h, stops restarting it and opens "Watchdog: EME-N keeps stalling" for the **Watchdog** agent, which reads the run logs, fixes what it can in Paperclip, or asks the board.

```bash
~/.agent-stack/watchdog.sh --dry-run      # what it would do now
tail -20 ~/.agent-stack/watchdog.log
```

Tunables (environment of the service): `WATCHDOG_STALE_MIN`, `WATCHDOG_MAX_FIXES`, `WATCHDOG_WINDOW_H`, `WATCHDOG_MAX_PER_CYCLE`, and `WATCHDOG_INTERVAL_MIN` in `config.env` for the timer.

A Claude Code Stop hook (`~/.claude/hooks/wait-for-background.sh`) also keeps an agent's run from ending while a build or test it started is still running.

## Troubleshooting

**Re-running `40-org.sh` un-pauses agents.** Updating an agent resets its status in Paperclip. If you paused agents on purpose (QA first, disk guard), pause them again afterwards.

**Ubuntu says "Read-only file system" / Input/output error.** C: ran out of space and WSL protected its disk. Free space on C: (Disk Cleanup, `npm cache clean --force`, `pnpm store prune`, `pip cache purge`, `docker system prune`), then `wsl --shutdown` and reopen Ubuntu. The journal replays and the disk comes back writable. The Hermes gateway may have died at the same time; the watchdog restarts it within 15 minutes.

**Agent run fails with `Command not found in PATH: "claude"`.** The Paperclip service can't see `~/.local/bin`. `wsl/30-services.sh` writes `~/.config/systemd/user/paperclipai.service.d/path.conf`; re-run `.\install.ps1`. If Node was upgraded, the drop-in's Node path changes too, so re-run after `nvm install`.

**Agent run fails immediately with an auth error.** Claude Code isn't logged in inside WSL: run `claude` in Ubuntu and log in.

**Engineers fail but other agents work.** jev-router is down or has no Jev key: `jev-router doctor`, then `systemctl --user restart jev-router`.

**`API error 422: ambiguous references` from `40-org.sh`.** Two Paperclip skills share a slug (usually one created in the UI and one imported). The script prefers the imported `local/...` one; if it still fails, remove the UI-created duplicate in Paperclip's skill library.

**`Local skill source is outside approved company workspace roots`.** Paperclip only imports from its managed skill folder. Use `40-org.sh` (it copies there first) instead of `paperclipai skills import <any path>`.

**No digest in Discord.** `hermes gateway status`; `hermes cron runs <digest-job-id>`. A digest with nothing to approve still posts "no agent work to approve today".

**Hermes cron says "Gateway is not running".** `Start-ScheduledTask Hermes_Gateway`, or wait for the watchdog. Check `%LOCALAPPDATA%\hermes\logs\gateway-watchdog.log`.

## Where state lives

| What | Where |
|---|---|
| Paperclip DB, agents, runs, managed skills | WSL `~/.paperclip/instances/default/` |
| Paperclip ids used by the scripts | WSL `~/.agent-stack/ids.json` |
| jev-router config, keys, log | WSL `~/.config/jev-router/`, `~/.local/state/jev-router/router.log` |
| Hermes bridge config (ids, employee, project_map) | `%LOCALAPPDATA%\hermes\scripts\agent_ops.config.json` |
| Digest pending items, relayed questions | `%LOCALAPPDATA%\hermes\state\agent_ops\` |

## Backups and upgrades

```bash
paperclipai db:backup               # one-off DB backup
paperclipai update                  # upgrade (takes a DB backup first)
paperclipai update --rollback       # undo a bad upgrade
npm install -g @ediri/jev-router@latest && systemctl --user restart jev-router
claude update
```

After upgrading Paperclip, run `.\install.ps1 -OnlyOrg` to confirm instructions and skills are still applied.
