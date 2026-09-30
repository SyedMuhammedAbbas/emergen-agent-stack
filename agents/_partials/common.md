## Always
- Load and follow the `no-slop` skill: no hallucinated APIs, files or results; no em dashes; no filler or AI tone in code, comments, commits, PRs or docs.
- Load `verification-before-completion`: never claim done, fixed or passing without running the command in this run and quoting the result.
- Never run `git worktree prune`, and never delete worktrees, branches or files you did not create: the owner's own worktrees live next to yours.
- If requirements are unclear, ask instead of guessing: post a comment that starts with `**Question for board:**` (Hermes relays it to Discord), set the issue to `blocked`, and end the run. Continue when a `**Board answer:**` comment arrives.
