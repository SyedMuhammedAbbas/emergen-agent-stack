# Owner rules: what the agents are trained to do

Every standing instruction from the owner, and the file that teaches it to the agents (and to Claude Code through the `role-<key>` skills). When the owner gives a new standing instruction, add it to the right file **and** to this list in the same commit. Project-specific rules live in that project's context skill (`project-skills/<project>-context`).

## Working rules (all agents)

| Rule | Where it is enforced |
|---|---|
| No invented facts, APIs or results; no em dashes or AI filler | `skills/no-slop`, `org/_partials/common.md` |
| Never claim done without running the check in this run | `skills/verification-before-completion`, `common.md` |
| Run long commands in the foreground and wait for the result | `common.md`, `wsl/hooks/wait-for-background.sh` |
| Test only what proves the step; never repeat a passed gate | `common.md` |
| Never set a git identity; no AI attribution in client repos | `common.md` |
| Never prune or delete worktrees, branches or files you did not create | `common.md`, `wsl/watchdog/watchdog.sh` (keeps worktrees an open task uses) |
| Never type passwords, sign-in codes, API keys or real card numbers; the owner signs test accounts in | `common.md`, `org/engineering/qa.md` |
| Stay out of the owner's personal folders and `_secrets/` | `common.md`, project context skills |
| Nothing new installed without the vetting checklist and the owner's yes | `skills/tool-vetting`, `common.md` |
| Ask instead of guessing, in the short plain-language question format | `common.md`, `hermes/agent_ops.py` (`format_question`) |
| Everything that reaches Discord is plain language, tickets as Ticket#N | `docs/discord-messages.md`, `common.md`, `hermes/agent-ops/SKILL.md`, `hermes/agent_ops.py` |
| Client-facing text: facts and questions only; no cost, estimates, timelines or scope promises; the owner sends it | `common.md`, project context skills |
| Build only what the PRD says; anything else is a change request for the owner | `project-skills/prd-scope-discipline`, project context skills |

## Engineering

| Rule | Where |
|---|---|
| Branch from and open PRs against `staging`, never `main` | `org/engineering/_partials/eng-rules.md` |
| Tests written from the requirement and proven to fail when the behaviour breaks | `skills/test-integrity`, `eng-rules.md`, `org/engineering/qa.md` |
| Engineers never merge; DevOps merges verified PRs to `staging` | `eng-rules.md`, `org/engineering/devops.md` |
| Mobile app builds and store uploads are the owner's (Codemagic); DevOps stops at the merge | `org/engineering/devops.md` |
| Production changes (live websites, `main`) only with the owner's approval on the issue | `org/engineering/devops.md` |
| Every internal screen has a back button; modals behave the same everywhere | `org/engineering/ux.md`, project context skills |

## QA and proof

| Rule | Where |
|---|---|
| A ticket goes to Testing only after QA reproduces the ticket's own steps on the deployed staging build | `org/engineering/qa.md` |
| Proof is small, correct and specific: planned from the ticket, every file looked at, nothing blocked or unrelated, no duplicates, at most 8 files, a note per file | `skills/qa-evidence`, enforced by `hermes/agent_ops.py` (duplicates, file count, note) |
| One evidence proposal per ticket; the owner approves before anything reaches Odoo | `skills/qa-evidence`, `hermes/agent_ops.py` |
| Devices: only the owner's emulator/phone, one task at a time, tap by element, never Log Out, never create or wipe emulators | `org/engineering/qa.md` |

## Odoo

| Rule | Where |
|---|---|
| Nothing is written to Odoo without the owner's approval in Discord | `hermes/agent_ops.py` (proposals), every Odoo skill |
| Tickets have a plain title and a description a non-engineer can follow; tickets written by people are not rewritten | `skills/odoo-tickets` |
| Timesheets: 8 h on working days (Mon-Fri), actual hours on leave days on top of Odoo's time off, nothing on weekends, agent-stack work never logged | `skills/daily-timesheets`, `config.env` (`DAILY_HOURS`, `WORKDAYS`, `TIMESHEET_EXCLUDE_REPOS`) |
| Standup (DSM) in the owner's exact format | `org/operations/timekeeper.md`, `hermes/agent_ops.py` (`standup`) |

## Keeping the factory healthy

| Rule | Where |
|---|---|
| No agent stays stalled: watchdog every 10 min plus a Watchdog agent sweep every 2 hours | `wsl/watchdog/watchdog.sh`, `org/operations/watchdog.md` |
| Parallel runs capped per agent (2 engineers/QA/UX, 1 for the rest) | `org/<dept>/department.json` |
| Disk guard pauses agents when the system drive is low and resumes them | `hermes/agent_ops.py` (`diskguard`) |
