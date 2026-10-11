# Agent Stack control app

Status page for the stack: are the services running, what is it costing, what needs you. **Version 0.1 is read-only** (M2.1: Home and Services). Design: [docs/architecture/15-m2-design.md](../../docs/architecture/15-m2-design.md); plan: [14-m2-plan.md](../../docs/architecture/14-m2-plan.md).

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

## Settings (optional)

`%LOCALAPPDATA%\AgentStack\settings.json`, any of: `distro` (default from `config.env` `WSL_DISTRO`, else `Ubuntu-24.04`), `paperclip` (`http://127.0.0.1:3100`), `budgetUsd` (100), `alertAt` (0.8), `companyName`.

## Tests

```
node --test apps/control-app/test/app.test.mjs
node apps/control-app/dev/fixture-server.mjs      # the real UI on synthetic problem states (ok, svc, wsl, paperclip)
```

`design/mockup/` is the approved clickable mockup (sample data).
