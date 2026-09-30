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

## Troubleshooting

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
