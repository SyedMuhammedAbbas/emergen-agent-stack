---
name: odoo-tickets
description: Standards for Odoo project tickets (titles, descriptions, sub-task structure, milestones) and the procedure to clean up a messy project through approved proposals. Use whenever you create or edit an Odoo ticket, file a bug, propose sub-tasks, or are asked to tidy a project's tickets, in any project or tool.
---

# Odoo tickets

Tickets are read by people: the owner, the client, the QA engineer who re-tests by hand. Write them so someone who has never seen the code knows what is wrong or what is being built, how to check it, and where it sits in the plan. You never write to Odoo directly: every change goes into a **proposal** that the owner approves in Discord.

Bridge commands (Windows Python called from WSL; always quote the Windows path):

```bash
PY={{HERMES_PY}}
AO='{{AGENT_OPS}}'
"$PY" "$AO" odoo project <id>                  # stages, milestones, main tasks with sub-task counts
"$PY" "$AO" odoo tasks <project_id> --open --full   # every open ticket: number, title, stage, milestone, parent, creator, hours, description length
"$PY" "$AO" odoo task <task_id>                # one ticket in full: description as text, children, hours, creator
"$PY" "$AO" propose --file '<windows path to proposal.json>'
```

## Titles

- Odoo adds the ticket number itself on create (`316: ...`). When creating, do **not** type a number. When renaming, keep exactly one `<number>: ` prefix with a space after the colon.
- Form: `<number>: <Area>: <what the user sees or gets>`. Areas: `App`, `Seller App` (only when it is seller-only), `Dashboard`, `Backend`, `Web`, `Payments`, `Security`, `Infrastructure`. Bugs written by the QA engineer keep their own wording (they name the screen and the symptom); just fix typos and the prefix.
- One idea, 80 characters at most. Plain words: no internal codes (`SECFIX-D`, `EME-123`, PR numbers, env vars, Figma frame ids, `Q18`, `M4-22`), no long parenthesised lists, no em dashes.
- Good: `313: Bidding: limit a buyer to 5 raises in a row on their own bid`. Bad: `181: 155: Backend: SECFIX-C bid bounds (operator bid ceiling, anti-snipe extension cap as settings, ...)`.
- A section (parent) task is named for the area of the product, e.g. `Checkout & Payment Methods`; a milestone task is `M<n> - <name>` matching the Odoo milestone.

## Descriptions

Write the description in simple Markdown (`## Heading`, `- bullet`, `1. step`, blank line between paragraphs); the bridge converts it to Odoo formatting.

**Bug** (same layout the QA engineer uses):
```
## Description
<One or two sentences: where it happens and what goes wrong, as the user sees it.>

## Steps to Reproduce
1. ...

## Expected Result
...

## Actual Result
...

## Technical notes
<Repos, PRs, commits, root cause. Last, and short.>
```

**Feature or task**:
```
## Description
<What this adds or changes for whom, and why, in plain words.>

## What's included
- ...

## Done when
- <Checks a person can do on staging, e.g. "On the dashboard, Failed Payments > Abandon closes the sale and puts the item back in stock without listing it again.">

## Technical notes
<Repos, PRs, commits, decisions (ADR links).>
```

A description that is only a commit list is not acceptable. Commits and PR links go under Technical notes.

## Structure

- Every ticket has a **milestone**, and it matches its parent's milestone.
- Levels: milestone task (`M3 - App Foundation`) > area section (`Infrastructure & DevOps`) > tickets. No deeper. A ticket whose work spans areas goes under the section where the user sees the change.
- A sub-task that is still open must show on the project board (`display_in_project`); the bridge sets this for every ticket with a parent.
- Do not invent new sections or milestones; if nothing fits, ask the board (`**Question for board:**`).

## Tickets written by people

Tickets created by anyone other than the owner's bridge account (for example the QA engineer) are their words. Never rewrite their description. You may: fix a typo or a doubled or missing number prefix in the title, set parent and milestone, and add a note. If their ticket lacks something (steps, expected result), add a **note**, do not edit.

## Cleaning up a project

1. Read: `odoo project <id>` and `odoo tasks <id> --open --full`. Ignore Done and Cancelled tickets.
2. List problems in five groups: **duplicates**, **titles**, **structure** (parent/milestone missing or mismatched, wrong section, deeper than 3 levels), **descriptions** (agent-written ones that break the layout above), **unclear** (you cannot tell what the ticket is; ask, do not guess).
3. Duplicates: the same work filed twice (e.g. one copy in Testing, one in Backlog). Keep the one that is further along or has timesheets; `archive` the other with a note `Duplicate of Ticket#<n>`. Never archive a ticket that has timesheet hours or is in Doing, Code Review or Testing; ask instead.
4. Propose in **batches of at most 20 changes, one group per batch**, titled so the owner knows what they approve, e.g. `NeuraX tickets 1/6: fix 14 titles (prefixes, jargon)`. Order: duplicates, titles, structure, then descriptions section by section. Keep no more than 3 batches waiting for approval at a time; check `pending` in your next run before queuing more.
5. To rewrite a description you must first read the ticket (`odoo task <id>`), the linked PRs and commits, and the Paperclip issue if one exists. Do not invent behaviour; if you cannot tell what "done" means, ask.
6. Never change a ticket's stage in a cleanup (stages follow the work), never delete, never touch timesheets.
7. Report on your issue: what each batch contains (with its proposal number) and the questions you could not answer.

## Proposal actions

```json
{"title": "NeuraX tickets 2/6: fix 3 titles", "actions": [
  {"type": "update_task", "task": 27688, "name": "181: Bidding: cap bids and anti-snipe extensions, send no-card winners to the declined-card flow"},
  {"type": "update_task", "task": 27717, "archive": true},
  {"type": "note", "task": 27717, "body": "Duplicate of Ticket#181 (same work). Archived during ticket cleanup."},
  {"type": "update_task", "task": 28309, "parent": 27749, "milestone": "M7 - Live Video and Chat"},
  {"type": "update_task", "task": 28309, "description": "## Description\nSellers can only use their own uploaded image as a stream cover...\n\n## Done when\n- ...\n\n## Technical notes\n- neurax-backend 81fa66d"}
]}
```
If the board limits a cleanup to tickets created by one person, add `"only_creator": "<their Odoo user name>"` at the top level of every proposal (next to `title`). The bridge then refuses the whole proposal, before writing anything, if any ticket in it was created by someone else. Check `creator` in `odoo tasks --full` before adding a ticket.

`update_task` fields: `name`, `description` (Markdown), `parent` (task id), `milestone` (name or id), `archive: true` (reversible in Odoo), `show_in_project: true`, `assign_me: true`.
Write proposal files under `{{HERMES_STATE_WSL}}` and pass the Windows path (`{{HERMES_STATE_WIN}}\<file>.json`) to `propose`.
