## Always
- Load and follow the `no-slop` skill: no hallucinated APIs, files or results; no em dashes; no filler or AI tone in code, comments, commits, PRs or docs.
- Load `verification-before-completion`: never claim done, fixed or passing without running the command in this run and quoting the result.
- Run long commands (builds, `flutter analyze`, test suites) in the **foreground** with a generous timeout and wait for the result. If one can take longer than your command time limit, start it with output to a log file, then keep checking it with foreground commands (`sleep 240; tail -5 <log>`) until it exits. Never end a run while a command is still running: a run that ends without a verdict or summary leaves the task stuck.
- **Test only what proves your step; never repeat a passed gate.** Full suites are slow here (backend ~15 min, Flutter analyze + tests ~20 min over the WSL bridge). The engineer runs the full gate once before `in_review`. Reviewers run the tests for the changed files and their direct dependents (`pnpm vitest related <files>`, `flutter test <test files>`), plus the full suite only when the PR touches shared core, migrations, auth or payments. If a gate already passed on the same commit, cite that run instead of re-running it. Docs/config-only changes need no test run.
- Never install anything new (package, CLI, script, extension, MCP server, skill) without the `tool-vetting` checklist and the board's yes; never pipe a script from the internet into a shell.
- Never set a git identity: no `git config user.name/user.email` (global or local), no `git -c user.*`, no `--author`, no `GIT_AUTHOR_*`/`GIT_COMMITTER_*` variables. Commits use the owner's identity already configured. If a commit fails for a missing identity, ask the board.
- Never run `git worktree prune`, and never delete worktrees, branches or files you did not create: the owner's own worktrees live next to yours.
- If requirements are unclear, ask instead of guessing: post a comment that starts with `**Question for board:**` (Hermes relays it to Discord), set the issue to `blocked`, and end the run. Continue when a `**Board answer:**` comment arrives.
- The owner reads that question on a phone in Discord, without the issue open. Write it for a busy person, not an engineer:
  ```
  **Question for board:** <one sentence: what you need the owner to decide or do, in plain words>
  - Why: <one line on what is blocked and why it matters>
  - Options: A) <...> B) <...>. I recommend A because <...>.
  - After your answer I will: <one line>
  ```
  At most 6 lines. Name tickets as Ticket#<n> and features by what the user sees ("Remind Me button", not `reminder_notifier.dart`). No ids, hashes, file paths, API routes, env vars or error codes in the question; put technical detail in the rest of the comment, after the question block. One question per comment; for several decisions, number them 1., 2.
