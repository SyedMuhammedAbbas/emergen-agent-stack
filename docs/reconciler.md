# The reconciler (`stack`)

Applies the agents and routines in `org/` to Paperclip **without overwriting what people changed there**. The old `wsl/40-org.sh` rewrote every agent on each run; the reconciler compares three things per field: what the template says now, what Paperclip has now, and what it last wrote. Design and API findings: [architecture/12-m1-plan.md](architecture/12-m1-plan.md), [architecture/13-m1-api-findings.md](architecture/13-m1-api-findings.md).

Run it inside WSL (where `jq`, the renderer and Paperclip are): `node apps/cli/stack.mjs <command>`. Options: `--api <origin>` (default `http://127.0.0.1:3100`), `--state <dir>` (default `~/.agent-stack`), `--only <agent key>`.

| Command | What it does |
|---|---|
| `render` | Writes the desired state to `~/.agent-stack/desired/` (same renderer as `40-org.sh`) |
| `plan [--json]` | Shows what would change. Read-only |
| `adopt [--take-template]` | Tags existing agents as managed. By default **their live values are kept** and differences are remembered; `--take-template` overwrites them with the template |
| `apply --yes [--keep-live \| --take-template]` | Applies. Without `--yes` it only prints the plan |
| `rollback [id \| latest]` | Undoes one apply from its journal (`~/.agent-stack/journal/`) |
| `doctor` | Checks the Paperclip server still has the API the reconciler was built for |

## Reading `plan`

| Tag | Meaning |
|---|---|
| `ok` | Nothing to do |
| `adopt` | Matches the template; applying only records it |
| `keep` | A person changed this in Paperclip; it is kept. The fields are listed |
| `update` | The template changed; the listed fields will be written |
| `create` | Not in Paperclip yet |
| `DECIDE` | Both sides changed the same field (or an unmanaged agent differs). **Nothing is written for that agent** until you choose `--keep-live` or `--take-template` (add `--only <key>` to decide one agent) |

## Turning it on

1. `node apps/cli/stack.mjs render` then `plan`. Check the output.
2. `node apps/cli/stack.mjs adopt --yes` once, so the existing agents become managed.
3. Set `RECONCILER=1` in `config.env`; `install.ps1 -OnlyOrg` then uses the reconciler for agents and routines (skills import, hooks, watchdog and the rest are unchanged). `STACK_APPLY_ARGS` can pass flags such as `--take-template`.

## Things to know

- **It never deletes** an agent or routine. Agents created by an apply are left in place by `rollback`.
- **Env values** (for example the router URL) cannot be read back from Paperclip, which redacts them. Their key names are compared; a changed template value is always written; a value changed by hand in the UI is not noticed. `rollback` cannot restore old env values and says so.
- Skills named in a template but not imported into Paperclip are reported as a warning and ignored, so they don't cause a permanent difference.
- Everything outside the managed fields (working directory, permission settings, status, appearance, the server's instruction paths) is never touched.
- One apply at a time (lock file). If it stops half way, the message names the journal to roll back.
- Tests: `node --test packages/reconciler/test/plan.test.mjs`, `packages/adapter-paperclip/test/contract.test.mjs`, and, against a throwaway Paperclip, `tools/scratch-paperclip/scratch.sh start` then `node --test packages/reconciler/test/integration.test.mjs`.
