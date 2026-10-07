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
| Never prune or delete worktrees, branches or files you did not create; never create a worktree inside a repo folder | `common.md`, `wsl/watchdog/watchdog.sh` (keeps worktrees an open task uses) |
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
| Engineers never merge; DevOps merges verified PRs to `staging` the same day; nothing finished stays on a branch (all 3 repos) | `eng-rules.md`, `org/engineering/devops.md` |
| Mobile app builds and store uploads are the owner's (Codemagic); DevOps stops at the merge | `org/engineering/devops.md` |
| Production changes (live websites, `main`) only with the owner's approval on the issue | `org/engineering/devops.md` |
| Every internal screen has a back button; modals behave the same everywhere; no native browser prompts (Leave site?, confirm, alert) | `org/engineering/ux.md`, project context skills |

## QA and proof

| Rule | Where |
|---|---|
| A ticket goes to Testing only when 100% verified: fix deployed, the ticket's own steps run on staging, the full Expected Result seen, nearby flows intact, correct proof attached. Done (merged) is not Testing; only QA proposes the move | `org/engineering/qa.md` (checklist), `org/_partials/common.md`, enforced by `hermes/agent_ops.py` (no move to Testing/Done without evidence for that ticket in the same proposal, checked when queued and again when approved; work-item approvals never move a ticket to Testing or Done) |
| QA never rebuilds, reinstalls or uninstalls the app on a test device; the owner installs builds | `org/engineering/qa.md` |
| Proof is small, correct and specific: planned from the ticket, every file looked at, nothing blocked or unrelated, no duplicates, at most 8 files, a note per file; each file shows what its name claims (results after loading finishes, numbers readable, timing by recording) | `skills/qa-evidence`, enforced by `hermes/agent_ops.py` (duplicates, file count, note; a screen ticket, any title not Backend:/DevOps:/Docs:, needs a screenshot or recording to move) |
| One evidence proposal per ticket; the owner approves before anything reaches Odoo | `skills/qa-evidence`, `hermes/agent_ops.py` |
| Devices: only the owner's emulator/phone, one task at a time, tap by element, never Log Out, never create or wipe emulators, never install or uninstall apps | `org/engineering/qa.md`, enforced by `wsl/hooks/device-guard.sh` |

## Odoo

| Rule | Where |
|---|---|
| Nothing is written to Odoo without the owner's approval in Discord | `hermes/agent_ops.py` (proposals), every Odoo skill |
| Tickets have a plain title and a description a non-engineer can follow; tickets written by people are not rewritten | `skills/odoo-tickets` |
| Timesheets: 8 h on working days (Mon-Fri), actual hours on leave days on top of Odoo's time off, nothing on weekends, agent-stack work never logged | `skills/daily-timesheets`, `config.env` (`DAILY_HOURS`, `WORKDAYS`, `TIMESHEET_EXCLUDE_REPOS`) |
| New Odoo work is picked up automatically: tickets tagged ready, plus bugs the QA engineer files in QA Issues (projects with a Paperclip project); never twice | `hermes/agent_ops.py` (`intake`: full issue list, dedupe on billing code, Odoo id or ticket number) |
| Standup (DSM) in the owner's exact format; each completed ticket marked tested or "on staging, manual test pending" | `org/operations/timekeeper.md`, `hermes/agent_ops.py` (`standup`) |

## Keeping the factory healthy

| Rule | Where |
|---|---|
| No agent stays stalled: watchdog every 10 min plus a Watchdog agent sweep every 2 hours | `wsl/watchdog/watchdog.sh`, `org/operations/watchdog.md` |
| Parallel runs capped per agent (2 engineers/QA/UX, 1 for the rest) | `org/<dept>/department.json` |
| Disk guard pauses agents when the system drive is low and resumes them | `hermes/agent_ops.py` (`diskguard`) |
