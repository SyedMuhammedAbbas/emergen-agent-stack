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

## Guided setup (Tools screen) and the wiring script

Tools -> OmniRoute walks through the owner steps above, checks that the key file exists (its contents are never read), then runs **"Point the router at OmniRoute"**, which is `wsl/46-omniroute-wire.sh`:

```bash
wsl/46-omniroute-wire.sh --check      # read-only: what is ready, what is missing
wsl/46-omniroute-wire.sh              # wire it up
wsl/46-omniroute-wire.sh --rollback   # restore the last backup
```

It refuses to change anything until OmniRoute answers, the key file exists and (when OmniRoute lists models for that key) the combos `fast`, `balanced` and `frontier` exist. Then it backs up `~/.config/jev-router/config.json`, copies the key into jev-router's env file (mode 600, never printed), points the `fast`, `balanced` and `frontier` tiers of the `anthropic` surface at OmniRoute, restarts jev-router and runs `jev-router doctor --live`. If that test fails it restores the old config and restarts. `trusted` and `side` stay direct on purpose. The `openai` surface (Codex) is not touched.

Not verified: that OmniRoute accepts the Anthropic message format jev-router sends, and that `/v1/models` lists combos. The live test is the real check; the combo check only warns if the listing does not work.

## Routing the other 15 agents (step 3)

Agents are routed through jev-router (and so OmniRoute) when their template says `"router": true`; the reconciler then gives them `ANTHROPIC_BASE_URL=http://127.0.0.1:4000` and the router hint settings (`org/company.json`, `routerEnv`). Today only Frontend, Backend and DevOps have it.

Previewed (nothing applied): setting `"router": true` for the Docs agent produces exactly one change in `stack plan`, `env`, and reverting restores a clean plan. To do it for real, once the router is wired and `doctor --live` passes:

1. Try one agent first: set `"router": true` for it in `org/<dept>/department.json`, then `stack plan` and `stack apply --yes --only <key>`.
2. Give it a real task and check the Models screen shows its requests going through OmniRoute.
3. Then enable the rest the same way, one department at a time. `stack rollback` undoes an apply.

Open question to test on that first agent: these agents sign in with your Claude **subscription**, not an API key. Whether a subscription sign-in works through the router and OmniRoute, and whether OmniRoute sees a subscription's usage limit as a quota error it can fall back on, is unverified. If it does not, Claude-subscription agents will still stop at their limit, and fallback will apply only to providers connected inside OmniRoute with keys or their own sign-in.
