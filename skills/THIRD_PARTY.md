# Skills: sources and licenses

All skills live in this repo and `wsl/60-sync-skills.sh` installs them for Paperclip, Claude Code (WSL and Windows) and each project folder, so every role works to the same standards whatever tool runs it.

- `skills/` general skills: this repo's own, plus vendored third-party skills.
- `../project-skills/` one context skill per project (mapped to its folder in `project-skills/projects.json`).
- `../agents/*.md` role standards, rendered as `role-<key>` skills by the sync script.

## Committed (ours, or permissive license)

| Skill | Used by | Source / license |
|---|---|---|
| no-slop, delivery-gate, project-estimation, daily-timesheets, qa-evidence, emergen-engineering (`ENGINEERING_SKILL`) | all roles | this repo |
| verification-before-completion, test-driven-development, systematic-debugging, writing-plans, receiving-code-review | all / engineers / QA | Superpowers (github.com/obra/superpowers), MIT |
| vercel-react-best-practices, vercel-react-native-skills | Frontend | github.com/vercel-labs/agent-skills, MIT |
| documentation-writer | Docs | github.com/github/awesome-copilot, MIT |
| design, design-system, banner-design | design work | MIT (in each SKILL.md) |
| ui-styling | Frontend, UX | MIT / Apache-2.0 (LICENSE.txt) |
| skill-creator | writing new skills | Anthropic, Apache-2.0 (LICENSE.txt) |

## Present locally, not committed (`skills/.gitignore`)

Installed on this machine and synced like the others, but kept out of git: proprietary, or no license recorded. On a new machine `windows/collect-skills.ps1` copies them from your local Claude / skills installs into `skills/`; anything missing is skipped (the agent works without it).

| Skill | Used by | Source |
|---|---|---|
| xlsx | Estimator | Claude app built-in (`anthropic-skills:xlsx`). **Proprietary, never commit** |
| code-review, deploy-checklist, testing-strategy, architecture, system-design, incident-response | engineers, QA, CTO | Claude "engineering" plugin |
| accessibility-review, design-critique, ux-copy | Frontend, QA, UX, Docs | Claude "design" plugin |
| next-best-practices | Frontend | github.com/vercel-labs/next-skills |
| apple-design | Frontend, UX | github.com/emilkowalski/skills |
| ui-ux-pro-max, brand, slides, find-skills | Frontend, UX, docs | local `~/.claude/skills`; source not recorded |
| paperclip, paperclip-converting-plans-to-tasks | all / Manager | ship with Paperclip, nothing to install |

This repo's skills always win over a same-named folder in `SKILLS_SOURCE` (optional extra folder, normally empty).
