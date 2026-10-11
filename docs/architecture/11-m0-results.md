# 11. M0 spike results

Run 2026-10-11 on this PC (Windows 11, WSL Ubuntu 24.04, Paperclip 2026.1005.0, Node 24.21.0). Everything below was run, not assumed, unless marked ⚠️. Scripts and artifacts are in `spikes/` (git-ignored except the scripts). The live company was only read; all writes went to throwaway instances on other ports.

## Summary

| # | Spike | Result | Effect on the design |
|---|---|---|---|
| 1 | Native Windows Paperclip | ✅ **Server and embedded PostgreSQL run natively.** ⚠️ A real agent run is not proven yet | Conditional go; WSL stays the default until M0b passes |
| 2 | Export / import round trip | ✅ Works with 4 workarounds; metadata survives | Snapshot/rollback via export is viable; needs a wrapper |
| 3 | Idle resources | ✅ ~1.3 GB RAM for the WSL stack, low CPU | `on-demand` start policy is justified for OmniRoute |
| 4 | `claude_local` permission mode | ✅ **All 18 agents run with `--dangerously-skip-permissions`** | Safety rests on hooks and worktrees; harden in M4 |
| 5 | Jev accuracy / latency | ⛔ Not run | Needs the Use Cases Guide and a Jev API key |

## 1. Native Windows

What worked: portable Node 24.21.0 (checksum verified) plus `npm install paperclipai@2026.1005.0` into an isolated folder (383 packages, 4 min, 1.3 GB). The server started in 15 s with embedded PostgreSQL (a `@embedded-postgres/windows-x64` build exists). Importing the live company created 20 agents; the CLI doctor passed; the `claude_local` environment test resolved the `claude` command and working directory.

What did not, or needs care:

- **Blocked:** a real agent run. The Windows `claude` CLI is not logged in (`claude auth status` says `loggedIn: false`; the earlier logins were inside WSL), and the probe reported "login is required". Needs `claude login` on Windows from you, then M0b.
- **Hang after a killed first run:** reusing a data-dir path after its PostgreSQL was killed made `initdb` hang about 4 minutes and then fail. A fresh path worked in 15 s. Cause not proven; my best explanation is a stale shared-memory name held by the dead process (⚠️). The Service Manager needs "kill orphan postgres, use a new path" handling.
- **Ports clash with WSL:** a default native onboarding takes `3100` and `54329`. Use distinct ports (the spike used 3299 / 54499).
- **No service management on Windows:** the doctor prints "Service management is not supported on win32". Our app must supervise Paperclip itself.
- **BOM breaks config:** PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM and Paperclip rejects the JSON. Any Windows writer must write BOM-less UTF-8.
- **npm blocked three install scripts** (`@embedded-postgres/windows-x64`, `ssh2`, `protobufjs`). It still worked; effect unknown (⚠️).
- ⚠️ Not tested natively: git worktrees, our bash hooks (`wsl/hooks/*.sh` need a bash on Windows), Hermes bridge.

Verdict: **feasible, not yet proven.** Do not remove WSL from the plan until M0b (one real agent run with hooks and a worktree) passes.

## 2. Export / import round trip

`paperclipai company export` then `import --target new` into a clean instance, compared agent by agent (names matched, ids and paths normalised):

- ✅ Identical on role, title, adapter type, budget, icon, model, env vars, skill list, permissions, heartbeat settings (including `enabled:false`), and the reporting hierarchy.
- ✅ **`metadata` survives** when non-empty (I set `stackKey` and `appliedHash` on one agent; both exported to `.paperclip.yaml` and came back after import). The `stackKey` approach in doc 03 works.

Problems found (all handled by a wrapper, none by hand):

1. **Unpinned built-in skills block the import.** All 8 built-in Paperclip skills export with `commit: null` and the importer refuses ("must resolve to a pinned Git commit"). Workaround that worked: rewrite them to the server's build commit.
2. **Import is not transactional.** A failed import still left an empty company behind each time (three in this test).
3. **Phantom agents.** Import created 2 extra agents (`vercel-react-best-practices`, `vercel-react-native-skills`) from skill folders that contain an `AGENTS.md`. A rollback via import must filter these.
4. **Machine-specific fields are dropped:** the `claude` command path is omitted from agent config ("system-dependent"), and instruction file paths are regenerated. Harmless, but the package is not a byte-exact backup.

Conclusion: export is a good **snapshot for the reconciler's journal**, not a complete disaster-recovery backup. Keep `db:backup` for that.

## 3. Idle resources (short sample, 30 s, shortly after startup ⚠️)

| Service | RAM | CPU (30 s) |
|---|---|---|
| Paperclip + embedded PostgreSQL (WSL) | 753 MB | ~6% of a core |
| OmniRoute (WSL) | 489 MB | ~0.2% |
| jev-router (WSL) | 18 MB | ~0% |
| Native Windows Paperclip (20 processes) | 855 MB | ~7% of a core |

OmniRoute costs 489 MB idle for a service used by some agents only, so `on-demand` is the right default. Idle *agents* (heartbeats) remain the larger cost driver than idle services. Re-measure after an hour of steady state before quoting these.

## 4. Permission mode of `claude_local`

Read from the adapter source (`adapter-claude-local/dist/server/permissions.js`, `execute.js`): `dangerouslySkipPermissions` **defaults to `true`** and adds `--dangerously-skip-permissions`. Live check: none of the 18 agents sets it, so **all 18 run with permissions skipped**. A non-interactive agent cannot answer permission prompts, so turning it off would stall runs rather than make them safer.

Consequence: the real controls are (a) git worktrees, (b) the `device-guard` PreToolUse hook (hooks still run in this mode), and (c) prose rules. The earlier doc text ("limited to Claude Code permissions") was too generous. M4 should add a **path/command allow-list hook** and treat it as the enforcement layer; the tool runner's `plan/confirm/undo` applies to our tools, not to arbitrary shell commands an agent runs.

## 5. Jev

Not run. The guide has arrived (doc 06); still needs a Jev key (via OpenRouter) and a labelled set (the Downloads move logs are a free one). Latency, accuracy, long-input behaviour and self-hosting remain ⚠️.

## Other observation (not a spike target)

The live Paperclip stopped twice today when my last WSL session closed (journal: "Stopping paperclipai.service" together with my scratch unit at 19:37:45) and came back when a new session opened. This is the idle-stop problem from the audit. `loginctl enable-linger syedabbas` in WSL would likely fix it more simply than the scheduled-task keepalive; it is a system setting, so I have not changed it (⚠️ unverified that it fixes this).

## Decisions these results support

| Decision | Status |
|---|---|
| D1 Paperclip stays the company control plane | Reinforced: export/import and `metadata` give the reconciler what it needs |
| D3 Native Windows | Conditional: server proven, agent run unproven; run M0b before choosing |
| Reconciler snapshots | Use export through a wrapper (pin fix, phantom filter, empty-company cleanup) plus `db:backup` |
| Security model | Update doc 03 §3.8: agent file/command access is enforced by hooks, not Claude permissions |

## M0b: real agent run on native Windows (after `claude login`)

Setup: scratch instance on :3299, imported QA agent set to `claude-haiku-5-5`, working directory a scratch git repo with a project-level PreToolUse hook (written in node), one issue "write hello.txt". Script: `spikes/m0b-setup.ps1`.

- ✅ **The run succeeded:** exit 0 in about 18 s, cost reported $0.009, billed as `subscription_included`. `hello.txt` contains `native ok`, and the issue moved to `done`. The environment test (including the hello probe) now passes.
- ✅ **Hooks fire natively:** the project PreToolUse hook logged 1 Write and 7 Bash events.
- ❌ **Every skill failed to load, silently.** Paperclip materialises skills as **symlinks**, and Windows refused: `EPERM: operation not permitted, symlink ...` for all 17 skills of that agent (our shared skills and the built-in `paperclip` skill). The run still "succeeded", so nothing flagged it. Fixes: enable Windows **Developer Mode** (or run elevated), which is a system setting for you to apply, or accept junction/copy materialisation if Paperclip offers it (⚠️ not checked). The app's `doctor` must test symlink creation and fail loudly.
- ⚠️ Not exercised: per-issue git worktrees (the agent ran directly in the configured directory, no project workspace was set), our bash hooks (`wsl/hooks/*.sh` need Git Bash), Hermes bridge.

Updated verdict for native Windows: **runs, but not equivalent to WSL yet**; skills (the core of our agents' instructions) need the symlink privilege, and the bash hooks and worktree flow are unverified. Treat as a supported option after one more spike (M0c: Developer Mode on, a project workspace with worktrees, `device-guard` through Git Bash).

## M0c: native Windows with Developer Mode on

Script: `spikes/m0c-setup.ps1`. Same QA agent, now through a Paperclip **project with a git-worktree policy** (mirroring `wsl/50-connect-project.sh`), plus the repo's real `wsl/hooks/device-guard.sh` wired through Git Bash.

- ✅ **Skills load.** Zero `EPERM` lines (17 in M0b). Symlinks work from Node under Developer Mode. Note: PowerShell 5.1 `New-Item -ItemType SymbolicLink` still fails ("Administrator privilege required") because it does not pass the unprivileged flag; only Node-based code (Paperclip) is fine. The app's `doctor` must test with Node, not PowerShell.
- ✅ **Per-issue worktrees work.** Issue NAT-2 got its own worktree and branch (`worktrees/NAT-2-m0c-worktree-device-guard`), and the agent wrote its file there, not in the main checkout.
- ✅ Run succeeded, exit 0, $0.012, subscription-included. Project hooks fired again.
- ❌ **`device-guard.sh` fails open on Windows.** Git Bash has no `jq`; the script's first line then yields an empty tool name and it exits 0, allowing everything. Tested directly: `adb install test.apk` returned exit 0 (the WSL version blocks it). In this run the agent still refused the `adb install`, but because of its own written QA rules (it filed a "Question for board" and the issue went to `blocked`), not because of the hook.
- ⚠️ The bash on `PATH` is `C:\Windows\System32\bash.exe`, the **WSL launcher**, not Git Bash. A hook command must name Git Bash by full path (as the spike did) or it runs inside WSL.

**Fixed (2026-10-11, on your approval):** the guard's rules moved to `wsl/hooks/device-guard.mjs` (node only, no `jq`, no bash). It denies with exit 2 when the input is empty, malformed, not an object or an array, or a Bash call has no command. `device-guard.sh` is now a thin wrapper that also denies if node is missing, so the WSL/macOS settings did not change; on native Windows the hook command can be `node ".../device-guard.mjs"` with no bash at all. `wait-for-background.sh` lost its two `jq` uses but stays fail-open on purpose (blocking forever would trap an agent; it has a 40-attempt safety valve). Verified: `device-guard.test.mjs` (5 tests, pass on Windows Node 24 and Linux Node 24); `verify-linux.sh` shows identical exit codes to the old jq/grep guard on 13 commands, fail-closed behaviour without node, and valid JSON from the Stop hook for a command containing quotes and backslashes. The three files were copied into the live `~/.claude/hooks` and exercised through the registered settings command. One parity note: a bare `install -r x.apk` at the start of a line was never matched by the old rule either (it needs whitespace before `install`); kept as is.

Updated verdict: native Windows is **viable** for Paperclip plus Claude Code (server, skills, worktrees, hooks, subscription billing all verified), with these conditions: Developer Mode, Git for Windows, jq-free fail-closed hooks, supervision of Paperclip by our app (no Windows service support), and the orphan-Postgres handling from section 1. Remaining unverified natively: Hermes bridge, long-running stability, and the `watchdog`.

## WSL linger result

`loginctl enable-linger syedabbas` is applied (`Linger=yes`) but **did not stop the shutdowns**. The journal shows the whole distro re-booting (systemd started from scratch at 20:12:07) after all sessions closed, so the distro itself is terminated when no `wsl.exe` process is open, which linger cannot prevent. A Windows-side process that keeps one `wsl.exe` session open is still required (the scheduled-task keepalive `windows/wsl-host.ps1`, registered by a normal `.\install.ps1` run), or running Paperclip natively. Linger is harmless and can stay.

## To finish M0

1. ~~Windows symlinks~~ done (M0c). ~~Hooks jq-free and fail-closed~~ done (see M0c).
2. **WSL keepalive:** run `.\install.ps1` normally (not from this session) to register it, or tell me to try another route.
3. **Jev:** guide received (doc 06). Still needed: an OpenRouter key placed in the secret store by you.
