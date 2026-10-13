# Mods

Claude Code mods that belong to this stack. Each folder is one mod; `catalog.json` lists them for Mod Bar, so every one gets an on/off switch in the toolbar and in `/mods`.

| Mod | What it does |
|---|---|
| (none yet) | The former crew mod showed the retired agent orchestrator's agents and was removed on 2026-10-13. |

## Install (once per machine)

```bash
claude plugin marketplace add C:\Abbas\Emergen\agent-stack\mods
claude plugin install <mod>@emergen-mods
node mods/register-in-mod-bar.mjs     # puts the mods in Mod Bar's list; run again after a Mod Bar update
```

Open a new chat afterwards (the desktop app does not load plugins into an open chat).

## Add a mod

1. Put it in `mods/<name>/` (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`).
2. List it in `.claude-plugin/marketplace.json` and add an entry to `catalog.json` (`name`, `short`, `icon`, `title`, `about`).
3. Install it as above and run `register-in-mod-bar.mjs`.

Turn a mod off without removing it: the Mod Bar switch, or `claude plugin disable <name>@emergen-mods`.
