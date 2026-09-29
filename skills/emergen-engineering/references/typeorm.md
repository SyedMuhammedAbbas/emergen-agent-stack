# TypeORM Official References

## Primary documentation

- **TypeORM Docs**: https://typeorm.io/
- **TypeORM Entities**: https://typeorm.io/entities
- **TypeORM Migrations**: https://typeorm.io/migrations
- **TypeORM Relations**: https://typeorm.io/relations
- **TypeORM Transactions**: https://typeorm.io/transactions
- **TypeORM Data Source Options**: https://typeorm.io/data-source-options

## Critical production rule

TypeORM recommends migrations for production schema changes. Do not use `synchronize: true` in production.

## Emergen application

Require:

- `synchronize: false` in production;
- every schema change via migration;
- migrations committed to version control;
- reviewed migrations before production execution.

Follow official TypeORM guidance for entities, relations, queries, and transactions.
