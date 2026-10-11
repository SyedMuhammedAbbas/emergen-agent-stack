# 7. Product UI/UX plan

Principles: **one screen answers "is everything fine, what is it costing, what needs me?"**; choices not commands; every change shows a preview before it happens; every risky action is undoable; works at 360 px to 1920 px (the wizard's responsive rules and layout audit are reused).

## 7.1 Information architecture

| Screen | Job | Notes |
|---|---|---|
| **Home** | Health, spend this month vs budget, items waiting on you (approvals, questions, conflicts), recent activity | Single place to open each day |
| **Workspaces** | List and switch (company / personal); create from template or from description | Onboarding lives here |
| **Team** (company) | Org chart, each agent: status, last run, cost, schedule; edit instructions with drift/conflict markers | Reads Paperclip; links out to Paperclip for task detail rather than rebuilding it |
| **Workflows** | The routine-level steps from doc 05.8 as a vertical flow with gates; run history | Graph editor is later, not MVP |
| **Tools** | Installed tools, enable/disable, permission per tool, last runs, undo | Includes Downloads organiser |
| **Integrations** | Connect/disconnect (Upwork, GitHub, Odoo, Discord), per-tool allow/ask/off | Secrets never displayed |
| **Models** | The two routing paths, tiers, providers, spend by model, health | Shows jev-router live view and OmniRoute status |
| **Activity** | One timeline: runs, decisions, approvals, tool actions, with filter and "undo" where available | Reads Paperclip + our logs |
| **Services** | Installed services, versions, start/stop/update/doctor, disk and RAM | Replaces `install.ps1` flags for day-to-day |
| **Settings** | Backups, paths, notifications, advanced (raw `config.env`) | |

## 7.2 Onboarding flow

1. **Welcome:** "What do you want help with?" Two cards (Run a company / Organise my own stuff) and a free-text box.
2. **Describe:** free text or guided form; the app echoes back what it understood and lists its **unknowns as questions**.
3. **Proposal:** one page showing team, tools, services to install, monthly cost range, and what will *not* happen without approval. Each item has a switch.
4. **Connect:** only the integrations the proposal needs, one at a time; each opens the provider's own sign-in.
5. **Apply:** progress by step with the journal; failure shows the failing step, what is already done, and a Roll back button.
6. **Done:** Home screen with the first suggested action.

## 7.3 Business and personal modes

Same shell, different defaults. Personal hides Team/Workflows, shows Tools and Assistants; company shows all. One user can have both workspaces and switch from the header.

## 7.4 Core interactions

- **Preview, confirm, undo** component used everywhere a tool or reconciler changes things (list of moves/edits, counts, a single Confirm, then a "Undo" for 30 days from the recovery folder).
- **Drift and conflict panel:** side-by-side live vs template with "Keep mine / Take template / Merge".
- **Cost panel:** spend this month, projection, idle cost of each schedule before it is turned on.
- **Approvals inbox:** the same items Discord receives; approve in either place.
- **Doctor:** one button that runs service checks and lists fixes with a "Fix it" for safe ones (e.g. restart, rewrite a drop-in), confirmation for others.

## 7.5 Accessibility and responsiveness

Keyboard reachable everywhere, visible focus, contrast checked in the audit script, reduced-motion respected, no horizontal scroll from 360 px up, long names wrap, tables collapse to cards under 640 px. The existing `tools/setup-wizard/dev/ui-audit.js` is extended to run on every screen in CI.

## 7.6 Visual direction

Calm and operational rather than playful: neutral surfaces, one accent, status colours only for status, system font stack plus a monospace for ids and logs. The pixel-crab theme stays inside the Claude Code mod (the "paperclip-crew" mini-bots); the app itself should not imitate it. Dark mode from the start (CSS variables).

## 7.7 Not in the MVP

Visual workflow canvas, in-app chat with agents (use Paperclip or Claude Code), template marketplace, multi-user accounts, mobile app. Remote access is deferred; the daemon binds to loopback only.
