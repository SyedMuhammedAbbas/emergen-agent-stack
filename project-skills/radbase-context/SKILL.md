---
name: radbase-context
description: Project context for RadBase (repo reports-scoped, Paperclip project radbase). Load for ANY RadBase work - spec scope, de-identification (PHI), AI classification/extraction, DICOM ingestion, web UI, local stack, testing.
---

# RadBase project context

RadBase is a radiology teaching archive: clinicians upload DICOM studies and reports, the worker de-identifies them, AI classifies the case and extracts report fields, a human review gate approves publication, then cases are browsed, viewed and used for learning. Read the sources below where they live; do not copy them.

## 1. Sources of truth (the spec is the scope boundary; anything else is a change request)
Repo: `/mnt/d/Projects/Personal/reports-scoped` (never edit it in place; work in your own worktree).
| Topic | Read |
|---|---|
| Whole system, decisions already made | `Radiology_Archive_Spec.md` sections 1-2 |
| Ingestion and de-identification (headers 5.1, pixels/OCR 5.2, reports, review gate) | `Radiology_Archive_Spec.md` section 5 |
| AI classification agent / report extraction | sections 7 and 8; AI evaluation in `docs/eval.md` |
| Roles, permissions, NFRs | sections 12, 13 |
| Product and technical requirements | `docs/prd.md`, `docs/trd.md` |
| UI design rules (the reference-design restyle is judged against this) | `docs/design-brief.md` |
| Code rules | `CONVENTIONS.md` (short; read all of it) |
| Running the stack, ports, first run | `infra/README.md`, `infra/install/bootstrap.sh`, `docs/runbooks/troubleshooting.md` |

There is no CLAUDE.md in this repo. Commits in this repo do carry a `Co-Authored-By: Claude` trailer; keep the existing commit style (`Area: what changed, in plain words`).

## 2. Layout
`apps/web` (Next.js, port 3030), `apps/api` (NestJS, port 3031, AI in `src/ai/`), `apps/worker` (Python, arq; de-identification in `deident/`, pixel OCR in `pixels/`, report text de-id in `reports/`, ingestion in `ingest/`, reference library in `library/`), `apps/site` (marketing, 3040), `apps/mobile`. Migrations in `db/migrations`.

## 3. Branches
- `staging`: the integration branch. Base worktrees and PRs on it. As of 2026-10-01 (`cf95112`, pushed) it holds the UI restyle (`ui/reference-redesign`), the worker fixes for the 2026-09-29 tester report (219480d, afa8a4c, 80ef84e, aeefb37) and the EME-104 work merged so far (ADR-001, one OpenCV wheel, uint8-only OCR input, report email/address/e-signature redaction, zero-row instances skipped, MinIO pinned by digest). Pushing to `origin/staging` stays with the board.
- `ui/reference-redesign`: the UI restyle branch, now merged into `staging`. Do not base new work on it.
- `origin/test/radiology-validation`: the external tester's branch. Read `INGESTION_ERROR_AND_SUGGESTIONS_REPORT.md` there (`git show origin/test/radiology-validation:INGESTION_ERROR_AND_SUGGESTIONS_REPORT.md`). Do not merge that branch: its infra changes delete large parts of `infra/` and swap MinIO for an unpinned third-party image.

## 4. Local stack (as of 2026-10-01)
- Docker runs on the Windows host; this WSL distro has no Docker integration. Infra (Postgres 5432, Redis, MinIO 9010/9011, Orthanc 8042, Keycloak 8085) runs there and is reachable from WSL on `localhost` (mirrored networking). Do not start or stop containers from WSL.
- The board's web dev server already holds port 3030. Do not kill it.
- Bootstrap is done (migrations, taxonomy, org `pilot` on plan `enterprise` via `infra/dev/provision-dev-org.sh`, Keycloak user `dev@example.org` as owner). The API (3031) and worker are not running by default: start them from your worktree, stop them when done. Never re-run bootstrap or `db:reset`.
- MinIO's official images (Docker Hub and Quay) are no longer pullable. The board's local stack uses a digest-pinned `ghcr.io/coollabsio/minio` override kept outside the repo. The permanent fix is an open issue.
- `.env` is gitignored and absent from worktrees. Copy it from the primary repo into your worktree; never commit it, never print secrets from it.
- `LLM_DEFAULT_PROVIDER=mock`: AI calls return fixtures from `apps/api/src/ai/mock-fixtures.service.ts`. Live-model runs need the board to set `ANTHROPIC_API_KEY`; never ask for or handle the key. Note the mock provider stops the container image (infra/README.md), so it only works with native `pnpm dev`.
- The worker venv in the primary repo is a Windows venv (unusable from WSL) and has three OpenCV wheels installed together (`opencv-python`, `-contrib`, `-headless`, 5.0) plus stale numpy dist-infos. `uv` is not installed in WSL. Build a Linux venv in your worktree from `apps/worker/uv.lock` if you need the worker suite.

## 5. Baseline (board run, 2026-10-01, commit 14f7395)
`pnpm typecheck` pass; web 880 tests pass, lint clean; api 657 tests pass; site lint clean; worker 527 passed, 70 skipped (run on Windows). Quote your own run, not these numbers.

## 6. Danger zones
- PHI and de-identification are risky: CTO brief first, SecOps review, never weaken a rule to make a test pass. A test that loosens redaction or routing needs a spec citation.
- Never put real patient data in the repo, issues or comments. Test data must be synthetic.
- Spec section 2's credential split (quarantine / app / upload) is the core invariant; nothing in the API tier may read quarantine.
