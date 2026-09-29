# Testing Standard

## Official references

- NestJS Testing: https://docs.nestjs.com/fundamentals/testing
- React Testing: https://react.dev/learn/testing
- React Native Testing: https://reactnative.dev/docs/testing-overview
- Flutter Testing: https://docs.flutter.dev/testing
- Grafana k6: https://grafana.com/docs/k6/latest/

Detailed link index: `references/testing.md`, `references/k6.md`

## Test pyramid

Use the appropriate combination of:
1. static checks;
2. unit tests;
3. integration tests;
4. E2E tests;
5. load/performance tests for relevant systems.

## Unit

Prioritize:
- business rules;
- calculations;
- validation;
- utilities;
- services;
- edge cases.

## Integration

Test meaningful boundaries:
- API + database;
- repositories;
- authentication;
- external integration adapters where practical.

## E2E

Cover critical user journeys:
- authentication;
- booking/order creation;
- payment;
- critical admin actions;
- important destructive workflows.

## Coverage

Do not target 100% merely for the number.
Prioritize high coverage of critical business logic and failure modes.

## Regression

Every bug fix should consider a regression test.

## Test quality

Tests must assert behavior, not implementation details unnecessarily.

Do not:
- delete tests to make builds pass;
- weaken assertions without reason;
- mock everything so heavily that integration failures are hidden.

## Load testing

For production systems, define expected traffic and test:
- throughput;
- latency;
- P95/P99;
- error rate;
- CPU;
- memory;
- DB connections;
- DB latency;
- queue behavior.

Use a suitable load-testing tool such as k6 or Artillery when applicable.

## CI

At minimum:
- install;
- type check;
- lint;
- tests;
- build.

Add integration/E2E/security checks according to project risk.
