# Setup wizard

A guided installer for this stack. Run `setup.cmd` in the repo root: it opens a page in your browser, asks what you want to set up, shows exactly what will change, and runs only the steps you approve. Add `--preview` to walk through everything without changing a thing.

## What you can set up

| Area | What it does |
|---|---|
| Agent company | Picks departments and how active the scheduled agents are when idle; writes `config.env`; creates the agents in Paperclip (`install.ps1 -OnlyOrg`). |
| Personal workspace | Starts the Downloads organizer at logon and creates your project folders (Emergen, Personal, Qualifi, ...). |
| Branding and content | Writes a brand profile skill (`project-skills/<brand>-context`) that every agent reads. |
| Freelance | Registers Upwork's official MCP server. You sign in yourself; agents only draft. |
| Model routing | Installs OmniRoute (`wsl/45-omniroute.sh`). |
| Claude mods | Installs the Paperclip Crew mod and adds it to Mod Bar. |

Each step also shows "What others have built": real projects from GitHub with their licence and last update (`suggestions.json`, refreshed by the Refresh button). Nothing from that list is installed for you.

## What it will not do

- It never asks for or sees passwords, API keys or tokens. Logins (`gh auth login`, `claude`, Upwork, provider keys) stay yours, and the review screen lists them.
- The page cannot send commands. It sends choices; `actions.mjs` turns them into a fixed set of steps, and only `config.env` keys on its allow-list can be written. The old `config.env` is copied to `config.env.bak-<time>` first.
- It listens on `127.0.0.1` only, with a one-time key in the link and a Host check.

## Files

- `server.mjs` serves the page and the small API; `actions.mjs` holds the plan and the steps.
- `profiles.json`: the idle-cost presets. Per-run costs come from runs measured on this stack.
- `ui/`: the page itself, no build step.
- `npm test` (or `node wizard.test.mjs`): validation, the plan, the config writer, the token and host checks, and a preview-mode run.
