# Code Quality Standard

## DRY

Avoid meaningful duplication of:
- business rules;
- validation;
- API transport logic;
- constants;
- reusable UI behavior.

Do not abstract two unrelated things merely because their code looks similar.

## SOLID

Apply SOLID principles pragmatically, especially:
- single responsibility;
- dependency inversion;
- open/closed where extension is expected.

Do not create interfaces, factories, or abstractions without a real reason.

## TypeScript

- Prefer strict TypeScript.
- Avoid `any`.
- Prefer `unknown` for genuinely unknown values and narrow it.
- Model domain types explicitly.
- Avoid unsafe type assertions.
- Do not use non-null assertions unless the invariant is guaranteed.
- Keep API request/response types aligned.

## Naming

TypeScript:
- variables/functions: `camelCase`
- classes/components: `PascalCase`
- constants: `UPPER_SNAKE_CASE` when truly constant/global
- boolean names should communicate state: `isLoading`, `hasAccess`, `canEdit`

Database:
- `snake_case`

Follow existing file naming conventions. Do not rename unrelated code.

## Files

Keep files focused.
Extract a component/service when a file becomes difficult to reason about, not merely because it reaches an arbitrary line count.

## Comments

Comments should explain:
- why;
- business constraints;
- non-obvious tradeoffs;
- external limitations.

Do not comment obvious code.

## Error handling

Never silently swallow errors.
Preserve useful error context.
Return user-safe messages while logging diagnostic details safely on the server.
