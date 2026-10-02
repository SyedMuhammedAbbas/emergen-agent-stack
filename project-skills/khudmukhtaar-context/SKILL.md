---
name: khudmukhtaar-context
description: Project context for Khudmukhtaar (online courses platform for women in Pakistan; Paperclip project Khudmukhtaar). Load for ANY Khudmukhtaar work - website, course pages, enrollment and Google Sheets, backend API, admin, milestones, deploys, client approvals.
---

# Khudmukhtaar project context

Online learning platform for Khudmukhtaar (founder Tehreem Ranjha, Lahore). Emergen is the agency.
The full, maintained guide is **`/mnt/d/Projects/Emergen/khudmukhtaar/AGENTS.md`** - read it first; do not copy it.

## Where things live
| Topic | Read |
|---|---|
| Folders, stacks, ports, environments, decisions, open items | `/mnt/d/Projects/Emergen/khudmukhtaar/AGENTS.md` |
| Live public website (Next.js 14) | `/mnt/d/Projects/Emergen/khudmukhtaar/KhudMukhtaar-Frontend` (base branch `staging`; prod `main`) |
| Frontend code layout rules | `KhudMukhtaar-Frontend/src/STRUCTURE.md` |
| Course page content model | `KhudMukhtaar-Frontend/src/modules/programs/config/course-details.ts` |
| Enrollment -> Google Sheet | `src/app/api/enrollments/route.ts`, `src/shared/lib/google-sheets.ts` |
| Platform API (NestJS, Postgres, Redis) | `/mnt/d/Projects/Emergen/khudmukhtaar/backend` (README.md for local setup; API on :4000) |
| Copy (source of truth) | Google Doc "Website Content KM" (link in AGENTS.md) |
| Design (layout only) | Figma file RxMuorta3iCApOWAZ2XHuN, frames "Landing page" and "Course Detail" |
| Milestones and hours | Google Sheet "Khudmukhtaar \| Milestones & Hours" (link in AGENTS.md) |

## Current state (1 Oct 2026)
- Milestone 1 done (22-30 Sep, 56 h): website UI, course detail pages, Google Sheet integration. Live on
  staging https://khudmukhtarstaging.vercel.app ; production deploy pending.
- Milestone 2 due 30 Oct 2026 (233 h): programs and batches, accounts and access, course content, release
  schedule, student portal, minimum admin, website live batch data, QA and release. One Paperclip issue each.

## Rules
- Work in your own worktree off `staging`; never edit the repos in place; never commit `.env*` or secrets.
- Frontend: `npm run typecheck` and `npm run lint` must pass before handoff.
- Never deploy to production, write to the production Google Sheet or contact the client without board approval.
- Client-facing text: plain English, no em dashes, no AI mentions, no internal costs.
