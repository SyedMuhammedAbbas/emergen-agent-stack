# Agent Stack control app

Status page for the stack: are the services running, what is it costing, what needs you. **Version 0.2** (M2.1 Home and Services, M2.3 service control). Everything on Home is read-only; the only things it can change are starting, stopping and restarting the services listed below. Design: [docs/architecture/15-m2-design.md](../../docs/architecture/15-m2-design.md); plan: [14-m2-plan.md](../../docs/architecture/14-m2-plan.md).

```
app.cmd                      (repo root) starts it and opens your browser
node apps/control-app/server.mjs [--port 4790] [--no-open]
```

It runs on **Windows** (so it can still report when WSL is down), listens on `127.0.0.1` only, and every data request needs the one-time key in the link it prints.

## What it reads

| Reading | How | Cost |
|---|---|---|
| Services answering | HTTP to localhost ports | ~150 ms |
| WSL running | `wsl.exe -l --running` | ~50 ms |
| Paperclip, jev-router, OmniRoute, watchdog | one `wsl.exe systemctl --user show` for all units | ~100 ms |
| Keepalive, Hermes tasks | `schtasks /query` (no admin) | ~30 ms |
| Crew, runs, spend, approvals | Paperclip API (`/agents`, `/heartbeat-runs`, `/approvals`) | ~20 ms |
| C: free space | `statfs` | instant |

Spend is summed from each run's `usageJson.costUsd` (what it would cost at API prices), split into API-billed and subscription-covered, because Paperclip's own summary shows $0 for subscription runs.

## What it can change (and what protects you)

| Action | Services | Guard |
|---|---|---|
| Start, Stop, Restart | Paperclip, jev-router, OmniRoute | Confirmation dialog. Stop/Restart while agents are working need a second, explicit confirmation, **enforced by the server** |
| Start | WSL, the keepalive task | Confirmation dialog |

- The browser sends only ; the server has a fixed allow-list (own keys only) and runs the exact  or  command, with no shell.
- One action at a time, a short cool-down per service, and every attempt (also failures and refusals of the busy guard being overridden) is appended to .
- Logs (last 40 lines) and audit errors are passed through a redactor that masks keys, tokens, JWTs,  values and long hex strings.
- **Doctor** runs 13 read-only checks (WSL, keepalive, each service, Paperclip version, disk, Claude login in WSL and on Windows, the service PATH, ids file, symlinks, reconciler contract). A fix button appears only for a safe start or restart and goes through the same guarded runner.

## Settings (optional)

`%LOCALAPPDATA%\AgentStack\settings.json`, any of: `distro` (default from `config.env` `WSL_DISTRO`, else `Ubuntu-24.04`), `paperclip` (`http://127.0.0.1:3100`), `budgetUsd` (100), `alertAt` (0.8), `companyName`.

## Tests

```
node --test apps/control-app/test/app.test.mjs apps/control-app/test/actions.test.mjs
node apps/control-app/dev/fixture-server.mjs      # the real UI on synthetic problem states (ok, svc, wsl, paperclip)
```

Bundled fonts: IBM Plex Sans and Mono (OFL), see `ui/fonts/README.md` for source and checksums.

`design/mockup/` is the approved clickable mockup (sample data).
