# 5. Plugin and schema specifications

Conventions: JSON Schema draft 2020-12 as the contract; files are YAML or JSON in the repo, stored as JSON in `app.db`. Every document has `schemaVersion` (integer) and a stable `id`/`key`. Unknown fields are rejected on write and preserved on read (so newer files do not lose data on older apps). Examples are abbreviated; the full `.schema.json` files are a milestone-1 deliverable.

⚠️ Everything here is **proposed design**. Where it touches Paperclip it uses only fields I saw: agent `metadata`, instruction revisions with `contentHash`, adapters list, company export/import package, routines, skills.

## 5.1 Agent definition (canonical core + extensions)

```yaml
schemaVersion: 1
key: engineering/qa            # stable; used as stackKey in Paperclip metadata
name: QA Engineer
role: qa
title: Quality Assurance
reportsTo: engineering/manager
instructions: { file: qa.md, partials: [common, wrapup] }   # markdown with {{KEY}} placeholders
skills: [qa-testing, webapp-testing]
tools: [github, playwright]                                  # references to tool ids
runtime: { profile: claude-code-subscription }               # references a runtime profile
limits: { budgetCentsMonthly: 1500, maxConcurrentRuns: 1, schedule: "off" }
extensions:                                                   # adapter-specific, optional
  paperclip: { icon: "bug", adapterConfig: { } }
```

Core fields are meaning every adapter can honour. Anything else goes under `extensions.<adapter>`. An adapter that cannot honour a core field must say so in its capability report (5.7), and validation turns that into a warning.

## 5.2 Department and template

```yaml
schemaVersion: 1
id: software-company
version: 3
title: Software company
description: CTO, manager, frontend, backend, devops, secops, QA
params:                                  # user-visible questions the template needs
  - { key: PROJECTS_ROOT, type: path, required: true }
  - { key: STAGING_BRANCH, type: string, default: staging }
agents: [ { ref: cto.yaml }, { ref: manager.yaml } ]
tools:  [ github ]
routines: [ { title: Weekly report, cron: "30 17 * * 5", agent: engineering/manager } ]
requires: { services: [paperclip, jev-router], skills: [ponytail-review] }
```

Templates are versioned and immutable once published; a workspace pins `template@version` and upgrades explicitly (the reconciler shows the diff). `org/<dept>/department.json` converts mechanically into this form (migration, doc 09).

## 5.3 Workspace

```yaml
schemaVersion: 1
id: emergen
kind: company            # company | personal
orchestrator: paperclip  # none for personal
roots: [ "C:\\Abbas\\Emergen" ]        # filesystem roots tools and agents may touch
departments: [ engineering, operations, branding, freelance ]
policy: { defaultPermission: ask, externalWrites: ask, networkNote: "disclose-only" }
budget: { monthlyUsd: 100, hardStop: true, alertAt: 0.8 }
services: [ paperclip, jev-router, omniroute ]
```

## 5.4 Skill

Keep the existing format (`skills/<name>/SKILL.md` with frontmatter). Add an optional `skill.json` for provenance: `{ "source": "vercel-labs/skills", "version": "1.2.0", "license": "MIT", "sha256": "..." }`. No new skill system; skills stay compatible with Claude Code.

## 5.5 Tool (manifest)

```yaml
schemaVersion: 1
id: downloads-organizer
version: 0.3.0
title: Downloads organizer
kind: local            # local | mcp | http
entry: { command: node, args: ["watcher.mjs"], cwd: "." }       # kind=local
# mcp:  entry: { command: npx, args: ["-y", "pkg@1.2.3"] }  | { url: "http://127.0.0.1:...", transport: streamable-http }
inputs:  { $schema: "...", type: object, properties: { folder: { type: string, format: path } } }
effects:                 # declared up front; enforced by the runner
  reads:  ["{{roots}}"]
  writes: ["{{roots}}"]
  deletes: false
  network: []            # hostnames the tool says it contacts; informational on Windows (see doc 03, 3.8)
  external: false        # writes to a third-party system?
risk: medium             # low | medium | high; sets default permission (ask for medium/high)
supportsPlan: true       # mutating tools MUST return a plan before executing
undo: { kind: recovery-folder }
secrets: []              # names resolved from the secret store at run time
```

Rules: a tool with `deletes: true` or `external: true` is always `ask` for first use. `supportsPlan: false` is only legal for read-only tools.

## 5.6 Integration

```yaml
schemaVersion: 1
id: upwork
kind: mcp
server: { url: "https://mcp.upwork.com/mcp", transport: streamable-http }
auth: { type: oauth, secretRef: upwork }       # handled by the host; tokens only in the secret store
toolPolicy:                                     # per remote tool; default is ask
  "*": ask
  searchJobs: allow
  submitProposal: ask
target: { paperclip: { agents: ["freelance/upwork-specialist"] } }   # who gets it
```

Remote tool names and descriptions are untrusted: policy keys are matched against the names the server returns; unknown tools default to `ask`.

## 5.7 Framework adapter (service adapter contract)

An adapter is a small module the Control App loads; it is the **only** place that knows a framework's API.

```ts
interface FrameworkAdapter {
  id: "paperclip" | "hermes" | "openclaw" | string;
  capabilities(): { kinds: ("orchestrator"|"runtime"|"gateway"|"workflow-engine"|"model-gateway")[]; honours: string[] };
  install(spec: ServiceSpec): Journal;          // pinned version, checksum
  start(): Promise<void>; stop(): Promise<void>;
  health(): Promise<{ ok: boolean; detail: string; version: string }>;
  doctor(): Promise<Finding[]>;                 // e.g. orphan rows, port clash
  // optional, orchestrators only:
  snapshot(): Promise<PackageRef>;              // e.g. paperclipai company export
  readState(): Promise<ObservedState>;          // agents/routines as they are now
  plan(desired: Blueprint, observed: ObservedState): Plan;   // three-way compare (doc 03, 3.4)
  apply(plan: Plan): AsyncIterable<StepResult>;
}
```

The first and only adapter shipped in the MVP is **paperclip**, extracted from `wsl/40-org.sh`. Additional adapters are added when a real use appears; the interface above is deliberately not final until the second adapter exists (⚠️ an interface designed from one implementation is a guess).

## 5.8 Workflow

Two tiers, because a visual builder is not MVP:

1. **Routine-level** (MVP): `trigger` + ordered `steps` mapped to Paperclip routines and issue assignment, plus approval gates. Stored in the blueprint as:
```yaml
id: ticket-to-pr
trigger: { type: event, source: odoo.ticket.tagged }
steps:
  - { id: triage,    agent: engineering/manager }
  - { id: implement, agent: engineering/backend, after: triage }
  - { id: review,    agent: engineering/qa,      after: implement }
  - { id: approve,   gate: human, channel: discord, after: review }
```
2. **Graph-level** (later): a node/edge graph executed by an external engine (n8n/Activepieces/Sim) through an adapter. The same `steps` model compiles to it; no custom engine is written.

Validation: DAG only, every `after` exists, every `gate: human` has a channel, every `agent` exists.

## 5.9 Model routing policy

```yaml
schemaVersion: 1
profiles:
  - id: claude-code-subscription
    runtime: claude_local
    endpoint: jev-router            # ANTHROPIC_BASE_URL only; keeps the subscription
    tiers: { fast: haiku, balanced: sonnet, frontier: opus }
    decidedBy: jev-router
  - id: other-agents
    runtime: [codex_local, hermes_local, openclaw_gateway]
    endpoint: omniroute
    combos: { fast: combo-fast, balanced: combo-balanced, frontier: combo-frontier }
    decidedBy: decision-service
rules:
  - { when: "task.kind == 'review'", tier: balanced }
  - { when: "budget.remaining < 0.1", tier: fast }
fallback: { onProviderError: next-combo, onQuota: next-provider }
```

Constraint recorded in the schema validator: a profile whose runtime is Claude Code **must not** name any non-Anthropic model or the `omniroute` endpoint (Anthropic does not support this; doc 02).

## 5.10 Permission model

Three layers, evaluated in order; the first `deny` wins, otherwise the most restrictive `ask` wins:

| Layer | Source | Example |
|---|---|---|
| Workspace policy | workspace.yaml | external writes: ask |
| Tool risk | tool manifest | deletes: always ask |
| Per-agent grant | agent `tools` + integration `toolPolicy` | QA may read GitHub, not push |

Subjects: user, agent, workflow step. Decision outputs: `allow | ask | deny`, each logged with the rule that decided it. **A model's output is never a rule input for granting permission** (only for classification of non-privileged things such as routing).

## 5.11 Validation and versioning

- Every file validated on load and on write; errors carry JSON-pointer paths and a fix hint.
- `schemaVersion` bumps only for breaking changes; the app ships migrations (`v1->v2`) as pure functions with tests; an older app refuses newer files rather than guessing.
- Blueprint and template hashes use canonical JSON (sorted keys) so equal content gives equal hashes on every machine.
