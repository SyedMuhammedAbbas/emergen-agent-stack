# Third-party skills

The agents use these skills, but they are **not committed** here: they belong to their authors and some licenses forbid redistribution. `windows/collect-skills.ps1` finds them in your local Claude / `skills` installs and copies them to `SKILLS_SOURCE`; `wsl/40-org.sh` then imports them into Paperclip. Anything missing is reported and skipped (the agent still works, without that skill).

| Skill | Used by | Source |
|---|---|---|
| verification-before-completion, test-driven-development, systematic-debugging, writing-plans, receiving-code-review | all / engineers / QA | Superpowers plugin (Claude Code: `claude-plugins-official/superpowers`) |
| code-review, deploy-checklist, testing-strategy, architecture, system-design, incident-response | engineers, QA, CTO | Claude "engineering" plugin |
| accessibility-review, design-critique, ux-copy | Frontend, QA, UX Reviewer, Docs | Claude "design" plugin |
| xlsx | Estimator | Claude app built-in (`anthropic-skills:xlsx`). Proprietary license, never commit it |
| vercel-react-best-practices, vercel-react-native-skills | Frontend | github.com/vercel-labs/agent-skills (MIT) |
| next-best-practices | Frontend | github.com/vercel-labs/next-skills |
| documentation-writer | Docs | github.com/github/awesome-copilot |
| apple-design | Frontend, UX Reviewer | github.com/emilkowalski/skills |
| ui-ux-pro-max | Frontend, UX Reviewer | installed in `~/.claude/skills`; source not recorded on this machine |
| paperclip, paperclip-converting-plans-to-tasks | all / Manager | ship with Paperclip, nothing to install |

Emergen's own skills (`emergen-engineering`, `emergen-no-slop`, `emergen-delivery-gate`, `emergen-project-estimation`) live in this folder and always take precedence over a same-named folder in `SKILLS_SOURCE`.
