# Performance Standard

## Frontend

Consider:
- image optimization;
- bundle size;
- lazy loading;
- code splitting;
- server/client boundary;
- caching;
- unnecessary re-renders;
- virtualization for large lists.

## Backend

Consider:
- query efficiency;
- indexes;
- N+1;
- connection pooling;
- pagination;
- caching;
- queues/background jobs;
- rate limiting.

## Database

Measure important queries.
Use query plans for slow queries.
Avoid unbounded queries.
Avoid long transactions.

## Caching

For every cache define:
- key;
- TTL;
- invalidation;
- stale behavior;
- ownership.

Never cache sensitive dynamic data incorrectly.

## Load

Distinguish:
- normal load;
- peak load;
- stress;
- soak.

Watch for:
- memory leaks;
- connection leaks;
- queue buildup;
- lock contention;
- database exhaustion.

## Performance budgets

Where appropriate define:
- page weight;
- API latency;
- P95/P99 targets;
- query latency;
- resource limits.

Measure before optimizing where practical.
