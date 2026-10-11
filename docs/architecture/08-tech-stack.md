# 8. Technology stack and tradeoffs

## 8.1 Shell: local web app now, desktop wrapper later

| Option | For | Against | Verdict |
|---|---|---|---|
| **Local web app** (daemon on loopback + browser) | Already proven in the wizard; no new toolchain; trivial to test; same code later wrapped | No tray/auto-start by itself; user must open a URL | **MVP** |
| Tauri (Rust + system WebView2) | Small installer (~10 MB), low RAM, good Windows fit | Adds Rust toolchain and a second language; sidecar management of the Node daemon is extra work ⚠️ | Later wrapper if size/RAM matters |
| Electron | Same JS everywhere, mature auto-update, tray | 100+ MB, higher RAM (⚠️ unmeasured here) | Fallback if Tauri's sidecar story is painful |

Recommendation: ship **web app + a tiny launcher** (Start-menu shortcut, optional tray via a startup task) in the MVP; decide Tauri vs Electron after M3 using measured RAM and installer size. Choosing now would be guessing.

## 8.2 Choices

| Concern | Choice | Why / alternative |
|---|---|---|
| Language | **TypeScript on Node 24** | Paperclip, jev-router, OmniRoute, wizard are already Node; one runtime to install and debug. Alternative Python (Hermes bridge) kept only where it exists |
| Daemon framework | Plain `node:http` + small router (as the wizard) or Fastify | Avoid heavy frameworks; add Fastify only if validation/plugins repay it |
| UI | Server-rendered HTML + small islands, or Preact/Vite | Avoid a SPA framework until screens need client state (Team and Activity probably do); keep bundle small |
| App database | **SQLite** (`better-sqlite3` or Node's built-in `node:sqlite` ⚠️ check stability on Node 24) | Embedded, one file, easy backup. Not PostgreSQL: Paperclip already runs one; we should not run two |
| Schemas | JSON Schema + Ajv (or Zod generating JSON Schema) | One validation story for files, API and UI |
| Secrets | **Windows Credential Manager** via a small native helper (e.g. `keytar`-style module ⚠️ pick a maintained one) or DPAPI-encrypted file | OS-level, no extra service. macOS Keychain on mac. Never `config.env` |
| Service supervision | Windows Task Scheduler + the daemon as supervisor (child processes), WSL services via systemd as today | A Windows service wrapper (NSSM/WinSW) only if needed ⚠️ |
| Installers | winget/MSI later; MVP is `setup.cmd` as today, with **pinned versions + SHA-256** | Replace `@latest`/`curl \| bash` |
| IPC with services | HTTP on loopback; CLI for Paperclip operations that have no API | No bespoke protocol |
| Tool protocol | **MCP** (stdio and streamable HTTP) | Standard, ecosystem exists; hosts must treat remote descriptions as untrusted |
| Workflow engine | None built. Integrate n8n/Activepieces/Sim as optional services when graph workflows are needed | n8n licence forbids bundling (doc 02); Activepieces MIT is the safer embed |
| Testing | `node:test` for logic, Playwright for UI/layout, fixture Paperclip responses recorded from the real API ("contract tests") | Contract tests catch API drift (audit item 2) |
| CI | GitHub Actions on Windows runner: lint, unit, schema, UI audit, installer dry-run | Currently none |
| Logging | Structured JSON lines, one file per component, rotation, redaction filter | Feeds Activity view |

## 8.3 Windows-first specifics

- **WSL dependency is the biggest uncertainty.** Paperclip runs in WSL today because of Linux assumptions in the agent runtime and scripts. **Spike M0-1:** run Paperclip natively on Windows; if it works with Claude Code natively, WSL becomes optional and a whole class of problems (idle shutdown, `/mnt/c` slowness, disk growth) disappears. If not, keep WSL but run it as a managed service with a keepalive.
- Long paths, file locks and Defender real-time scans affected the data cleanup today; every file-moving tool must handle `EBUSY`, special-character names and quarantine events, and write undo records first.
- Ports: allocate from a registry and check before start (3100, 4000, 4100, 20128, 54329 in use today).

## 8.4 Resource budget (targets to verify, not measurements)

| Item | Target |
|---|---|
| Control App idle | < 150 MB RAM, ~0% CPU ⚠️ target only |
| Services | on-demand except Paperclip; stop others after idle timeout |
| Disk | warn at 15% free on any drive hosting WSL or services (the disk guard rule already exists) |

## 8.5 Cross-platform

Core logic stays platform-neutral (paths via `node:path`, no shell strings in logic). Platform code is a small `platform/` module (service control, secrets, startup). macOS stays "supported but unproven" until someone tests on a Mac.
