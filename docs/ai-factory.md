# The AI factory (owner's contract)

Since 2026-10-13 the factory is native to Claude Code. Paperclip (agent orchestrator) and OmniRoute (LLM router) are gone; Hermes stays for Odoo tickets and Discord.

## Contract

- **One entry point:** Claude Desktop / Claude Code chat. No mandatory factory command, dashboard, ticket, BRD/TRD or lifecycle.
- **Per request:** detect the project and repo; understand the request and existing context; decide direct vs delegate; invoke only the agents needed; execute; validate; report in the session. Telemetry is recorded by hooks automatically.
- **Simple tasks:** the main session, no agents. **Complex tasks:** delegate only the relevant parts.
- **No docs, tickets or plans** unless asked or genuinely needed.
- **Minimal specialists:** Engineering, Code Review, QA, Documentation, Security Review (only when relevant). The main session coordinates; there is no permanent manager or CTO agent.
- **Tickets:** Hermes owns Odoo tickets and Discord. "Check ticket status" or "work on ticket #123": get the ticket context through Hermes/Odoo read-only, implement, report. Odoo changes are queued as proposals and approved in Discord (`approve N`).
- **Approvals** only for protected ticket-stage moves, merges to staging/production, destructive operations, sensitive infrastructure changes and other configured protected actions. A PreToolUse hook enforces them.
- **Existing projects:** read their instructions and conventions, respect the architecture, never regenerate PRDs/TRDs, never reset the setup, no duplicate PM systems, continue from the current state.
- **New projects:** ask only the essential missing facts, initialise the requested stack, docs only when requested or needed, no onboarding workflow.
- **Token efficiency:** spawn as few agents as possible, reuse context, avoid full-repo reads, work from relevant files and diffs, pick models by complexity (Opus 5.5 by default, Fable only for genuinely hard or high-risk work, never by default), set sensible limits.
- **Optional `/factory`** workflow for larger features only.

## Where each part lives

| Part | Source in this repo | Installed to |
|---|---|---|
| Global rules | `org/_global/CLAUDE.md` | `~/.claude/CLAUDE.md` and `~/.claude-personal/CLAUDE.md` |
| Subagents `engineer`, `code-reviewer`, `qa`, `docs`, `security-reviewer` | `org/_agents/*.md` | `~/.claude/agents/` (`~/.claude-personal/agents` is a junction to it) |
| Role standards (`role-backend`, `role-qa`, ...) | `org/<dept>/*.md` + partials | `~/.claude/skills/role-*` |
| `/factory` workflow | `skills/factory/SKILL.md` | `~/.claude/skills/factory` |
| Hermes bridge | `hermes/`, `windows/hermes-bridge.ps1` | `%LOCALAPPDATA%\hermes` |

Agents hand off through one reply each whose first line is machine-checkable: `STATUS: READY | BLOCKED` for builders, `VERDICT: PASS | CHANGES` for reviewers. Rework is bounded to two resumes of the same engineer, then the owner decides. Agents never merge.

## Re-installing

After editing any source above: `.\install.ps1 -OnlyOrg` (Windows), or in WSL `bash wsl/60-sync-skills.sh` (`--dry-run` to preview). It renders and installs skills, role skills, subagents and both CLAUDE.md files, and never overwrites a CLAUDE.md it did not generate.
