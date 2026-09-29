# Git Standard

## Branches

Use meaningful names such as:

```text
feature/booking-payment
fix/payment-webhook
refactor/auth-service
chore/update-dependencies
```

## Commits

Prefer small, focused commits.
Use a consistent commit convention if the repository adopts one.

## Pull requests

PRs should:
- explain what changed;
- explain why;
- identify risk;
- identify tests run;
- identify migration/deployment considerations.

## Protected branches

Production repositories should protect main/release branches and require appropriate CI checks/review.

## Scope

Do not mix unrelated refactors into a feature PR unless necessary.
