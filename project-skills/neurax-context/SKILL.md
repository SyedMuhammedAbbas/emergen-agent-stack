---
name: neurax-context
description: Project context for NuEraX / NeuraX (Odoo project 91, Paperclip project NeuraX). Load for ANY NeuraX work - requirements, PRD scope, milestones, payments/Stripe, mobile builds, device testing, staging.
---

# NuEraX project context

Read these before planning or changing anything for NuEraX. They are the owner's sources of truth; do not copy them, read them where they live. Everything under `/mnt/c/.../memory/` is read-only for you.

## 1. Rules of the workspace
`/mnt/d/Projects/Emergen/NeuraX/CLAUDE.md`: architecture invariants, gates per repo, prohibited list (incl. no AI attribution in commits), Definition of Done.

## 2. Scope: the two PRDs (the PRD is the scope boundary; anything else is a change request)
| Document | Live (source of truth) | Local copy |
|---|---|---|
| Web Dashboard PRD v3 | https://docs.google.com/document/d/1TXPUrsKQ33r9CMu_SPuCm4Mdj51ETFXx3PyEHIYUEso | `/mnt/d/Projects/Emergen/NeuraX/docs/NueraX-Web-Dashboard-PRD-v3.md.txt` |
| Mobile Feature Document v3 | https://docs.google.com/document/d/1L2XKjxBs9oTy09JG5v0lijIFAOF3w2kT6GpvldJ6NXc | `/mnt/d/Projects/Emergen/NeuraX/docs/NueraX-Mobile-Application-Feature-Document-v3.md.txt` |

The local Mobile copy predates the live doc (live edited 2026-09-18, copy 2026-09-09). For anything mobile, read the live text: `curl -sL 'https://docs.google.com/document/d/1L2XKjxBs9oTy09JG5v0lijIFAOF3w2kT6GpvldJ6NXc/export?format=txt'` (same `/export?format=txt` pattern for the Web PRD). Where the two PRDs disagree, Web PRD section 2 wins.

## 3. Milestones and plan
- Odoo milestones (project 91): M3 App Foundation (23 Aug), M4 Buyer Core (30 Aug), M5 Bidding Engine 1 (6 Sep), M6 Bidding Engine 2 (11 Sep), M7 Live Video and Chat (17 Sep), M8 Giveaways and Stream Moderation (22 Sep), M9 Seller and Admin Backend (30 Sep), M10 Payments, QA and Store Submission (10 Oct). Main task per milestone is named like "222: M9 - Seller and Admin Backend". Current list: `"$PY" "$AO" odoo project 91` (see the daily-timesheets / agent-ops bridge paths).
- Delivery plan and state: `docs/architecture/29-delivery-plan.md`, `31-roadmap-snapshot.md`, `30-credentials-and-accounts.md`, `11-later-phase-tasks.md`; the 2026-08-21 audit in `docs/audit/` and task ids in `docs/planning/` are the state map (doc 26 drifts).

## 4. The owner's working knowledge (Claude session memory)
Index: `/mnt/c/Users/syedabbas/.claude/projects/D--Projects-Emergen-NeuraX/memory/MEMORY.md`. Open the linked notes relevant to your task. They are dated observations: verify against code before relying on one. Notes you will usually need:
- `staging-test-seller-and-stub-payments.md`: staging runs the real Stripe UAE **test** adapter (UAE only; AU returns 503), how to set up a UAE seller/buyer, Stripe test values.
- `delivery-builds-need-full-dart-defines.md`, `device-holds-release-signed-build.md`, `worktree-builds-are-debug-signed.md`, `gradle-loopback-blocks-device-builds.md`, `builds-go-in-builds-folder.md`, `deliver-verified-on-device-without-being-asked.md`: how a mobile build is made and delivered.
- `cloud-run-deployment-is-live.md`, `cloud-run-migrations-are-manual.md`, `staging-seed-via-cloud-run-job.md`: staging.
- `neurax-test-running-gotchas.md`, `dashboard-e2e-gotchas.md`, `dashboard-unit-tests-are-load-flaky.md`: tests.
- `client-facing-actions-are-the-users.md`: invites, staging accounts, delivery builds sent to the client and Drive uploads are done by the owner; you produce files and answers only.

## Staging environment
- Dashboard: **https://staging-neurax-dashboard.vercel.app/admin** (not neurax-dashboard.vercel.app).
- API: https://neurax-api-1060747629990.me-central1.run.app, realtime: https://neurax-realtime-1060747629990.me-central1.run.app (Cloud Run, deploys itself on push to backend `staging`).
- Share links: https://staging.nuerax.io (nuerax-web; pages pending EME-45).
- Test devices: phone `ZA2238M898` (Play internal testing build) and `emulator-5554`; phone commands under `flock /tmp/neurax-phone.lock`.

## 5. Payments (Stripe Connect, dual entity)
PRD section 5: Australia = Connect **Express** (AU entity); UAE = Connect **Custom** (UAE entity, trade-licensed sellers, Stripe-hosted Account Links onboarding, native in-app payouts/bank details). Staging implements UAE with v2 Custom-equivalent accounts (`dashboard: none`). Going live needs Stripe to enable Connect Custom on the real UAE platform account (see `30-credentials-and-accounts.md`). Payments are a danger zone: CTO brief first, SecOps review, never touch secret keys (`_secrets/` is off-limits; publishable keys come only from the build defines file).

## UI rules from the owner (apply to every change)
- Every internal (non-tab-root) app screen has the standard back button (`lib/shared/widgets/app_back_button.dart` via the shared header), and Android back does the same. A screen without one is a bug.
- Every dashboard modal and sheet uses the shared overlay (dim + blur) and behaves the same (EME-202).

## 6. Mobile builds and the test phone
- Defines: `/mnt/d/Projects/Emergen/NeuraX/_builds/android/staging-dart-defines.json` with `--dart-define-from-file` (API, realtime URL, Stripe publishable keys, Google client ID). After building, confirm the realtime URL is embedded (`strings` on libapp.so).
- The phone `ZA2238M898` holds a **release-signed** build: build `--release` with `android/key.properties` (copy it into any worktree), never uninstall the app, install over it.
- Flutter/Gradle run on Windows: `cmd.exe /c "set TMP=C:\Temp&& set TEMP=C:\Temp&& cd /d <windows path> && C:\Users\syedabbas\flutter\bin\flutter.bat build apk --release --dart-define-from-file=<windows path to defines>"` (close stdin: `</dev/null`).
- adb: `/mnt/c/Users/syedabbas/AppData/Local/Android/Sdk/platform-tools/adb.exe -s ZA2238M898`; one agent at a time on the phone: `flock /tmp/neurax-phone.lock ...`.
- Copy the delivered APK to `_builds/android/NuEraX-staging-<milestone>-<sha>.apk` and name it in your summary.
