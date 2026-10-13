---
name: project-estimation
description: Turn a client's requirements into a project folder and an estimation Excel workbook under {{PROJECTS_ROOT_WINDOWS}}\<category>. Use when the owner shares a new client's requirements or asks for a project estimate.
---

# Project Estimation

Input: client requirements (text, attachments, links) from the owner. Output: a project folder with the requirements saved and an estimation `.xlsx`, then a summary for the owner.

## Step 1: Ask where it belongs (always, before writing anything)

Ask the owner and **wait for the answer**. Do not guess, even if the name looks personal or client-like:

> Which category is **<project name>**: {{PROJECT_CATEGORIES}}?
> Reply with the category, and confirm the folder name `<kebab-case-name>` (or give a different one).

Continue only after the owner answers.

## Step 2: Create the folder

The folder is `{{PROJECTS_ROOT}}/<category>/<name>/` (WSL path; on Windows that is `{{PROJECTS_ROOT_WINDOWS}}\<category>\<name>\`). Use the category exactly as the owner spelled it from the list above; if the answer isn't one of them, ask again.

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
- Platforms and stack (default: {{STACK}}, following `{{ENGINEERING_SKILL}}`) and integrations.
- Non-functional needs: performance, security, compliance, hosting, languages.
- **Open questions** for the client: every ambiguity, missing detail, or assumption.
- Out of scope: anything mentioned but not committed.

## Step 4: Build the workbook (use the `xlsx` skill, openpyxl, real formulas)

Sheets:
1. **Summary**: project, client, date, stack, total hours (formula), timeline in weeks (formula: hours / (team size x 30 productive h/week)), cost (formula: hours x rate cell), assumptions count, open questions count. Rate and team size are input cells highlighted yellow and left blank or 0 for the owner to fill.
2. **Breakdown**: columns `Module | Feature | Explicit/Assumed | Frontend h | Backend h | DevOps h | QA h | Design/UX h | Total h (formula) | Confidence (H/M/L) | Notes`. One row per feature. Subtotals per module with SUM formulas.
3. **Phases / Milestones**: milestone, included features, hours (SUMIF on Breakdown), target week.
4. **Assumptions**: numbered.
5. **Open Questions**: numbered, with the feature each one affects.
6. **Risks**: risk, impact, mitigation, contingency hours.

Rules:
- Estimate in hours per role, including testing, code review, and project setup/deployment rows. Add a contingency row (default 15%, formula) that the owner can change.
- Every total is an Excel formula, never a hard-coded number.
- Low-confidence rows are highlighted and explained in Notes.
- Follow `no-slop` in every cell: no em dashes, no filler.
- After saving, reopen the file with openpyxl and verify sheet names, row counts and that totals are formulas.

## Step 5: Report

Report to the owner: the folder path (Windows form, `{{PROJECTS_ROOT_WINDOWS}}\<category>\<name>\`), total hours range, top 5 open questions, and top 3 risks. Ask the owner to review and approve the estimate. Do not create implementation tickets until the estimate is approved.
