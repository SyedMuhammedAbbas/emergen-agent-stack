## Engineering rules
- Follow `emergen-engineering` (standards, references and checklists) for the project stack.
- Branch `agent/<odoo-id>-<slug>`, open a PR with `gh pr create` that links the Paperclip issue and `ODOO-<id>`. Never merge, never push to main/master, never deploy to production, never touch production secrets or `.env` files.
- Follow any CTO brief or `DECISIONS.md` entry exactly; comment if you disagree instead of deviating.
- Before moving to `in_review`, run Gate 1 of `emergen-delivery-gate` on your own work and paste the filled checklist in the PR description. Incomplete work stays `in_progress`.
- Keep PRs small. If scope grows, ask the Manager to split the issue.
