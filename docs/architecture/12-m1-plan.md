# 12. M1 plan: the reconciler

Status: **plan for approval. Nothing here is built.** Basis: doc 09 (M1 entry), the M0 results (doc 11), and a read of `wsl/40-org.sh`, `wsl/lib.sh`, `~/.agent-stack/ids.json` and Paperclip's OpenAPI on the live instance (✅ = verified, ⚠️ = to verify in step 0).

## 1. Goal and non-goals

**Goal:** replace the destructive part of `wsl/40-org.sh` (the agents, instructions, skill assignment and routines phases) with a reconciler that can say what would change, keeps edits people made in Paperclip, applies changes as a journalled operation, and can undo them.

**Non-goals for M1** (each stays as it is today): company creation, skill *import* into Paperclip, Claude hooks, ponytail plugin, watchdog timer, `60-sync-skills.sh`, Hermes, any UI, OmniRoute/jev-router config, Windows-native supervision. **M1 never deletes anything in Paperclip** (no agent or routine deletion): the orphan-row crash (doc 01 item 3) is avoided by not going near deletes.

## 2. What the current script does, and what M1 changes

| Phase in `40-org.sh` | Today | In M1 |
|---|---|---|
| company (l.20-28) | create-if-missing | unchanged |
| skills import (l.30-55) | copy to managed dir, `skills import`, build slug→key map | unchanged; the reconciler reads the same map |
| **agents** (l.57-119) | match by `ids.json` then name; `agent update` with merged adapterConfig; **always overwrites instructions**; heartbeat patches | **reconciled** |
| **skill assignment** (l.112-118) | `skills agent sync --mode replace` (removes anything added in the UI) | **reconciled as a set** |
| **routines** (l.121-143) | create routine and schedule trigger from `config.env` | **reconciled** |
| hooks, plugin, watchdog, skill sync (l.145-204) | shell | unchanged |

## 3. Design

### 3.1 Desired state comes from the existing renderer
`wsl/lib.sh` already renders `org/` + `config.env` into `~/.agent-stack/org.rendered.json`, and `render_role` renders each agent's markdown. M1 does **not** reimplement rendering in JavaScript. A small bash step (`wsl/41-render.sh`) writes `~/.agent-stack/desired/org.json` and `desired/agents/<key>.md`; the Node reconciler only reads those files. When the blueprint compiler arrives (M3) it replaces this step and nothing else changes.

### 3.2 Managed projection (what the reconciler owns)
Per agent, an explicit allow-list; **everything else is never touched** (for example `adapterConfig.cwd`, `dangerouslySkipPermissions`, instruction file paths, `appearance`, `status`):

| Field | Source |
|---|---|
| `name, role, title, icon, budgetMonthlyCents, reportsTo` | department.json |
| `adapterConfig.model`, `adapterConfig.env` (router vars), `adapterConfig.engine/command/timeoutSec` | department.json, company.json |
| `runtimeConfig.heartbeat.{enabled,intervalSec,maxConcurrentRuns}` | `heartbeat`, `maxConcurrentRuns`, `MANAGER_HEARTBEAT_SEC` |
| skill set | commonSkills + EXTRA_SKILLS + agent skills |
| instructions (`AGENTS.md`) | rendered role markdown |

Routine: title, description, assignee, schedule cron + timezone, enabled.

### 3.3 State kept in Paperclip, not in a side file
Each managed object carries in its Paperclip `metadata` (✅ accepted by `PATCH /agents/{id}`, ✅ round-trips through export/import): `stackKey` (the existing key, e.g. `qa`), `templateVersion` (git short hash of `org/`), and `appliedHash` (SHA-256 of the canonical managed projection **as last written**). `~/.agent-stack/ids.json` stays as a cache and is regenerated from `stackKey`.

Hash rules: canonical JSON (sorted keys), skills sorted, instruction text normalised to `\n`, no timestamps or paths.

### 3.4 Three-way plan (per object)

| live hash vs `appliedHash` | desired hash vs `appliedHash` | Plan |
|---|---|---|
| same | same | `noop` |
| same | different | `update` (template moved) |
| **different** | same | `keep-live` (a person edited it) |
| different | different | `conflict`: nothing written; shown with a field-level diff |
| no `appliedHash` yet | | `adopt` (see 3.5) |

Conflicts and adoption differences are decided per field with `--keep-live`, `--take-template` or an interactive choice; there is no silent overwrite. `--take-template` on everything reproduces today's behaviour for users who want it.

### 3.5 Adopting the 18 live agents
They have no metadata. `stack adopt` matches by `ids.json` id, then by name. If the live managed projection equals the desired one, it writes the metadata and nothing else. If it differs, it **cannot know** whether a person edited it or an older template wrote it, so it lists the differences and asks. Acceptance (below) requires `plan` to show zero changes after adoption.

### 3.6 Apply, journal, rollback
1. Take the lock (`~/.agent-stack/lock`; a second apply refuses).
2. Write the plan to `~/.agent-stack/journal/<ts>/plan.json`.
3. For each step: record the **before-image** (the live managed projection plus the current instruction revision id), perform the change, read it back, compare, and write the step result. Stop at the first failure.
4. `stack rollback <id>` replays before-images in reverse: field PATCHes, `skills/sync` with the old set, and instructions through Paperclip's own `instructions-bundle/restore` (✅ endpoint exists, with `history` and `revision/{id}`).

Change from doc 03: **rollback uses per-object before-images, not export/import.** M0 showed import is non-transactional and invents agents. `paperclipai company export` is still taken as an extra, read-only disaster-recovery snapshot (with the pin workaround), never as the rollback path.

### 3.7 API contract protection
The adapter is the only code that talks to Paperclip. It pins the server version in `services.lock.json` (2026.1005.0) and ships recorded fixtures of each response it depends on. `stack doctor --contract` checks the live server (or a scratch one) against them and fails loudly on a mismatch such as the earlier `baseRevisionId` change.

## 4. Packages (kept small for M1)

```
packages/schemas/            JSON Schemas for desired state, journal, plan; canonical hash   (plain JS + JSON)
packages/reconciler/         pure logic: projection, hashing, three-way plan, journal, rollback
packages/adapter-paperclip/  HTTP client (+ the one CLI call if skills sync has no usable HTTP form), fixtures
apps/cli/stack.mjs           stack render|adopt|plan|apply|rollback|drift|doctor
tools/scratch-paperclip/     start/stop an isolated Paperclip on other ports for integration tests
wsl/41-render.sh             writes desired/ (reuses lib.sh)
```

**Language decision (yours):** plain JavaScript ESM with JSDoc types checked by `tsc --checkJs`, no build step. It runs unchanged on WSL Node 24 and Windows Node, matches the wizard and hooks, and avoids a compile step in the install path. TypeScript proper can follow in M2 if the code grows. Say if you would rather start in TypeScript.

Runs where: inside WSL for now (that is where Paperclip, `jq`, and `render_role` are). The CLI only needs `--api-base`, so it will also run from Windows against `localhost:3100`.

## 5. Work breakdown

| # | Task | Size | Depends on | Done when |
|---|---|---|---|---|
| 0 | **API verification** on a scratch instance: PATCH `metadata` merge vs replace; `adapterConfig` merge vs `replaceAdapterConfig`; `skills/sync` HTTP shape and replace semantics; routine and trigger GET/PATCH shapes; instructions `history`/`restore` behaviour; what `GET /agents/{id}` returns | S | `tools/scratch-paperclip` | Findings table committed; every ⚠️ in this doc resolved |
| 1 | `tools/scratch-paperclip` (from the M0 recipe: separate data dir and ports, transient systemd unit in WSL, fresh data path each time) | S | | `start`/`stop`/`reset` work twice in a row |
| 2 | Schemas, projection and canonical hash, with golden tests | S | 0 | Same input gives the same hash on Windows and Linux |
| 3 | `41-render.sh` and the desired-state loader | S | | Output equals today's `org.rendered.json` and role markdown |
| 4 | Adapter: read agents/routines/instructions/skills; fixtures recorded | M | 0, 1 | `stack plan` runs read-only against live |
| 5 | Three-way planner and `adopt` | M | 2, 4 | Adopting the live company leaves `plan` at zero changes |
| 6 | Apply, journal, lock, read-back, rollback | M | 5 | Failure injection passes (below) |
| 7 | Routines reconciliation | S | 6 | Schedule edited in UI survives; template change applies |
| 8 | `doctor --contract`, docs, `40-org.sh` switch (`RECONCILER=1`) | S | 6 | Documented in `docs/operations.md` |

Rough total: 2 to 3 weeks of focused work (⚠️ an estimate, not a commitment). Steps 0, 1 and 4 come first because they decide whether the design holds.

## 6. Acceptance criteria and tests

| Criterion | Test |
|---|---|
| `plan` against the live company reports **zero changes** after `adopt` | Run on the real 18 agents |
| A UI edit survives | Edit an agent's title and instructions in Paperclip, run `apply`; they are kept and reported as `keep-live` |
| A template change applies | Change a line in `org/engineering/qa.md`, `apply` updates only QA |
| Conflict never overwrites | Change both sides; `apply` writes nothing for that agent and prints the diff |
| No duplicates on repetition | Run `apply` three times; agent count stays 18 |
| Failure rolls back | Kill the API or the process mid-apply (injected after step N); `rollback` restores every touched agent; read-back equals the before-images |
| Idempotent | Second `apply` writes nothing (no PATCH calls recorded) |
| Contract drift is caught | Replay fixtures with a changed field; `doctor --contract` fails with the field named |
| No deletes | Static check: the adapter exposes no delete method |
| Compatible | `install.ps1 -OnlyOrg` still works unchanged with `RECONCILER` unset |

Test layers: unit (hashing, planner matrix, journal), contract (recorded fixtures), integration on the scratch instance (apply/rollback/failure injection), and one manual run against the live company in `plan`-only mode.

## 7. Rollout and migration

1. **Shadow:** `stack plan` runs beside the old script for about a week; differences are triaged. No writes.
2. **Adopt:** `stack adopt` on the live company, reviewed by you.
3. **Apply for one agent, then all.**
4. **Switch:** `40-org.sh` calls the reconciler when `RECONCILER=1`; the old path stays for one release as a fallback.
5. **Hermes bridge:** it reads Paperclip ids from `agent_ops.config.json` and `ids.json`. M1 keeps `ids.json` regenerated with the same keys, so the bridge is untouched.

## 8. Risks

| Risk | Mitigation |
|---|---|
| PATCH semantics differ from assumptions (merge vs replace) | Step 0 before any code; adapter tests pin the behaviour |
| Paperclip upgrades change the API | Version pin, fixtures, `doctor --contract` |
| Instruction text normalisation causes false drift | Canonical hash rules (3.3) and a golden test with real role files |
| Adoption finds many differences | They are shown per field; nothing is written without a choice |
| The embedded-Postgres/WSL instability corrupts a run midway | Journal plus read-back; no deletes; resumable `apply --resume` is **not** in M1 |
| Scope creep into a general framework | Single adapter, no UI, no plugin loading in M1 |

## 9. Decisions and questions for you

1. **Approve the plan, or change scope** (for example, skip routines in M1).
2. **JavaScript + JSDoc, or TypeScript?** I recommend JavaScript for M1.
3. **Do you edit agents or schedules in the Paperclip UI today?** If yes, I will make the conflict output friendlier early; if no, `--take-template` stays the default for a long time.
4. **Is a week of shadow mode acceptable** before the first real `apply`?
5. Still open from earlier: the WSL keepalive (the live Paperclip stops when WSL idles, which also interrupts any long `apply`), and the Jev key (the guide arrived; see doc 06).
