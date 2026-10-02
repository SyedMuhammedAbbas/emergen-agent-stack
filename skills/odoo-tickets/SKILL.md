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
- Section and milestone task names are unique in the project; never give two sections the same name (`Security Hardening: sign-in and staff accounts`, not four `Security Hardening`).
- A section (parent) task is named for the area of the product, e.g. `Checkout & Payment Methods`; a milestone task is `M<n> - <name>` matching the Odoo milestone.

## Descriptions

Every ticket has a description a person outside engineering can follow: the client, a new QA engineer, a project manager. The bar is how well-run product teams write tickets: the first lines say what and why, the reader knows exactly how to check it, and engineering detail is at the bottom. Write in simple Markdown (`## Heading`, `- bullet`, `1. step`, blank line between paragraphs); the bridge converts it to Odoo formatting.

Rules for every description:
- **Lead with the outcome** in one or two sentences a non-engineer understands. Name the screen and the type of user (buyer, seller, admin).
- **Plain words.** Explain any term a client would not know the first time it appears. No internal codes, env vars or file paths outside Technical notes.
- **Testable.** "Acceptance criteria" are checks a person can do on staging and see pass or fail; never "code is merged" or "tests pass".
- **Scope is explicit.** Say what is not included when it could be assumed.
- **Short.** Most tickets fit on one screen. Bullets over paragraphs.
- **Current.** When the plan changes, update the description, not just the chat.

**Bug**:
```
## Summary
<Where it happens and what goes wrong, as the user sees it. One or two sentences.>

## Impact
<Who is affected and how badly: blocks a sale, wrong money, cosmetic. Rough frequency.>

## Environment
<Staging / production, app build or dashboard version, device or browser.>

## Steps to Reproduce
1. ...

## Expected Result
...

## Actual Result
...

## Evidence
<Screenshots or recording attached, or "see note of <date>".>

## Technical notes
<Root cause once known, repos, PRs, commits. Last, and short.>
```
Tickets written by the QA engineer already follow their own Description / Steps / Expected / Actual layout; leave them as they are.

**Feature or task**:
```
## Summary
<What this adds or changes, for whom, in plain words.>

## Why
<The problem it solves or the requirement (PRD section) it meets.>

## Scope
- In: ...
- Out: <what someone might assume is included but is not>

## Acceptance criteria
- <Check a person can do on staging, e.g. "On the dashboard, Failed Payments > Abandon closes the sale and puts the item back in stock without listing it again.">

## Dependencies
<Other tickets or decisions this waits on, or "None".>

## Technical notes
<Repos, PRs, commits, decisions (ADR links).>
```

**Milestone and section tasks** (parents): a short Summary of what the milestone or area covers and its goal, and the status in one line. Their sub-tasks carry the detail.

A description that is only a commit list, or is empty, is not acceptable. Commits and PR links go under Technical notes.

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
4. Every ticket in scope ends the cleanup with a description in the layout above, including section and milestone tasks.
5. Propose in **batches of at most 20 changes, one group per batch**, titled so the owner knows what they approve, e.g. `NeuraX tickets 1/6: fix 14 titles (prefixes, jargon)`. Order: duplicates, titles, structure, then descriptions section by section. Keep no more than 3 batches waiting for approval at a time; check `pending` in your next run before queuing more.
6. To rewrite a description you must first read the ticket (`odoo task <id>`), the linked PRs and commits, and the Paperclip issue if one exists. Do not invent behaviour; if you cannot tell what "done" means, ask.
7. Never change a ticket's stage in a cleanup (stages follow the work), never delete, never touch timesheets.
8. Report on your issue: what each batch contains (with its proposal number) and the questions you could not answer.

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
