# OmniRoute (model gateway)

How a model request travels:

```
Paperclip agent (Claude Code)
  -> jev-router  :4000   reads the task, picks a tier: fast / balanced / frontier
  -> OmniRoute   :20128  turns the tier into a real provider + model, with fallback when one is out of quota
  -> providers           your subscriptions, API keys and free tiers
```

jev-router decides how hard the task is. OmniRoute decides which provider serves it. Agents with `"router": false` in `org/*/department.json` (Manager, CTO, SecOps, QA, UX, Docs, Estimator, Timekeeper, Watchdog, Chief of Staff, Branding, Freelance) talk to Claude directly and do not go through either.

## Install

```bash
wsl/45-omniroute.sh     # installs the npm package omniroute, runs it as the systemd user service omniroute.service
```

Dashboard: http://localhost:20128. Logs: `journalctl --user -u omniroute`.

## Owner steps (keys never go in git or chat)

1. Open the dashboard and set the admin password.
2. Providers: connect what you have (Claude subscription, OpenRouter key, free tiers such as Kiro or OpenCode Free).
3. Combos: create three combos named `fast`, `balanced` and `frontier`, each an ordered list of provider models with fallback.
4. API keys: create one key for jev-router and put it in `~/.config/jev-router/env` as `OMNIROUTE_API_KEY=...`.

## Wiring jev-router to it

In `~/.config/jev-router/config.json`, for `surfaces.anthropic.fast`, `.balanced` and `.frontier` set `url` to `http://127.0.0.1:20128`, `model` to the combo name, `keyEnv` to `OMNIROUTE_API_KEY`. Then:

```bash
jev-router doctor --live
systemctl --user restart jev-router
```

Until steps 1 to 4 are done, leave the config as it is: jev-router keeps calling Anthropic directly and nothing breaks.
