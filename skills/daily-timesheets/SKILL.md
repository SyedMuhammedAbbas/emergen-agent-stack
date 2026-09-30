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
"$PY" "$AO" odoo timesheets <YYYY-MM-DD>      # what is already logged that day
"$PY" "$AO" propose --file '<windows path to proposal.json>'
```

## Steps

1. **Date.** Use the date in the issue title or description; otherwise today (local time).
2. **Already logged?** Run `odoo timesheets <date>`. Hours to fill = {{DAILY_HOURS}} minus what is logged. If nothing is left, comment that and stop.
3. **Collect commits** by `{{GIT_AUTHOR}}` for that local day, across all branches:
   - every repo listed under `projects.*.repos` in `~/.agent-stack/ids.json`, and
   - every git repo under `{{PROJECTS_ROOT}}` up to 3 levels deep (`find {{PROJECTS_ROOT}} -maxdepth 3 -name .git -type d`).
   Use `git log --all --since='<date> 00:00' --until='<date> 23:59:59' --author='{{GIT_AUTHOR}}' --date=format-local:'%H:%M' --format='%ad %h %s'`.
   Skip repos under the Personal category ({{PROJECT_CATEGORIES}} lists the categories; personal work is not billed to Odoo).
4. **Group into work streams**: commits that belong to one change (same task key like `INV-SYNC`, same branch `task/...`, or the same feature). Merge commits only mark completion.
5. **Odoo project per repo**: the `odoo_project_id` of a connected project in `ids.json`, else match the folder name under `{{PROJECTS_ROOT}}/<category>/<Project>` to `odoo projects`. If unsure, ask (step 9) rather than guess.
6. **Match each stream to an Odoo task**, in this order:
   - a task assigned to the user whose title describes the same change (`odoo tasks <pid> --mine`), especially ones in review/QA stages that moved that day;
   - any open task in the project that clearly matches (`--open`);
   - otherwise **create a sub-task**: `create_task` with `parent` = the main task for that area (`odoo project <pid>` lists main tasks) and `milestone` = that main task's milestone. Title in the project's style ("Area: what changed"), description with the commit hashes. `stage`: the stage matching tasks of that kind are in (e.g. "Code Review" once merged to the integration branch).
   - For matched tasks not assigned to the user, or without a milestone, add `update_task` with `assign_me: true` and the milestone of their main task.
7. **Hours**: split the hours to fill across streams in proportion to their commit time spans (first to last commit, plus ~30 min lead-in). Round to 0.25 h, minimum 0.25 h, and make the total exactly the hours to fill.
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
