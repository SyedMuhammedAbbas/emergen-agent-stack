---
name: test-integrity
description: Rules that make tests prove something - tests written from the requirement, proof that each new test fails when the behaviour breaks, mutation testing on changed code, banned test smells, and an independent reviewer. Use whenever you write, change, review or audit tests, in any project or tool.
---

# Test integrity

A test written by the same agent that wrote the code, after the code, by reading the code, tends to assert whatever the code already does. It passes, adds coverage, and catches nothing. Research on AI-written tests finds exactly this: assertions that mirror the implementation instead of checking the requirement (the "oracle problem"). Google and Meta answer it the same way: a test is trusted only once it has been shown to **fail** when the behaviour it guards is broken, which is what mutation testing measures.

Coverage is not evidence. "All tests pass" is not evidence. Evidence is a test that went red when the behaviour was broken and green when it was right.

## 1. Write tests from the requirement, not from the code

- Before reading the implementation, list the ticket's acceptance criteria and edge cases (Odoo ticket, PRD, Paperclip issue). Each test names the criterion it checks: `rejects a 6th consecutive raise by the same buyer`, not `should work` or `handles bid`.
- Expected values come from the requirement or are worked out by hand, never by running the code and copying its output.
- Assert on what a user or caller can observe: HTTP status and body, rows in the database, events emitted, text on screen, money amounts. Not on private helpers or how many times a mock was called, unless the call itself is the requirement (e.g. "Stripe is charged exactly once").
- Mock only what you do not own and cannot run (Stripe, email, push). Never mock the unit under test or the database layer the ticket is about; use the integration test setup for those.

## 2. Prove every new test can fail (mandatory)

For every test you add or change, show it red before you show it green:

- **Bug fix:** run the new test on the code *before* your fix (`git stash` the fix, or check out the parent commit in your worktree) and capture the failure; then on the fix and capture the pass.
- **New behaviour:** break the behaviour on purpose (flip the condition, remove the check, change the limit from 5 to 6), run the test, capture the failure, restore.
- Paste both outputs, trimmed to the relevant lines, in the PR under **"Proof the tests can fail"**. A PR without it is not ready for review.

If you cannot make a test fail by breaking the behaviour it claims to check, the test is wrong: fix or delete it.

## 3. Mutation testing on changed code (TypeScript repos)

Where the repo has Stryker set up (`@stryker-mutator/core` plus the runner for its test framework, e.g. `@stryker-mutator/vitest-runner`), run it on the files you changed only:

```bash
npx stryker run --incremental --mutate "src/<changed files>"
```

- Every **surviving mutant on a line you changed** is either killed by a new or stronger test, or explained in the PR (equivalent mutant, logging only). List them under "Proof the tests can fail".
- Report the mutation score for the changed files. Do not chase 100% on untouched code.
- If Stryker is not set up in the repo, do not add it yourself: it is a new tool and goes through the `tool-vetting` skill and the board. Do the manual break-it check from section 2 instead.

For Flutter/Dart, use the manual break-it check from section 2 on every behaviour you changed.

## 4. Banned test patterns

Never write, and in review always reject:
- tests without an assertion, or asserting only `toBeDefined()`, `toBeTruthy()` or "does not throw" when the requirement is a specific result;
- assertions that recompute the expected value with the same logic as the code under test;
- snapshot-only tests for behaviour (snapshots are for stable markup a person reviewed);
- mocking the unit under test, or asserting that a mock returned what the test told it to return;
- `try/catch` that swallows a failure, `.skip`, `.only`, `xit`, raised timeouts to hide flakiness, sleeps instead of waiting for a condition;
- loosening an assertion, changing an expected value or deleting a test to make a failing suite pass. A failing test is a finding: either the code is wrong or the requirement changed. If the requirement changed, name the ticket or decision that changed it in the PR, and get the reviewer's agreement.

## 5. The author does not grade itself

- The engineer writes the tests and the proofs above. The **reviewer (QA)** does not trust them: for each acceptance criterion, QA names the test that would fail if it broke, and checks the "Proof the tests can fail" section. Missing proof, or a criterion with no test that fails when it breaks = FAIL.
- For money, auth, permissions, bidding and anything the ticket marks risky, QA writes at least one test of its own from the ticket **before reading the implementation**, and runs it.
- QA's device or browser check on staging stays mandatory for Odoo tickets; unit tests never replace it.

## 6. Auditing an existing suite

When asked whether a suite is useful:
1. Pick the modules that matter most (money, auth, bidding, permissions, data integrity).
2. Run mutation testing on them (or the manual break-it check where it is not set up); record the score per module and the surviving mutants.
3. Classify tests: **protective** (fails when the behaviour breaks), **weak** (passes with the behaviour broken), **noise** (asserts nothing meaningful, duplicates another, tests a mock). Give file:line for each weak or noise test.
4. Propose: strengthen weak tests, delete noise (list them; deleting tests needs the board's approval), add tests for surviving mutants on critical paths. Never rewrite a whole suite in one PR.
5. Report before and after: mutation score per module, test count, suite run time.

## Sources
- Google, "Practical Mutation Testing at Scale" and "State of Mutation Testing at Google" (research.google): mutants on changed code shown in code review, used by thousands of engineers.
- Meta, "Mutation-Guided LLM-based Test Generation at Meta" (FSE 2025, arXiv 2501.12862): each generated test must kill a specific mutant, so it is proven to catch a fault.
- StrykerJS documentation (stryker-mutator.io/docs/stryker-js/incremental): incremental mutation testing on changed code.
