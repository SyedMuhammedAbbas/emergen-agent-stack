# M4: tools and integrations

Two separate things, because they fail differently.

## 1. Local tools: plan, confirm, execute, undo (`packages/tools`)

A tool is a folder with `tool.json` (manifest) and a planner. **The planner only returns operations as data**; it never touches the disk. The runner does.

- Vocabulary: `mkdir` and `move`. No delete, no overwrite, no network. A manifest that says `deletes: true` or `external: true` is rejected, and a manifest cannot set its own permission: anything that writes is "ask", derived by `validateManifest`.
- Sandbox (`sandbox.mjs`): every path is resolved through the real file system (symlinks and junctions followed, `realpath.native`) and must land inside a root the person named. Refused: `..` escapes, NUL bytes, `\\?\` / UNC / device prefixes, alternate data streams, reserved names (`NUL`, `CON`...), names ending in dot or space, paths over 240 characters, links as move sources, a whole drive as a root.
- Flow: `stack tools plan <tool> --root <folder>` writes a plan and prints a code (hash of exactly those operations). Nothing changed. `stack tools apply <plan> --confirm <code>` re-validates every operation (files may have changed), refuses a plan edited on disk, refuses a destination that now exists, and journals each step. `stack tools undo <run>` moves files back, newest first, and refuses any file whose size or SHA-256 changed since it was moved.
- The Downloads organiser is now `tools/downloads-organizer/tool.json` + `plan.mjs` (same `rules.js`). The always-on background watcher is unchanged: it is the standing, already-approved path with its own log; the on-demand tool is how you clean a backlog with a preview and undo.

## 2. MCP integrations: allow / ask / off per tool (`wsl/hooks/mcp-policy.*`)

Claude Code is the MCP host (agents already run `claude mcp add` servers); we do not re-implement the protocol. What was missing is control, because all agents run with `--dangerously-skip-permissions`, so permission rules are ignored but hooks still fire.

- `integrations/<name>.json` is the owner's policy per server (`toolPolicy`, default `ask`). `stack integrations sync` writes `~/.agent-stack/integrations.json`; `wsl/40-org.sh` runs it and installs a `PreToolUse` hook with matcher `mcp__.*`.
- `allow` passes; `ask` is refused unless you ran `stack integrations grant <server> <tool> --minutes n` (exact tool, 24 h maximum); `off` is always refused. Servers not listed are `ask`. No policy file means the hook does nothing, so setups without integrations are unchanged. An unreadable policy or call is refused (fail closed).
- Nothing a server says about itself is an input: descriptions, annotations such as `readOnlyHint`, and arguments are never read for the decision. Policy keys use `Object.hasOwn`; unknown values count as `ask`.
- `integrations/upwork.json` ships with everything on `ask`. Move read-only tools to `allow` after you have seen the real tool names (`/mcp` in Claude Code); writes stay `ask`.

## Not done, and why

- **Registering integrations into Paperclip's tool connections.** I have not verified a Paperclip API for it, so I did not guess one.
- **The hook is not installed on your live agents yet.** It is installed when `wsl/40-org.sh` next runs (`install.ps1 -OnlyOrg`, or the Set up screen). Until then the tests are the evidence, not the running system.
- **Third-party planners.** Planners run in-process, so only first-party tools in this repo may be runner tools. Untrusted code would need a subprocess and is out of scope.
- **GitHub integration.** `gh` is already authenticated in WSL and the agents use it; a policy entry for a GitHub MCP server can be added the same way as Upwork when you use one.
- Cross-volume moves fail (rename only) rather than copy-and-delete, because there is no delete.

Tests: `node --test packages/tools wsl/hooks` (traversal, junction escape, malicious planners and manifests, tampered plan, undo round trip byte-identical, changed-file refusal, hook exit codes and fail-closed cases).
