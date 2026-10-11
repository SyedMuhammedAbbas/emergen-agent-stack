# 2. Competitor and technology research

Checked 2026-10-11 from official repositories and docs (links in each row). ✅ = stated by the project's own README or docs, or confirmed on this PC; ⚠️ = I could not confirm it from a primary source, so it is an assumption.

## 2.1 The first finding: these products live at different layers

The prompt groups Paperclip, Herdr, Hermes, OpenClaw, n8n and others as options for one slot. They are not. Naming the layer each one occupies is what makes the architecture simple.

| Layer (role) | What it does | Products that fill it |
|---|---|---|
| Company orchestrator | Org chart, tasks, approvals, budgets, routines, many agents | **Paperclip** |
| Agent runtime | Runs one agent: a model plus tools plus memory | Claude Code, Codex, Gemini CLI, OpenCode, **Hermes Agent**, **OpenClaw** |
| Runtime host | Keeps agent terminals alive, shows who is blocked | **Herdr** |
| Communication gateway | Chat channels in and out (Discord, Slack, Telegram) | Hermes gateway, OpenClaw, Paperclip chat connectors (experimental) |
| Workflow engine | Deterministic triggers, actions, integrations | **n8n**, **Activepieces**, Sim |
| Model gateway | One endpoint over many providers | **OmniRoute**, LiteLLM, Portkey, jev-router (Claude-only) |
| Decision model | Fast typed classification and scoring | **Jev** (TypeSafe System One) |
| Tool protocol | How tools are described and called | **MCP** |
| Personal assistant | Chat with your documents and tools | AnythingLLM, OpenClaw, Hermes |

## 2.2 Product notes

| Product | What it is (verified) | License | Activity | Local install | Fit for us |
|---|---|---|---|---|---|
| [Paperclip](https://github.com/paperclipai/paperclip) | "Node.js server and React UI that orchestrates a team of AI agents." Org charts, budgets, governance, heartbeats, routines, multi-organization, task threads, skills, apps and connections (MCP), a team catalog, export/import. Works with Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Pi, Hermes, OpenClaw, Grok, Kimi. ([README](https://github.com/paperclipai/paperclip), [docs](https://docs.paperclip.ing)) | MIT | 100k stars, pushed daily; npm shows 1,790 versions and daily canary builds | `npx`-style CLI, embedded PostgreSQL ✅ (running here) | **The control plane for company workspaces.** Already does what Layer 2 of your proposed architecture describes |
| [Herdr](https://github.com/herdrdev/herdr) | "The runtime your coding agents live on": a Rust terminal multiplexer that keeps agent terminals running in a background server, marks each pane working/blocked/idle, and exposes a CLI and socket API. "Doesn't wrap or replace" Claude Code, Codex, etc. ([README](https://github.com/herdrdev/herdr)) | Apache-2.0 | 43k stars | One binary; Windows support documented as beta | **A runtime host, not an orchestrator.** Optional for people who watch agents in terminals. Not an adapter peer of Paperclip |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Self-improving general agent: skills created from experience, memory, built-in cron, subagents, one gateway for Telegram/Discord/Slack/WhatsApp/Signal, any model provider, native Windows installer ([README](https://github.com/NousResearch/hermes-agent)) | MIT | 252k stars | Native Windows or WSL2 ✅ | **An agent runtime plus communication gateway.** Paperclip already has `hermes_local` and `hermes_gateway` adapters ✅ (listed by the installed instance). Today this repo uses it as the Odoo and Discord job host |
| [OpenClaw](https://github.com/openclaw/openclaw) | Personal assistant that runs on your computer and meets you in 20+ chat channels, with apps for macOS, iOS, Android, Windows; models and harnesses are swappable plugins ([README](https://github.com/openclaw/openclaw)) | MIT | 392k stars | Installer for Windows, macOS, Linux | Candidate **engine for the personal workspace**; Paperclip has an `openclaw_gateway` adapter ✅ |
| [Sim](https://github.com/simstudioai/sim) | Workspace to build, deploy and monitor agents and workflows: visual, conversational or code; 1,000+ integrations; tables, files, knowledge. `npx sim-setup` wizard with `start/stop/update/status/logs/doctor/reset` ([README](https://github.com/simstudioai/sim)) | Apache-2.0 | 30k stars | Needs Node 20+ and Docker | Strongest **UX reference** for installing and managing local services; heavy to embed (Docker) |
| [n8n](https://github.com/n8n-io/n8n) | Workflow automation with native AI. Official MCP support: instance-level MCP server (opt-in per workflow), MCP Server Trigger node, MCP Client Tool node ([docs](https://docs.n8n.io/connect/connect-to-n8n-mcp-server)) | **Sustainable Use License** ("non-sublicensable, non-transferable"); `.ee.` files need an Enterprise license ([LICENSE.md](https://github.com/n8n-io/n8n/blob/master/LICENSE.md)) | 207k stars | npm or Docker | **Integrate as a separate, user-installed service; never bundle or redistribute.** Qualifi's workflows already target it |
| [Activepieces](https://github.com/activepieces/activepieces) | Zapier-style automation; integrations are TypeScript "pieces" on npm, "280+" exposed as MCP servers ([README](https://github.com/activepieces/activepieces)) | MIT outside `packages/ee/` ([LICENSE](https://github.com/activepieces/activepieces/blob/main/LICENSE)) | 25k stars | Docker or npm | **Best embeddable source of connectors** (the pieces), if we need integrations beyond MCP |
| [Dify](https://github.com/langgenius/dify) | LLM app and agent workflow platform | Modified Apache-2.0: **no multi-tenant use without written permission; the logo must stay** ([LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)) | 158k stars | Docker | **Do not embed.** Multi-workspace is our core model and the license forbids it |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | Private chat with documents; desktop app and Docker; no-code agent builder, MCP compatibility, scheduled tasks, dynamic model routing, multi-user (Docker only) ([README](https://github.com/Mintplex-Labs/anything-llm)) | MIT | 67k stars | Desktop installer, zero setup | Strong overlap with the personal workspace; **integrate, do not rebuild chat-with-documents** |
| Relevance AI | Hosted no-code platform for agent "workforces". ⚠️ Pricing sources disagree; no self-hosted option found in any source I read ([overview](https://www.11x.ai/guides/relevance-ai-pricing)) | Proprietary SaaS | n/a | **Not local** | Out of scope for a local-first product; useful only as a feature comparison |
| [OmniRoute](https://github.com/diegosouzapw/OmniRoute) | One OpenAI-compatible endpoint (`/v1`, plus `/v1/responses`) over 372 providers; combos with 19 routing strategies; Auto-Combo scoring 16 factors; per-key USD quotas; `X-OmniRoute-Decision` header; MCP server (110 tools) and A2A; fail-closed `auto/subscription` ([README](https://github.com/diegosouzapw/OmniRoute)) | MIT | 75k stars; 3.8.51 installed here ✅ | npm, runs as a service ✅ | **Model gateway for non-Claude-Code traffic** (see 2.4) |
| [jev-router](https://github.com/dirien/jev-router) | Pass-through proxy that asks Jev which tier a human turn needs; decides only when a person writes and only moves up within a session (cache reasons); keeps your Claude login ([README](https://github.com/dirien/jev-router)) | Apache-2.0 | small (14 stars), v1.6.0 | npm service ✅ | **Keep for Claude Code agents** |
| [Jev / TypeSafe System One](https://docs.typesafe.ai/concepts/system-one) | "Typed decisions and probabilities, not generated text." Primitives: **Choice, Score, Noul** (true/false probability). `POST /v1/systemone`; text input only; "Calibration is measured across groups of predictions; it does not guarantee that an individual answer is correct." No explanations or generation | Hosted API; ⚠️ model weights not open | OpenRouter lists Jev 1.13 at $0.042 per million input tokens, 32K context ([listing](https://openrouter.ai/typesafe/jev-1.13-20260917)) | API | **The decision service** (see doc 06) |
| [MCP](https://modelcontextprotocol.io/specification/latest) | JSON-RPC 2.0 protocol; servers offer resources, prompts and tools; clients offer elicitation; extensions include Tasks (async), Skills over MCP, MCP Apps; spec version 2026-07-28. Security section: tools are arbitrary code, tool descriptions are untrusted, explicit user consent before invocation | Spec: NOASSERTION in GitHub metadata | 9k stars (spec repo) | n/a | **The tool and integration protocol** |
| Others seen | Langflow (MIT, 155k stars), CrewAI (MIT, 59k), LangGraph (MIT, 43k), LiteLLM (NOASSERTION, 61k), Portkey gateway (MIT, 13k), Flowise (NOASSERTION, 55k), AutoGen (CC-BY-4.0, last push 2026-04) | mixed | see numbers | | No capability we need that the rows above do not already cover; frameworks (CrewAI, LangGraph, AutoGen) are agent-building libraries, not products to embed |

## 2.3 Facts that change the design

1. **Paperclip already has the control plane.** The installed instance (2026.1005.0) exposes an OpenAPI document with **728 paths** (companies, issues, agents, approvals, routines, skills, secrets, plugins, tool connections, a tool gateway, pipelines), a **team catalog** (`paperclipai teams browse/list`, preview then install), **portable company export and import** as a markdown package with `export:preview`, `import:preview`, `import:apply`, and 16 adapter types including `claude_local`, `codex_local`, `hermes_local`, `hermes_gateway`, `openclaw_gateway`, `acpx_local`, `paperclip_runner`, `http`, `process`. Imported agents start with heartbeats disabled so budgets and keys can be reviewed first. ✅ (all confirmed by calling the running instance). Sources: [teams](https://docs.paperclip.ing/reference/cli/teams), [export and import](https://docs.paperclip.ing/guides/power/export-import), [API overview](https://docs.paperclip.ing/reference/api/overview/), [adapters](https://docs.paperclip.ing/reference/adapters/overview/).
2. **Paperclip has a plugin SDK, but it is alpha.** Plugins run as a separate worker process over JSON-RPC 2.0, are capability-gated, and can register agent tools, jobs, event handlers, webhooks, UI pages and "managed resources" (agents, projects, routines, skills). "The plugin runtime is in alpha," so interfaces may change ([SDK](https://docs.paperclip.ing/reference/plugins/sdk/)).
3. **Anthropic does not support routing Claude Code to non-Claude models through any gateway** ([Claude Code docs](https://code.claude.com/docs/en/llm-gateway)). So a model gateway can diversify providers only for runtimes other than Claude Code, or for Claude models served by other clouds. Also from the same page: if a gateway **credential** is set, requests use per-token billing and the subscription limits no longer apply; setting only `ANTHROPIC_BASE_URL` keeps the Claude login active. jev-router does the latter.
4. **Jev is a classifier, not a planner.** Its own docs say it does not write replies, produce code or explain its reasoning, and that calibration holds across groups of predictions, not for one answer. This matches your instruction to use it for selection, scoring and classification only.
5. **n8n's license blocks bundling.** It can still be used as something the user installs, and workflows can be generated for it.
6. **Dify's license conflicts with the multi-workspace goal.**
7. **A desktop-wrapper precedent exists.** [paperclip-desktop](https://github.com/aronprins/paperclip-desktop) (MIT, unofficial, 578 stars) wraps Paperclip in Electron and bundles it. Packaging a server plus browser UI as a desktop app is a known pattern.

## 2.4 OmniRoute versus the existing jev-router

Your options, and my recommendation:

| Option | Verdict |
|---|---|
| 1. OmniRoute replaces jev-router | No. For Claude Code, jev-router is the only piece that adds the "which tier does this human turn need" decision while preserving the cache and the Claude login. OmniRoute can do task-aware routing itself, but pointing Claude Code at non-Claude models through it is unsupported by Anthropic, and I could not verify its Anthropic-format endpoint ⚠️ |
| 2. Both, chained (jev-router into OmniRoute) | No. Two routing layers on one path add latency and a second place to debug |
| 3. OmniRoute as provider abstraction, Jev classifies | Yes, but only for **non-Claude-Code** traffic (Codex, OpenCode, Hermes, OpenClaw, tools that need an LLM). There the app asks the Jev decision service for a tier, and OmniRoute maps that tier to a provider combo |
| 4. Selectable backend | Yes, as a setting per runtime profile (see doc 03): each agent runtime points at exactly one gateway endpoint |

**Recommendation: two paths, never chained.** Claude Code agents: `Claude Code -> jev-router -> Anthropic` (unchanged). Everything else: `runtime or tool -> OmniRoute -> providers`, with Jev used by our decision service to pick the tier or combo name. The product's "Models" screen manages both from one place but does not add a third proxy.

Open item: using a Claude or ChatGPT **subscription** login through a third-party gateway may breach those providers' terms. I did not verify either way. Make it an explicit, warned opt-in, off by default.

## 2.5 Reuse, integrate or build

| Need | Decision | Reason |
|---|---|---|
| Company orchestration, org chart, tasks, approvals, budgets, routines | **Reuse Paperclip** | Already present, MIT, and exposes API, CLI and plugin SDK |
| Team and department templates | **Reuse Paperclip's export/import package** as the on-disk format; add a thin overlay for what it lacks | Avoids inventing a second portable format |
| Agent runtimes | **Integrate** (Claude Code, Codex, Hermes, OpenClaw through Paperclip adapters) | Not our job to write runtimes |
| Terminal session host | **Optional integration** (Herdr) | Different layer; no need to require it |
| Visual workflow builder | **Integrate** n8n or Activepieces as an optional engine; do not build one in the MVP | Largest single build item; mature options exist |
| Connectors | **MCP first**; Activepieces pieces as fallback | Open standard, many servers already |
| Personal assistant / documents | **Integrate** AnythingLLM or OpenClaw | Mature, MIT |
| Model gateway | **Integrate OmniRoute** (non-Claude-Code); keep jev-router | See 2.4 |
| Decision service | **Build a thin provider-independent service** around Jev | Nothing generic exists with logging, thresholds and evaluation |
| Onboarding that turns a described workflow into a validated blueprint | **Build** | Core differentiator; none of the products verified do this end to end |
| Local service manager, unified config, secret store, installer | **Build** | Every product above has its own installer; none manages the others |
| Tools runtime with permissions, previews and undo | **Build the runner; reuse MCP servers and our existing tools** | Safety policy is ours to own |
| Unified activity, cost and health view | **Build on top of Paperclip, OmniRoute and jev-router telemetry** | They each expose pieces; none shows all |

## 2.6 What I could not verify

- Whether Paperclip runs natively on Windows without WSL (it runs under WSL here; Hermes and OpenClaw document native Windows). Needs a spike.
- Whether OmniRoute exposes an Anthropic-format endpoint that Claude Code accepts.
- NL workflow creation in n8n, Activepieces, Dify: I did not read their docs for it, so I make no claim.
- How Paperclip's `claude_local` adapter sets Claude Code's permission mode.
- Jev latency and per-call price from TypeSafe's own pages (only the OpenRouter listing and third-party articles state them).
- Relevance AI's current pricing and any self-hosting option.
