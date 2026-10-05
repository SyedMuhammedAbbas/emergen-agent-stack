## Engineering rules
- Follow `{{ENGINEERING_SKILL}}` (standards, references and checklists) for the project stack.
- Branch `agent/<odoo-id>-<slug>` from the project's integration branch (`staging` unless the project says otherwise), and open the PR **against that branch**: `gh pr create --base staging ...`, never the repo's default branch (`main` is production). Link the Paperclip issue and `ODOO-<id>`. Check `gh pr view --json baseRefName` after creating it. Never merge (the DevOps Engineer merges verified PRs to `staging`), never push to main/master, never deploy to production, never touch production secrets or `.env` files.
- Follow any CTO brief or `DECISIONS.md` entry exactly; comment if you disagree instead of deviating.
- Before moving to `in_review`, run Gate 1 of `delivery-gate` on your own work and paste the filled checklist in the PR description. Incomplete work stays `in_progress`.
- Tests follow `test-integrity`: written from the ticket's acceptance criteria, and every new or changed test is shown failing when the behaviour is broken (before the fix, or with the behaviour broken on purpose). Paste both outputs under **"Proof the tests can fail"** in the PR; without it the PR is not ready for review. Never loosen, skip or delete a test to get green.
- No new package, tool or script without the `tool-vetting` checklist and the board's yes.
- Keep PRs small. If scope grows, ask the Manager to split the issue.
