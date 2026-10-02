---
name: tool-vetting
description: Safety checks before adding any third-party package, CLI, script, GitHub Action, Docker image, browser extension, MCP server or skill to a project or to this machine, so nothing installed can run malicious code or leak data. Use before every install or new dependency, in any project or tool.
---

# Tool vetting

Installing code is running code. Most supply-chain attacks arrive through an install script, a look-alike package name, a hijacked maintainer account or a script piped from the internet. Nothing new is installed without these checks, and **nothing new is installed without the board's yes**: post a `**Question for board:**` with the filled checklist and wait.

## Never
- Pipe a script from the internet into a shell (`curl ... | bash`, `iwr ... | iex`) unless the board approved that exact URL from the vendor's official docs.
- Install from git URLs, tarball URLs or personal forks; only the official registry.
- Install globally for a project's needs; add a pinned dev dependency to the project instead.
- Run a downloaded binary, an install script or a skill's scripts you have not read.
- Give a tool credentials, tokens, `.env` files or `_secrets/` access it does not need.
- Turn off security checks (`--no-verify`, enabling install scripts globally, `--trusted-host`, `curl -k`).

## Checklist (fill it in your question to the board)

| Check | How | Pass when |
|---|---|---|
| Exact name | Compare with the official docs; watch for typos and look-alikes | Name matches the official docs |
| Publisher | `npm view <pkg> repository.url maintainers`, `pip show`, the GitHub org page | Official org of the project, not a personal copy |
| Age and use | `npm view <pkg> time`, weekly downloads, GitHub stars, recent commits | Established and maintained; be wary of a brand-new package or a sudden new maintainer |
| License | `npm view <pkg> license` | MIT, Apache-2.0, BSD or ISC (anything else: ask) |
| Install scripts | `npm view <pkg> scripts` | No `preinstall`, `install` or `postinstall`, or you read them and they only build native code |
| Provenance | `npm view <pkg>@<ver> dist.attestations`; after install `npm audit signatures` | Signed with build provenance where the ecosystem supports it |
| Known issues | `npm audit` / `pnpm audit` / `pip-audit` after adding it; GitHub security advisories | No high or critical advisory |
| Access | README, requested permissions or scopes (MCP servers, extensions, Actions) | Only what the task needs |

## Installing, once approved
- Pin the exact version (`--save-exact`, lockfile committed) as a dev dependency of the project.
- Keep install scripts off where the package manager allows it (`npm install --ignore-scripts`; pnpm's build-script allow-list with only the packages that need it).
- Run `npm audit signatures` (or the ecosystem's equivalent) and paste the result in the PR.
- Skills from the internet: read every file, including scripts, before installing; never run their scripts while reviewing them. Prefer writing the useful instructions into a skill in this repo over installing a third-party one.

## Already checked (Oct 2026; re-check the version you install)
- `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` 10.0.0 (mutation testing): official stryker-mutator org, Apache-2.0, no install scripts, SLSA build provenance. Still needs the board's yes per project.
- `fast-check` 4.10.2 (property-based testing): official dubzzz/fast-check, MIT, no install scripts, SLSA build provenance.
