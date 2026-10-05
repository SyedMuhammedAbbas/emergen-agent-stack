---
name: daily-timesheets
description: Build the day's timesheet proposal from the user's git commits across local projects, matched to Odoo tasks (main task, sub-task, milestone, assignee). Use for the end-of-day timesheet routine or when asked to log time for a date.
---

# Daily timesheets

You prepare the user's own timesheet for one day as an Odoo **proposal**. You never write to Odoo: the proposal is posted to Discord and the user approves it there.

Bridge commands (Windows Python called from WSL; always quote the Windows path):

```bash
PY={{HERMES_PY}}
AO='{{AGENT_OPS}}'
"$PY" "$AO" odoo projects                    # id + name of every active Odoo project
"$PY" "$AO" odoo project <id>                 # stages, milestones, main tasks (with sub-task counts)
"$PY" "$AO" odoo tasks <project_id> --mine    # tasks assigned to the user (id, stage, milestone, parent)
"$PY" "$AO" odoo tasks <project_id> --open    # all open tasks, to find the right main task
"$PY" "$AO" odoo timesheets <YYYY-MM-DD>      # what is already logged that day ("time_off": true = leave lines Odoo wrote)
"$PY" "$AO" odoo timeoff <YYYY-MM-DD>         # the user's approved or pending time off covering that day
"$PY" "$AO" propose --file '<windows path to proposal.json>'
```

## Steps

1. **Date.** Use the date in the issue title or description; otherwise today (local time). Working days are {{WORKDAYS_TEXT}}; on any other day (weekend) log nothing: comment that it is a day off and stop, even if there are commits.
2. **Time off and what is logged.** Run `odoo timeoff <date>` and `odoo timesheets <date>`. Lines with `"time_off": true` are leave that Odoo logged itself; they are not project work and never count as "already logged".
   - **Normal working day:** hours to fill = {{DAILY_HOURS}} minus the project hours already logged. If nothing is left, comment that and stop.
   - **Full day of time off** (the user works anyway; the owner's rule): log only the **actual** project hours for the day, on top of the leave. Actual = the commit time spans from step 7 without scaling up to {{DAILY_HOURS}}, at most {{DAILY_HOURS}}, minus project hours already logged. No commits = nothing to log; comment that and stop.
   - **Part-day time off:** hours to fill = {{DAILY_HOURS}} minus the leave hours minus project hours already logged.
   Say in the proposal title which case applies, e.g. `Timesheets 2026-10-06 (on leave: actual hours)`.
3. **Collect commits** by `{{GIT_AUTHOR}}` for that local day, across all branches:
   - every repo listed under `projects.*.repos` in `~/.agent-stack/ids.json`, and
   - every git repo under `{{PROJECTS_ROOT}}` up to 3 levels deep (`find {{PROJECTS_ROOT}} -maxdepth 3 -name .git -type d`).
   Use `git log --all --since='<date> 00:00' --until='<date> 23:59:59' --author='{{GIT_AUTHOR}}' --date=format-local:'%H:%M' --format='%ad %h %s'`.
   Skip repos under the Personal category ({{PROJECT_CATEGORIES}} lists the categories; personal work is not billed to Odoo).
   Skip these repos entirely, whatever their category: {{TIMESHEET_EXCLUDE_REPOS}} (repo folder names). Work on them is never logged in Odoo.
4. **Group into work streams**: commits that belong to one change (same task key like `INV-SYNC`, same branch `task/...`, or the same feature). Merge commits only mark completion.
5. **Odoo project per repo**: the `odoo_project_id` of a connected project in `ids.json`, else match the folder name under `{{PROJECTS_ROOT}}/<category>/<Project>` to `odoo projects`. If unsure, ask (step 9) rather than guess.
6. **Match each stream to an Odoo task**, in this order:
   - a task assigned to the user whose title describes the same change (`odoo tasks <pid> --mine`), especially ones in review/QA stages that moved that day;
   - any open task in the project that clearly matches (`--open`);
   - otherwise **create a sub-task**: `create_task` with `parent` = the main task for that area (`odoo project <pid>` lists main tasks) and `milestone` = that main task's milestone. Title and description follow the `odoo-tickets` skill (plain "Area: what changed" title; a short Description and Done when, with the commit hashes under Technical notes). `stage`: the stage matching tasks of that kind are in (e.g. "Code Review" once merged to the integration branch).
   - For matched tasks not assigned to the user, or without a milestone, add `update_task` with `assign_me: true` and the milestone of their main task.
7. **Hours**: each stream's time is its commit time span (first to last commit, plus ~30 min lead-in). On a normal working day, scale the streams so the total is exactly the hours to fill. On a full day of time off, use the spans as they are (no scaling up), capped as in step 2. Round to 0.25 h, minimum 0.25 h.
8. **Proposal**: write JSON to `{{HERMES_STATE_WSL}}/proposal-timesheets-<date>.json` (the Windows path is `{{HERMES_STATE_WIN}}\proposal-timesheets-<date>.json`):
   ```json
   {"title": "Timesheets <date>", "actions": [
     {"type": "create_task", "ref": "t1", "project_id": 91, "parent": 27729, "milestone": "M9 - Seller and Admin Backend",
      "name": "Dashboard: audited staff updates", "stage": "Code Review", "description": "<p>Commits: ab20be1, 3318a67</p>"},
     {"type": "update_task", "task": 28034, "assign_me": true, "milestone": "M9 - Seller and Admin Backend"},
     {"type": "timesheet", "date": "<date>", "task": "t1", "hours": 2.5, "description": "Dashboard - audited staff updates"},
     {"type": "timesheet", "date": "<date>", "task": 28034, "hours": 1.5, "description": "Inventory - live stock sync after sale"}
   ]}
   ```
   Timesheet descriptions follow the user's style: `Area - what was done`, plain words, no em dashes.
   Then run `propose --file '<windows path>'`.
9. **Report** on the issue: the proposal text (it starts with its number), and anything you skipped or were unsure about. If a mapping is genuinely ambiguous, post a `**Question for board:**` instead of guessing and leave that stream out of the proposal.

## Rules
- Never call Odoo write methods and never run `approve`. Only `odoo ...` reads and `propose`.
- Never log time for work that has no commit or other evidence in the day; say what evidence each line has.
- Do not re-log a day or task already covered in `odoo timesheets`.
