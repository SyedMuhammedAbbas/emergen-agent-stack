# 13. M1 step 0: Paperclip API findings

Run 2026-10-11 on a scratch instance (Paperclip 2026.1005.0, port 3199) with `spikes/m1-api-verify.mjs`, `m1-api-verify2.mjs`, `m1-api-verify3.mjs` and `m1-openapi.mjs`. Everything below was observed, not assumed. The live instance was not touched. Several results **change the plan in doc 12**; those are marked **Plan change**.

| # | Question | Observed | Consequence for the reconciler |
|---|---|---|---|
| 1 | `PATCH /agents/{id}` with `metadata` | **Replaces** the whole object (`{a:1}` then `{b:2}` leaves `{b:2}`) | **Plan change.** Always read, merge client-side, write back, so other keys are never lost |
| 2 | `PATCH` with `adapterConfig` (default) | Merges **shallowly** at the top level: `{x:1}` keeps `model`/`env` and adds `x`; but `{env:{Y}}` **replaces the whole `env`** | Send the complete managed `env` object every time. Safe and deterministic |
| 3 | `PATCH` with `replaceAdapterConfig: true` | Replaces everything **and drops the server's `instructionsFilePath/RootPath/EntryFile/BundleMode` keys** | **Never use it.** It would detach an agent's instruction bundle |
| 4 | `PATCH runtimeConfig.heartbeat` | The `heartbeat` object is replaced as a whole (`{intervalSec:600}` erased `enabled` and `maxConcurrentRuns`) | Read the whole `runtimeConfig`, change `heartbeat`, write the whole object back. A new agent starts with `maxConcurrentRuns: 20` |
| 5 | `env` values on read | **Redacted** on `GET /agents/{id}`, `/configuration` and revisions (`"***REDACTED***"`), with `type:"plain"` | **Plan change.** Live env *values* cannot be compared. The live projection uses env **key names** only; values rely on `appliedHash` of what we wrote. A person editing an env value in the UI would go unnoticed (documented limitation). Never write a read-back value to the API |
| 6 | Instructions `GET .../file?path=AGENTS.md` | Returns `content`, `contentHash`, `revision.id`. **`contentHash` = SHA-256 hex of the raw text** (verified) | The reconciler computes the same hash itself. No extra call needed for drift |
| 7 | Instructions `PUT` | Needs `baseRevisionId` = current revision. A stale id gives **409 `INSTRUCTION_REVISION_CONFLICT`**. `baseRevisionId: null` is only valid when no file exists (also 409 otherwise) | Read the revision immediately before the write; on 409, re-read and re-plan instead of forcing |
| 8 | Instructions `history` | Returned `{"revisions":[],"nextCursor":null}` even after two writes (with and without `path`) | **Plan change.** Do not rely on Paperclip's history/restore. The journal stores the **full previous text** and rolls back by writing it |
| 9 | Skills `POST /agents/{id}/skills/sync` | `add`, `replace`, `remove` all work. **`paperclip` (built-in) is always present** and cannot be removed (`replace []` leaves it). Keys come from `GET /companies/{id}/skills` | Compare desired vs live as a **set, ignoring `paperclip`**. `desiredSkills` also works at agent creation |
| 10 | Skill import | The CLI import accepts only a path inside the **company managed-skill directory** (`403 skill_workspace_boundary_denied` otherwise). Needs `--api-base` as an origin (no `/api`) | Skill import stays in `40-org.sh` as today (it already copies into the managed dir) |
| 11 | Routines | `POST /companies/{id}/routines`, `POST /routines/{id}/triggers` (`kind:schedule`, `cronExpression`, `timezone`, `enabled`), `GET /routines/{id}` includes `triggers[]`; `PATCH /routines/{id}` and `PATCH /routine-triggers/{id}` work | Straightforward to reconcile. Routines also have `revisions` endpoints (not needed in M1) |
| 12 | Agent `GET` shape | Includes `updatedAt`, `metadata` (null until set), `adapterConfig`, `runtimeConfig`, `reportsTo`, `appearance`, `permissions`; the server adds `instructions*` keys to `adapterConfig` | Managed projection excludes server-owned fields (`instructions*`, `appearance`, `status`, `permissions`) |
| 13 | Paperclip's own audit trail | `GET /agents/{id}/config-revisions` lists every patch with `beforeConfig`, `afterConfig`, `changedKeys`, `source`, and `createdByUserId`; `POST .../config-revisions/{id}/rollback` restores that revision's state | Useful later: it tells us **who** changed an agent (a person in the UI vs our reconciler). Not used for rollback in M1 because env stays redacted and the semantics need a closer look (⚠️) |
| 14 | Agent create body | Accepts `desiredSkills`, `instructionsBundle`, `runtimeConfig`, `adapterConfig`, `reportsTo`, `budgetMonthlyCents`, `metadata` in one call | Creation (a new template agent) can be a single call, with `metadata` set at birth |

## What changes in doc 12

- **Section 3.2/3.3:** the live projection reads env **keys only**; hashes are computed over a *normalised* projection built separately for "desired" (full values) and "live" (env key list); `appliedHash` stores the hash of the desired projection, and "live changed?" compares the live projection (minus env values) to the stored `appliedLiveHash` captured right after our own write. So the stored state is two hashes: `appliedHash` (desired as written) and `appliedLiveHash` (what the API returned afterwards).
- **Section 3.6 (rollback):** instruction rollback writes the stored previous text; field rollback re-PATCHes the live before-image; **env rollback** re-applies the env of the previous applied desired projection, which the journal keeps (router env vars are non-secret by design; the schema rejects key-shaped secrets).
- **Metadata** is written with read-merge-write; **adapterConfig** never with `replaceAdapterConfig`; **runtimeConfig** as a whole object.
- **Step 4 (adapter)** gets the exact endpoints above; the recorded fixtures should be captured from these scripts' output.

## Not verified (⚠️)

Behaviour of `config-revisions/rollback` on env values; whether UI edits appear in `config-revisions` with a distinguishable `source`; pagination of `GET /companies/{id}/skills` for large libraries; PATCH of `reportsTo` to null; the live instance may differ from a fresh scratch instance in default values (the live agents were created by `40-org.sh`, not by this script).
