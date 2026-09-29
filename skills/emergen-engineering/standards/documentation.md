# Documentation Standard

Production projects should document, as appropriate:

- setup;
- prerequisites;
- environment variables;
- local development;
- testing;
- build;
- deployment;
- database migrations;
- architecture;
- API usage;
- troubleshooting;
- important business rules.

## Recommended files

```text
README.md
.env.example
ARCHITECTURE.md
CONTRIBUTING.md
```

Do not create documentation that duplicates code and will immediately become stale.

Document decisions and constraints, not obvious implementation details.

## API

Use OpenAPI/Swagger for APIs where appropriate.

## Database

Document important:
- relationships;
- constraints;
- indexing decisions;
- migration considerations;
- business invariants.
