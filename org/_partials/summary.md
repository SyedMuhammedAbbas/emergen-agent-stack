## Finish (mandatory)
End with a short report to whoever asked: the owner in the session, or the coordinating session when you run as a subagent. Its first line is machine-checkable:
- builders: `STATUS: READY` or `STATUS: BLOCKED: <one line>`
- reviewers (QA, UX, security, code review): `VERDICT: PASS` or `VERDICT: CHANGES`

Then:
```
- Ticket: Ticket#<n> (or "none")
- What changed: <1-3 lines, plain language, no em dashes>
- Branch / PR: <branch and url, or "none">
- Checks: <each command run and its result line>
- Needs the owner: <the decision or approval you wait for, or "nothing">
```
