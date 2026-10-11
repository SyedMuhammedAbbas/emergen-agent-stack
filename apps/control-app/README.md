# Agent Stack control app

Status page for the stack: are the services running, what is it costing, what needs you. **Version 0.6** (Home, Services with control, Team, Cost, Activity, Models, Safety). Everything on Home is read-only; the only things it can change are starting, stopping and restarting the services listed below. Design: [docs/architecture/15-m2-design.md](../../docs/architecture/15-m2-design.md); plan: [14-m2-plan.md](../../docs/architecture/14-m2-plan.md).

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

## Safety

**Database backups.** Lists Paperclip's own automatic backups (hourly, kept 30 days, read from its config) and has **Back up now**, which runs `paperclipai db:backup`. The backups live inside WSL on the same disk as the data, so the page says that plainly; set `backupCopyDir` (a Windows path such as `D:\\Backups\\agent-stack`) in settings.json to have each manual backup also copied there. A need appears on Home if there is no backup, or the newest is older than 6 hours (26 if automatic backups are off). The app never restores a backup.

**Secrets.** An inventory of where the stack keeps secrets (jev-router, Paperclip, GitHub, Claude, OmniRoute, Hermes, `config.env`): paths, permissions (a secret file readable by other users is flagged with the exact `chmod`), and whether `config.env` is excluded from git. It also lists folders *named* like they hold credentials in Downloads, Desktop and Documents. **File contents are never read.** Windows file permissions are not checked.

**Leak scan** (on demand, about 2 seconds): looks for key-shaped text where secrets do not belong: git-tracked files, the app's own data, the reconciler's state and jev-router's log, and the services' logs. It reports file, line and kind, **never the value**, and uses the same rules as the redactor. Placeholders, already-redacted text and code that merely generates or reads a value are not findings. A Paperclip instance's own `.env` and `secrets/` are expected secret locations and belong to the inventory instead. Test files, fixtures and `node_modules` are skipped. Anything found becomes a need on Home.

## Models

How Claude agents are routed, and whether the gateway for other models is up. Read-only and secret-free. From jev-router: its `/healthz` (version, uptime, sessions, Jev calls and errors per channel), a jq-filtered slice of its config (tiers, model pins, the minimum probability each tier needs; the filter leaves out keys and key names) and the `route` events in its log (tier, model, a short redacted reason) for a 24-hour tally and the latest decisions. From OmniRoute: only `/api/health`; its providers and combinations need its own sign-in, so the page links to its dashboard instead. It also lists which agents go through jev-router, which call Claude directly with a fixed model, and which would use OmniRoute, plus spend by model this month. Refreshed in the background about every 30 seconds.

## Team

Every agent with its model, state and where it stands against the templates in `org/`: in step, keeping your edit, will update, needs a decision, or not managed. It runs the reconciler's read-only `stack plan --json` inside WSL about once a minute (in the background, never delaying a reading). Open an agent to see exactly what differs (instruction changes as a line diff) and the one command that would apply it, with a Copy button. **Applying stays in the command line**; this screen never changes anything. A decision also shows up under Needs you on Home.

## Cost and Activity

Both come from Paperclip's runs, kept in a small ledger (`%LOCALAPPDATA%\AgentStack\cost-cache.json`) so a month's history survives if Paperclip ever trims its run list. Cost shows the month against your budget (default $100, alert at 80%, and a need appears on Home when you pass the line), a stacked daily chart (API-billed vs subscription-covered), spend by agent and by model, and token totals. Activity lists runs and approvals, newest first, with the task title when the run belongs to a task (fetched in the background), and filters by agent and status.

Spend is summed from each run's `usageJson.costUsd` (what it would cost at API prices), split into API-billed and subscription-covered, because Paperclip's own summary shows $0 for subscription runs.

## What it can change (and what protects you)

| Action | Services | Guard |
|---|---|---|
| Start, Stop, Restart | Paperclip, jev-router, OmniRoute | Confirmation dialog. Stop/Restart while agents are working need a second, explicit confirmation, **enforced by the server** |
| Start | WSL, the keepalive task | Confirmation dialog |

- The browser sends only `{service, action}`; the server has a fixed allow-list (own keys only) and runs the exact `systemctl` or `schtasks` command, with no shell.
- One action at a time, a short cool-down per service, and every attempt (successes and failures, and whether the busy guard was overridden) is appended to `%LOCALAPPDATA%\AgentStack\audit.jsonl`.
- Logs (last 40 lines) and audit errors pass through a redactor that masks keys, tokens, JWTs, `password=` values and long hex strings.
- **Doctor** runs 13 read-only checks (WSL, keepalive, each service, Paperclip version, disk, Claude login in WSL and on Windows, the service PATH, ids file, symlinks, reconciler contract). A fix button appears only for a safe start or restart and goes through the same guarded runner.

## Settings (optional)

`%LOCALAPPDATA%\AgentStack\settings.json`, any of: `distro` (default from `config.env` `WSL_DISTRO`, else `Ubuntu-24.04`), `paperclip` (`http://127.0.0.1:3100`), `budgetUsd` (100), `alertAt` (0.8), `companyName`, `backupCopyDir`.

## Tests

```
node --test apps/control-app/test/app.test.mjs apps/control-app/test/actions.test.mjs apps/control-app/test/costs.test.mjs apps/control-app/test/team.test.mjs apps/control-app/test/models.test.mjs apps/control-app/test/safety.test.mjs apps/control-app/test/secretscan.test.mjs
node apps/control-app/dev/fixture-server.mjs      # the real UI on synthetic problem states (ok, svc, wsl, paperclip)
```

Bundled fonts: IBM Plex Sans and Mono (OFL), see `ui/fonts/README.md` for source and checksums.

`design/mockup/` is the approved clickable mockup (sample data).
