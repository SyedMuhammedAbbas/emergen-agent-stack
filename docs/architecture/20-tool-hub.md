# Tool hub: connectors, walkthroughs, permissions

The product idea: the company's tools are connected once, shown together, and the owner can see what each is doing. The system does not replace the tools; it connects them, makes them visible and keeps the owner in control.

## Add a tool = add one file

`connectors/<id>.json` (validated by `packages/tools/src/connector.mjs`):

```json
{ "schemaVersion": 1, "id": "upwork", "name": "Upwork", "category": "freelance",
  "summary": "Search freelance jobs ...", "roles": ["lead-scout"],
  "connect": { "type": "mcp-http", "server": "upwork", "url": "https://mcp.upwork.com/mcp" },
  "policy": { "*": "ask" } }
```

Connect types: `mcp-http` (remote MCP server), `mcp-stdio` (an npm package **pinned to an exact version**, run on this computer), `cli` (a program such as `gh`, optionally checked for sign-in) and `local-service` (something on `127.0.0.1` with a health address). If the file has no `steps`, the standard walkthrough for its type is generated, so a minimal file is enough.

A file cannot carry a command. Unknown fields are refused; addresses must be https (or local for services); packages must be pinned; environment names and secret file names are patterns; secret-shaped text is refused. Steps and checks come from a fixed set the app implements: actions `register-mcp` and `sync-policy`; checks `mcp-status`, `binary`, `secret-file`, `gh-auth`, `health`, `policy-synced`.

## The walkthrough (Tools screen, "Set up")

Status is **verified, not assumed**: `claude mcp list` (registered, connected, needs sign-in), whether a program is installed and signed in, whether a local service answers, whether a secret file exists (contents never read) and whether the permission policy has been written. Each step shows done / to do. Steps you must do yourself (sign in, paste a key into a file) say exactly how and the system never sees the password or key. A tool that runs npm code needs an explicit confirmation before it is added. Every step the app runs is in the audit log.

## Permissions and activity

Per tool: allowed, asks first, off, plus "allow for 1 hour" for a held call and a default for everything else. Choices are stored in `~/.agent-stack/policy-overrides.json` and layered over the connector's own policy by `stack integrations sync`, so a re-sync never loses them. The hook (`wsl/hooks/mcp-policy.mjs`) enforces them and records every call and result (metadata only) for the feed.

## Verified on this machine (2026-10-12)

`claude mcp list` reports Upwork, GitHub CLI and OmniRoute as connected and Playwright as not set up, matching reality. Your Claude account also exposes about 40 other connectors (Gmail, Drive, Notion, Figma and others). They are not in the catalogue, so by policy agents must ask before using them; the screen lists the signed-in ones.

## Not done

- Adding a tool does not yet pick **which agents** get it: `roles` is shown, not enforced. Enforcement would be per-agent MCP configuration in Paperclip, whose API I have not verified.
- Tool names only appear in the permission list after an agent has tried them (MCP servers offer no list we can read without a session).
- `claude mcp list` takes about 18 s with this many servers, so statuses refresh about once a minute and straight after a step.
