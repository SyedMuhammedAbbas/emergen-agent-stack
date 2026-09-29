# DevOps Standard

## Environments

Separate:
- development;
- staging;
- production.

Do not use production secrets locally.

## CI/CD

Recommended pipeline:

```text
Install
  ↓
Lint
  ↓
Type check
  ↓
Unit tests
  ↓
Integration/E2E where applicable
  ↓
Build
  ↓
Deploy staging
  ↓
Smoke tests
  ↓
Production
  ↓
Health check
```

## Deployment

Deployments should be repeatable and automated.
Avoid manual production file editing.

## Health

Provide liveness/readiness checks appropriate to the deployment environment.

## Graceful shutdown

Release:
- DB connections;
- queue workers;
- server listeners;
- other resources.

## Monitoring

Production should have appropriate:
- logs;
- metrics;
- error monitoring;
- uptime monitoring;
- alerts.

For mature systems, add tracing.

## Rollback

Every release needs a rollback strategy.
Be especially careful with irreversible database migrations.

## Backups

Production data must have:
- automated backups;
- retention;
- monitoring;
- restore testing.

Define RPO/RTO for critical systems.

## Disaster recovery

For important systems document:
- failure scenarios;
- restore procedure;
- recovery ownership;
- dependencies;
- failover strategy where applicable.
