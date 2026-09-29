---
name: emergen-project-estimation
description: Turn a client's requirements into a project folder and an estimation Excel workbook under D:\Projects\Emergen or D:\Projects\Personal. Use when a new project / client requirements issue is assigned.
---

# Emergen Project Estimation

Input: an issue containing client requirements (text, attachments, links). Output: a project folder with the requirements saved and an estimation `.xlsx`, then a summary for the board.

## Step 1: Ask where it belongs (always, before writing anything)

Post on the issue and **wait for the board's answer**. Do not guess, even if the name looks personal or client-like. The comment must start with `**Question for board:**` so Hermes relays it to Discord:

> **Question for board:** Is **<project name>** an Emergen client project or a personal project?
> Reply `emergen` or `personal`, and confirm the folder name `<kebab-case-name>` (or give a different one).

Set the issue to `blocked` and stop the run. Continue only when a `**Board answer:**` comment (or any board user reply) arrives.

## Step 2: Create the folder

WSL paths (the D: drive is mounted at `/mnt/d`):

| Answer | Folder |
|---|---|
| emergen | `/mnt/d/Projects/Emergen/<name>/` |
| personal | `/mnt/d/Projects/Personal/<name>/` |

If the folder already exists, do not overwrite anything: put new files in `<folder>/estimation/` with a date suffix. Create:

```
<folder>/requirements/requirements.md      # client text verbatim + attachment links, untouched
<folder>/requirements/understanding.md     # your structured reading of it (see step 3)
<folder>/estimation/<name>-estimation-YYYY-MM-DD.xlsx
```

## Step 3: Read the requirements cleanly

In `understanding.md`, with no invented features:
- Goals and target users, in the client's words where possible.
- Feature list grouped by module; each item tagged **explicit** (stated by client) or **assumed** (your inference, must be confirmed).
- Platforms and stack (default to the Emergen stack in `emergen-engineering`: Next.js, NestJS, PostgreSQL/TypeORM, React Native or Flutter) and integrations.
- Non-functional needs: performance, security, compliance, hosting, languages.
- **Open questions** for the client: every ambiguity, missing detail, or assumption.
- Out of scope: anything mentioned but not committed.

## Step 4: Build the workbook (use the `xlsx` skill, openpyxl, real formulas)

Sheets:
1. **Summary**: project, client, date, stack, total hours (formula), timeline in weeks (formula: hours / (team size x 30 productive h/week)), cost (formula: hours x rate cell), assumptions count, open questions count. Rate and team size are input cells highlighted yellow and left blank or 0 for the board to fill.
2. **Breakdown**: columns `Module | Feature | Explicit/Assumed | Frontend h | Backend h | DevOps h | QA h | Design/UX h | Total h (formula) | Confidence (H/M/L) | Notes`. One row per feature. Subtotals per module with SUM formulas.
3. **Phases / Milestones**: milestone, included features, hours (SUMIF on Breakdown), target week.
4. **Assumptions**: numbered.
5. **Open Questions**: numbered, with the feature each one affects.
6. **Risks**: risk, impact, mitigation, contingency hours.

Rules:
- Estimate in hours per role, including testing, code review, and project setup/deployment rows. Add a contingency row (default 15%, formula) that the board can change.
- Every total is an Excel formula, never a hard-coded number.
- Low-confidence rows are highlighted and explained in Notes.
- Follow `emergen-no-slop` in every cell: no em dashes, no filler.
- After saving, reopen the file with openpyxl and verify sheet names, row counts and that totals are formulas.

## Step 5: Report

Post one comment on the issue: the folder path (Windows form, e.g. `D:\Projects\Emergen\<name>\`), total hours range, top 5 open questions, and top 3 risks. Then create a Paperclip approval request to the board to review the estimate. Do not create implementation issues until the estimate is approved.
