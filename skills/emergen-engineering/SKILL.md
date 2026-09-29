---
name: emergen-engineering
description: Production engineering standards for Emergen projects using Next.js, NestJS, PostgreSQL, TypeORM, React Native, and Flutter. Use when implementing, reviewing, refactoring, testing, auditing, or bootstrapping software for Emergen.
---

# Emergen Engineering Standard

Use this skill for Emergen project work.

## Read first

- Standards: `standards/`
- Checklists: `checklists/`
- Official references: `references/`

## Workflow

1. Inspect the repository.
2. Detect the stack.
3. Read applicable standards and official references.
4. Reuse existing architecture and abstractions.
5. Implement the smallest correct change.
6. Run validation.
7. Review against the relevant checklist.

Do not claim verification that was not performed.

## Official documentation rule

Prefer official framework documentation (linked in `references/`) for framework behavior. Emergen standards define how Emergen projects apply those capabilities.

## Core standards

Always read:

- architecture.md
- code-quality.md
- security.md
- testing.md
- performance.md
- devops.md
- git.md
- documentation.md
- ai-development.md

Apply stack-specific standards only when that technology is present.
