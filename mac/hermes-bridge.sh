#!/usr/bin/env bash
# Installs the Odoo <-> Paperclip <-> Discord bridge into an existing Hermes install on macOS. Idempotent.
# The macOS counterpart of windows/hermes-bridge.ps1, step by step. NOT YET TESTED ON A MAC.
# Needs: Hermes installed natively (default HERMES_HOME ~/.hermes) with its Discord gateway and Odoo credentials
# (ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY) in <HERMES_HOME>/.env, and the Paperclip org created (wsl/40-org.sh).
source "$(dirname "$0")/../wsl/lib.sh"
load_config
export PATH="$HOME/.local/bin:$PATH"   # where Hermes's installer usually puts the hermes command
for k in DISCORD_CHANNEL_ID TIMESHEET_EMPLOYEE; do [ -n "${!k:-}" ] || die "config.env: $k is empty"; done

hh="${HERMES_HOME:-$HOME/.hermes}"; hh="${hh%/}"
export HERMES_HOME="$hh"   # agent_ops.py and discord_setup.py read it
# Windows: <HERMES_HOME>\hermes-agent\venv\Scripts\python.exe; macOS/Linux venvs keep it in bin/
py="$hh/hermes-agent/venv/bin/python"
{ command -v hermes >/dev/null && [ -x "$py" ]; } || die "Hermes not found at $hh. Install Hermes first."
for k in ODOO_URL ODOO_DB ODOO_USERNAME ODOO_API_KEY; do
  grep -q "^$k=." "$hh/.env" 2>/dev/null || die "$k missing from $hh/.env"
done

# ---- scripts + skill ----
scripts="$hh/scripts"; mkdir -p "$scripts"
cp -f "$REPO_DIR/hermes/agent_ops.py" "$scripts/"
# one cron entry point per command (Hermes cron scripts take no arguments; the file name picks the command)
for c in intake questions proposals digest standup diskguard; do cp -f "$REPO_DIR/hermes/agent_job.py" "$scripts/agent_$c.py"; done
skill_dir="$hh/skills/productivity/agent-ops"; mkdir -p "$skill_dir"
# pre-1.0 installs used this name; two copies would give Hermes two competing skills
legacy="$hh/skills/productivity/emergen-agent-ops"
[ -f "$legacy/SKILL.md" ] && { rm -f "$legacy/SKILL.md"; rmdir "$legacy" 2>/dev/null || true; }
# The template is written for Windows (backslash paths, Scripts\python.exe, platforms: [windows]); the ps1 only fills
# the placeholders. Here the Windows path shapes are rewritten to POSIX ones as well.
# UNVERIFIED: the platform name Hermes expects for macOS in the skill front matter ("macos").
"$py" - "$REPO_DIR/hermes/agent-ops/SKILL.md" "$skill_dir/SKILL.md" "$hh" "$TIMESHEET_EMPLOYEE" <<'PY'
import re, sys, pathlib
src, dst, hh, emp = sys.argv[1:5]
text = pathlib.Path(src).read_text(encoding="utf-8")
text = text.replace("{{HERMES_HOME}}\\hermes-agent\\venv\\Scripts\\python.exe", "{{HERMES_HOME}}/hermes-agent/venv/bin/python")
text = re.sub(r"\{\{HERMES_HOME\}\}((?:\\[^\\\s`\"']+)+\\?)", lambda m: "{{HERMES_HOME}}" + m.group(1).replace("\\", "/"), text)
text = re.sub(r"(?m)^platforms: \[windows\]$", "platforms: [macos]", text)
text = text.replace("{{HERMES_HOME}}", hh).replace("{{TIMESHEET_EMPLOYEE}}", emp)
pathlib.Path(dst).write_text(text, encoding="utf-8")
PY
log "bridge scripts and skill installed in $hh"

# ---- config from the Paperclip ids ----
# (Windows reads ids.json through wsl.exe; on macOS it is a local file)
[ -f "$IDS_FILE" ] || die "Paperclip ids missing ($IDS_FILE); run wsl/40-org.sh first."
for k in company manager estimator; do
  [ -n "$(jq -r --arg k "$k" '.[$k] // empty' "$IDS_FILE")" ] || die "Paperclip ids missing; run wsl/40-org.sh first."
done
cfg_file="$scripts/agent_ops.config.json"
# config.env keys that are absent become null and present-but-empty ones "", as ConvertTo-Json does in the ps1
"$py" - "$IDS_FILE" "$cfg_file" <<'PY'
import json, os, sys, pathlib
ids = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
out = pathlib.Path(sys.argv[2])
project_map = {}
if out.exists():
    try:
        project_map = json.loads(out.read_text(encoding="utf-8-sig")).get("project_map") or {}
    except ValueError:
        pass
env = os.environ.get
cfg = {
    "paperclip_api": "http://localhost:3100/api",
    "company_id": ids["company"],
    "manager_agent_id": ids["manager"],
    "estimator_agent_id": ids["estimator"],
    "ready_tag": env("ODOO_READY_TAG"),
    "timesheet_employee": env("TIMESHEET_EMPLOYEE"),
    "project_map": project_map,
    "standup_title": env("STANDUP_TITLE"),
    "standup_name": env("STANDUP_NAME"),
    "standup_active_stages": env("STANDUP_ACTIVE_STAGES") or "To Do,Doing,In Dev,In Progress,Working on,QA Issues",
    "workdays": env("WORKDAYS") or "0,1,2,3,4,5",
    "disk_min_free_gb": env("DISK_MIN_FREE_GB") or "4",
    "disk_resume_free_gb": env("DISK_RESUME_FREE_GB") or "6",
}
out.write_text(json.dumps(cfg, indent=4), encoding="utf-8")
PY
log "wrote $cfg_file (project_map preserved)"

(cd "$scripts" && "$py" agent_ops.py init) || die "agent_ops.py init failed"

# ---- Hermes may read Odoo but never write it: every write goes through an approved proposal ----
odoo_write_tools='["bulk_operation","execute_action","execute_method","save_doc","save_sop"]'
odoo_mcp=$(hermes config get mcp_servers.odoo 2>&1 || true)
if grep -q 'odoo-mcp' <<<"$odoo_mcp"; then
  hermes config set mcp_servers.odoo.tools.exclude "$odoo_write_tools" >/dev/null
  log "Hermes odoo MCP write tools disabled (restart the Hermes gateway to apply)"
else
  warn "no 'odoo' MCP server in Hermes config; if Hermes reaches Odoo another way, make that read-only yourself"
fi

# ---- cron jobs: created, or updated in place to match config.env ----
channel() { local v="${!1:-}"; printf '%s' "${v:-$DISCORD_CHANNEL_ID}"; }   # fall back to the main channel
# name|schedule|channel
jobs=(
  "agent-intake|${INTAKE_SCHEDULE:-}|$(channel DISCORD_ACTIVITY_CHANNEL_ID)"
  "agent-questions|${INTAKE_SCHEDULE:-}|$(channel DISCORD_QUESTIONS_CHANNEL_ID)"
  "agent-proposals|every 5m|$(channel DISCORD_APPROVALS_CHANNEL_ID)"
  "agent-digest|${DIGEST_SCHEDULE:-}|$(channel DISCORD_APPROVALS_CHANNEL_ID)"
  "agent-standup|${STANDUP_SCHEDULE:-}|$(channel DISCORD_STANDUP_CHANNEL_ID)"
  "agent-diskguard|every 5m|$(channel DISCORD_QUESTIONS_CHANNEL_ID)"
)
# "  <12-hex id> [state]" followed by "    Name:      <name>"  ->  "<name> <id>" lines
existing=$( (hermes cron list 2>&1 || true) | "$py" -c '
import re, sys
for m in re.finditer(r"(?m)^\s+([0-9a-f]{12})\s+\[[^\]]+\]\s*\r?\n\s+Name:\s+(\S+)", sys.stdin.read()):
    print(m.group(2), m.group(1))')
for j in "${jobs[@]}"; do
  IFS='|' read -r name schedule chan <<<"$j"
  [ -n "$schedule" ] || { warn "$name: no schedule in config.env, skipped"; continue; }
  script="${name/agent-/agent_}.py"
  deliver="discord:$chan"
  id=$(awk -v n="$name" '$1==n {print $2; exit}' <<<"$existing")
  if [ -n "$id" ]; then
    hermes cron edit "$id" --schedule "$schedule" --script "$script" --no-agent --deliver "$deliver" >/dev/null
    log "cron $name updated ($schedule -> $deliver)"
  else
    hermes cron create "$schedule" --name "$name" --script "$script" --no-agent --deliver "$deliver" >/dev/null
    log "cron $name created ($schedule -> $deliver)"
  fi
done

# ---- Discord: reply without @mention, in-channel, with the agent-ops skill, in the channels you type in ----
interactive=$(printf '%s\n' "$DISCORD_CHANNEL_ID" "${DISCORD_APPROVALS_CHANNEL_ID:-}" "${DISCORD_QUESTIONS_CHANNEL_ID:-}" \
  "${DISCORD_NEWPROJECT_CHANNEL_ID:-}" | grep -v '^$' | sort -u)
hermes_config_get() { # an unset key prints "not set" or fails: treat both as empty
  local v; v=$(hermes config get "$1" 2>/dev/null | paste -sd, -) || { echo ""; return; }
  case "$v" in *"not set"*) echo "" ;; *) echo "$v" ;; esac
}
merge_csv() {
  local cur all
  cur=$(hermes_config_get "$1" | sed -E "s/[][']|[[:space:]]//g")   # drop quotes, brackets, spaces
  all=$( { tr ',' '\n' <<<"$cur" | grep -E '^([0-9]+|\*)$'; printf '%s\n' "$interactive"; } | sort -u | paste -sd, -)
  hermes config set "$1" "$all" >/dev/null
}
merge_csv discord.free_response_channels
merge_csv discord.no_thread_channels
bindings="[$(while read -r c; do printf "{id: '%s', skills: [agent-ops]}, " "$c"; done <<<"$interactive" | sed 's/, $//')]"
hermes config set discord.channel_skill_bindings "$bindings" >/dev/null
log "Discord: Hermes answers without @mention and with the agent-ops skill in $(wc -l <<<"$interactive" | tr -d ' ') channel(s) (restart the gateway to apply)"

# ---- gateway watchdog ----
# Windows: hermes/gateway-watchdog.ps1 + the Hermes-Gateway-Watchdog scheduled task restart the gateway when its
# python.exe is gone (Get-CimInstance, Start-ScheduledTask: Windows-only). macOS equivalent: launchd's KeepAlive on the
# gateway's own agent restarts it, so no extra watchdog is installed. UNVERIFIED: that `hermes gateway install` writes a
# launchd agent with KeepAlive on macOS, and its label.
gw=$(launchctl list 2>/dev/null | awk 'tolower($3) ~ /hermes/ {print $3}' | head -1 || true)
if [ -n "$gw" ]; then
  log "Hermes gateway launchd agent: $gw (restart it with: launchctl kickstart -k gui/$(id -u)/$gw)"
else
  warn "no Hermes gateway launchd agent found; run 'hermes gateway install' so the gateway starts at login and restarts when it dies."
fi
