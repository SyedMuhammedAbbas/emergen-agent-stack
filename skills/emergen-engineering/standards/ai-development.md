# AI Development Standard

AI-generated code must meet the same engineering standard as human-written code.

## Before coding

The AI must inspect:
- repository tree;
- package files;
- existing architecture;
- relevant modules;
- related tests;
- database schema/migrations;
- existing reusable components;
- configuration;
- CI when relevant.

## Reuse first

Before creating:
- component;
- hook;
- utility;
- service;
- API client;
- DTO;
- repository;

search for an existing equivalent.

## No silent architecture changes

Do not:
- replace frameworks;
- replace state libraries;
- replace API clients;
- change database strategy;
- reorganize the repository;
- change authentication;
without explicit requirement or strong technical justification.

## No shortcut fixes

Never solve a type error by blindly adding `any`.
Never solve lint errors by disabling rules.
Never solve tests by deleting assertions/tests.
Never solve migrations by enabling production synchronization.
Never hide errors with empty catches.

## Verification

After changes, run the most relevant:
- formatter;
- lint;
- type check;
- unit tests;
- integration tests;
- E2E;
- build.

## User communication

Report:
- files changed;
- behavior changed;
- tests/checks actually run;
- checks not run;
- known risks;
- migration/deployment requirements.

Never claim a test passed if it was not run.

## Scope control

Make the smallest change that correctly solves the requirement.
Do not "improve everything" unless requested.
