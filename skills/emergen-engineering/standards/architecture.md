# Architecture Standard

## Principles

- Prefer modular, feature-oriented architecture.
- Keep boundaries explicit.
- Separate presentation, business logic, persistence, and infrastructure.
- Keep modules cohesive and loosely coupled.
- Prefer composition over inheritance for UI.
- Keep dependencies flowing toward stable abstractions.
- Avoid circular dependencies.
- Avoid giant "god" modules, services, pages, or components.

## Feature organization

Prefer:

```text
features/
  bookings/
    components/
    hooks/
    services/
    types/
    utils/
```

for frontend feature logic, and:

```text
modules/
  bookings/
    controllers/
    services/
    repositories/
    dto/
    entities/
```

for backend feature modules.

Do not reorganize an existing project solely to match this layout if the existing architecture is coherent.

## Separation of concerns

Frontend:
- components render UI;
- hooks coordinate reusable UI behavior;
- services/API clients handle transport;
- domain utilities contain deterministic business calculations;
- state management handles shared client/server state according to the chosen library.

Backend:
- controllers handle HTTP boundaries;
- DTOs validate input;
- services contain business workflows;
- repositories/data-access code handles persistence;
- entities represent persistence structures;
- guards/interceptors/pipes/filters handle cross-cutting concerns.

## Change discipline

Small feature -> small change.
Cross-cutting change -> explicit plan and broader tests.
Avoid unrelated cleanup.
