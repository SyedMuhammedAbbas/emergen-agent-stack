# 10. Proposed repository structure

Principle: **additive**. Existing paths stay where they are until a milestone replaces them. New code goes in new top-level folders. A single repo (monorepo with npm workspaces) because the pieces ship together and one person maintains them.

```
agent-stack/
  README.md  CLAUDE.md  config.example.env        unchanged until M3
  install.ps1  connect-project.ps1  setup.cmd      unchanged (legacy path; kept working)
  org/  skills/  project-skills/  hermes/  wsl/  windows/  mac/  examples/   unchanged
  mods/                                            unchanged (Claude Code mods)
  tools/                                           existing local tools (downloads-organizer, setup-wizard)
                                                   -> become manifest-described tools in M4

  apps/
    control-app/        daemon + UI (grows out of tools/setup-wizard)
    cli/                `stack` command: plan | apply | rollback | drift | doctor
  packages/
    schemas/            JSON Schemas + migrations + canonical hashing
    reconciler/         three-way plan, journal, snapshot, rollback
    adapter-paperclip/  extracted from wsl/40-org.sh; the only adapter at first
    blueprint/          requirements -> blueprint compiler + validator
    tools-runtime/      manifests, runner, roots, plan/confirm/undo, MCP host
    decision/           Decision service + eval harness (Jev wrapper)
    platform/           windows/ and mac/ service control, secrets, startup
  templates/
    software-company/   from org/engineering, org/operations (converted, not copied by hand)
    branding/  freelance/  personal-assistant/
  integrations/         upwork.yaml, github.yaml, odoo.yaml, discord.yaml (manifests only)
  services.lock.json    pinned versions + checksums for every managed service
  spikes/               M0 scripts and results
  docs/
    architecture/       these documents
    adr/                one short file per decision (starting from the README decisions)
    (existing docs stay)
  .github/workflows/    CI: lint, unit, schema, contract, UI audit, installer dry-run
```

## Migration of existing folders

| Existing | Becomes | When |
|---|---|---|
| `org/` | `templates/software-company` etc. via an automated converter (`stack import-org`); `org/` remains source until the converter round-trips with zero diff | M1/M3 |
| `config.env` | generated from `workspace.yaml`; still readable | M1 |
| `wsl/40-org.sh` | replaced by `packages/adapter-paperclip`; kept as fallback for one release | M1 |
| `tools/setup-wizard` | `apps/control-app` onboarding screens | M2/M3 |
| `tools/downloads-organizer` | tool manifest under `tools/` with the same code | M4 |
| `hermes/agent_ops.py` | unchanged; later split by function (intake, approvals, diskguard) once tests exist | after M4 |

## Conventions

- Node workspaces, TypeScript strict, ESM; tests next to code; no package may import another package's internals.
- Only `packages/adapter-*` may call a framework's API or CLI.
- No secrets, tokens or machine paths in git; `config.env`, `app.db`, `.paperclip` stay ignored.
- Every new package has a README with its contract and a test target.
