# 3. Recommended architecture

## 3.1 Where I disagree with the six-layer sketch

The sketch has a Unified Application (1), a Core Control Plane that owns workspaces, workflows, scheduling and lifecycle (2), and framework adapters beneath it (4). Three problems:

1. **Layer 2 duplicates Paperclip.** Paperclip already owns tasks, org chart, approvals, budgets, routines, multi-organization isolation, templates and export/import, with a 728-path API (doc 02, 2.3). A second control plane means a second model of the same company and a permanent synchronisation problem, which is exactly what hurts this repo today (doc 01, items 1 to 3).
2. **"Framework-independent agent definition" translated into each framework is a lowest-common-denominator trap.** I recommend a small canonical core plus per-adapter extension blocks, and only one adapter (Paperclip) until a real second use exists.
3. **Layers 1 and 2 are one deployable.** Splitting UI and control plane into separate products adds a process and an API with no user benefit.

**The cut I recommend:** the product is one local daemon with a web UI (the **Control App**). Paperclip stays the **system of record for company work**. The Control App owns what no existing product owns: onboarding, templates, service management, tools, the decision service, secrets, and the unified view.

## 3.2 System diagram

```
                      browser (or desktop shell later)
                                 |
                  loopback + one-time token (like the wizard)
                                 v
  +--------------------------------------------------------------------------+
  | CONTROL APP  (one Node/TypeScript daemon, SQLite, ~tens of MB idle)       |
  |                                                                          |
  |  Onboarding   Registry &        Service        Decision &     Tools &    |
  |  compiler     Reconciler        Manager        Model          Integrations|
  |  (NL ->       (desired state,   (start/stop/   service         runtime    |
  |  blueprint)   drift, templates) update/doctor) (Jev + rules    (MCP host, |
  |                                                 + gateways)    fs-safe)  |
  |                                                                          |
  |  Secret store    Activity log (decisions, runs index, audit)    Backups   |
  +--+---------------+----------------+-----------------+-------------+------+
     |               |                |                 |             |
 Framework adapters (one per role, all optional, started on demand)
     |               |                |                 |             |
 Paperclip       jev-router        OmniRoute         Hermes /       n8n /
 (orchestrator)  (Claude tier)     (other providers) OpenClaw       Activepieces
 + its Postgres  :4000             :20128            (runtime +     (workflow
 :3100                                                gateway)       engine)
     |
 agent runtimes via Paperclip adapters: Claude Code, Codex, Hermes, OpenClaw ...
     |
 your repos (git worktrees), files, external services (GitHub, Odoo, Discord, ...)
```

## 3.3 Components and what each owns

| Component | Owns (system of record) | Does not own |
|---|---|---|
| **Onboarding compiler** | The conversation, the generated Workspace Blueprint draft, validation results | Anything after the user approves |
| **Registry and Reconciler** | Workspaces, blueprints, templates and overlays, applied-state hashes, drift reports | Agents, tasks, approvals, budgets: those stay in Paperclip |
| **Service Manager** | Which services are installed, versions, ports, health, logs, start policy | The services' internal data |
| **Decision and Model service** | Decision definitions, thresholds, labelled examples, decision log, runtime-to-gateway profiles | Provider accounts' billing; the models themselves |
| **Tools and Integrations runtime** | Tool registry, permissions, run history, MCP server registry | The external services' data |
| **Secret store** | Credentials (Windows Credential Manager or DPAPI; see doc 08) | Nothing else reads files for secrets |
| **Paperclip** | Company, agents, issues, runs, approvals, routines, budgets, skills | Installation, other frameworks, personal tools |

Rule: **every fact has one owner.** If the Control App needs agent state it reads Paperclip's API; it never keeps a copy it could disagree with. The one deliberate copy is the *desired state* (the blueprint and templates), which is how drift can be detected.

## 3.4 The reconciler: how UI edits stop being overwritten

The audit's top problem (doc 01, item 1). Verified fact that makes the fix possible: every Paperclip agent has a free-form `metadata` field, and instructions have revisions with a content hash (`GET .../instructions-bundle/file` returns `revision.id` and `contentHash`; confirmed on the live instance).

For each template-managed object the reconciler stores in Paperclip `metadata`: `stackKey` (stable id such as `engineering/qa`), `templateVersion` and `appliedHash` (hash of what it last wrote). On each apply, per object, compare three values:

| Live (Paperclip) vs last applied | Template vs last applied | Action |
|---|---|---|
| unchanged | unchanged | nothing |
| unchanged | changed | apply the new template |
| **changed** (a person edited it) | unchanged | **keep the live edit** |
| changed | changed | **conflict:** show both in the UI; never overwrite silently |

This also fixes duplicate creation: lookup is by `stackKey`, not by name or a separate `ids.json`.

Applying is a **journalled transaction**: write a plan, snapshot (`paperclipai company export` is available and is the rollback source), apply step by step, verify by reading back, and on failure stop and offer rollback. It never deletes a Paperclip agent through the API without first checking for dependent rows (the orphan-row crash, doc 01 item 3); where Paperclip itself leaves orphans, the Service Manager's `doctor` detects them.

## 3.5 Flows

**Agent execution (company workspace).**
1. A task arrives: typed in the UI, created by the Hermes Odoo intake, or classified by the decision service.
2. Paperclip creates an issue, assigns it, and wakes the agent (heartbeat or assignment).
3. Paperclip's adapter starts the runtime (`claude_local`) in a git worktree.
4. The runtime calls its model endpoint: Claude Code goes through jev-router (3.6).
5. Tool calls go through Paperclip's connections and tool gateway for company tools, or the Control App's MCP host for tools the user installed.
6. Risky steps become approvals in Paperclip; the Hermes bridge relays them to Discord, unchanged.
7. The Control App's Activity view merges Paperclip runs and approvals, the decision log and gateway cost headers into one timeline.

**Personal workspace (no company).** There is no orchestrator. The user runs tools directly or schedules them; an optional assistant (AnythingLLM, OpenClaw or Hermes) can be given tools through MCP. Paperclip is not installed unless the user adds a company workspace.

**Model routing.** Each agent runtime has a *runtime profile* naming exactly one endpoint:

| Runtime | Endpoint | Who decides the tier |
|---|---|---|
| Claude Code | jev-router `:4000` | jev-router (Jev) |
| Codex, OpenCode, Hermes, OpenClaw, tools | OmniRoute `:20128` | Decision service picks a tier or combo name, OmniRoute maps it to providers and falls back on quota or errors |
| Manual | chosen model id | the user |

No chain of two routers. The Models screen shows both paths and their cost and health.

**Tool execution.**
1. Invoked by a user, an agent, or a workflow step.
2. **Permission check:** the tool manifest's requested permissions against the workspace policy.
3. **Plan:** a mutating tool must first return a plan (what it would move, rename or delete).
4. **Confirm:** a person, or an explicit standing policy for that tool and folder.
5. **Execute** in the runner with filesystem access limited to the allowed roots.
6. Write an **undo record** (originals go to a recovery folder, as the duplicate cleanup did today) and an audit entry.

## 3.6 Integration architecture

- Integrations are **MCP servers or OAuth/API connectors**, described by the schema in doc 05. Credentials live only in the secret store.
- For company agents the app registers an integration into Paperclip's own connection and tool-gateway objects (the API has `/tool-connections` and `/tool-gateway` groups) so Paperclip's per-agent "Allowed / Ask first / Off" settings apply. The app does not build a second gateway.
- For personal tools the Control App is the MCP **host**: it starts the server, lists its tools, and checks every call against permissions.
- n8n or Activepieces, if installed, are just another integration: reachable through their MCP support (n8n's instance-level MCP is opt-in per workflow).
- MCP safety rules from the spec are enforced by the host: tool descriptions are untrusted text, and a tool call needs consent according to the tool's risk class.

## 3.7 Local storage

```
%LOCALAPPDATA%\AgentStack\            (one root; relocatable)
  app.db                               SQLite: workspaces, blueprints, registry, tool runs, decision log, drift reports
  workspaces\<id>\                     blueprint.json, template overlay, last export package
  services\<name>\                     versions, per-service config and logs
  backups\                             scheduled snapshots (app.db, workspace folders, Paperclip db:backup)
  logs\                                one log per component, rotated
%USERPROFILE%\.paperclip\              Paperclip's own data (not copied or merged; backed up with its db:backup command)
Windows Credential Manager             secrets
```

`config.env` remains readable for compatibility during migration and is generated from `app.db` by the reconciler, so the legacy scripts keep working until retired.

## 3.8 Security boundaries

| Zone | Boundary | Control |
|---|---|---|
| Browser to Control App | loopback only, one-time token, Host and Origin checks, JSON bodies only (implemented and tested in the wizard) | already built |
| Control App to managed services | loopback, per-service token where the service supports it | Paperclip is `local_trusted` today (no auth); acceptable single-user, flagged for shared machines |
| Agents and tools to files | allowed roots per workspace, mutating actions go through plan, confirm, undo | enforced by our runner for our tools. ✅ M0: agents launched by Paperclip run with `--dangerously-skip-permissions` (default, all 18 agents), so only hooks (`device-guard`), worktrees and rules constrain them; a path/command allow-list hook is needed (doc 11, section 4) |
| Secrets | OS store; never written to `config.env`, logs or the blueprint | new |
| External content (tickets, emails, web pages) | treated as untrusted data; never allowed to change permissions or approve anything; classification by Jev or an LLM cannot grant privileges | policy plus a content label carried through tool calls |
| Supply chain | pinned versions with checksums for every managed service; no `curl \| bash` | replaces today's `@latest` installs |
| Spend | per-workspace ceilings read from gateway headers and Paperclip run costs; stops at a hard limit | Paperclip's own counters ignore subscription runs, so the ceiling is computed from per-run costs (as the Chief of Staff already does) |

Network egress control per agent is **not reliably enforceable on Windows** without a sandbox; I would not promise it in the MVP. The honest guarantee is: no secrets in agent context, no unapproved writes to external business systems, and clear disclosure of which configured services send data off the machine.

## 3.9 Resource efficiency

- Services declare a start policy: `on-demand` (default for OmniRoute, workflow engines, Hermes), `always` (Paperclip while a company workspace is active). The Service Manager starts them when a workspace needs them and stops them after an idle period.
- Today's measurements point at the real cost drivers: idle *agents*, not idle services. A Manager heartbeat every 30 minutes cost about $0.28 a wake (about $400 a month if left on); the app should show projected idle cost before the user chooses a schedule, as the wizard does today.
- ⚠️ I did not measure idle RAM and CPU of Paperclip with its embedded PostgreSQL; do that in the first spike.
