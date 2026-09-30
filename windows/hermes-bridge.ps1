# Installs the Odoo <-> Paperclip <-> Discord bridge into an existing Hermes install. Idempotent.
# Needs: Hermes installed on Windows with its Discord gateway and Odoo credentials (ODOO_URL, ODOO_DB,
# ODOO_USERNAME, ODOO_API_KEY) in <HERMES_HOME>\.env, and the Paperclip org created (wsl/40-org.sh).
. "$PSScriptRoot\lib.ps1"
$cfg = Read-Config
foreach ($k in 'DISCORD_CHANNEL_ID', 'TIMESHEET_EMPLOYEE') { if (-not $cfg[$k]) { throw "config.env: $k is empty" } }

$hh = Get-HermesHome
$py = Join-Path $hh 'hermes-agent\venv\Scripts\python.exe'
if (-not (Get-Command hermes -ErrorAction SilentlyContinue) -or -not (Test-Path $py)) { throw "Hermes not found at $hh. Install Hermes first." }
foreach ($k in 'ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY') {
    if (-not (Select-String -Path (Join-Path $hh '.env') -Pattern "^$k=." -Quiet)) { throw "$k missing from $hh\.env" }
}

# ---- scripts + skill ----
$scripts = Join-Path $hh 'scripts'; New-Item -ItemType Directory -Force $scripts | Out-Null
Copy-Item "$RepoDir\hermes\agent_ops.py" $scripts -Force
# one cron entry point per command (Hermes cron scripts take no arguments; the file name picks the command)
$jobCommands = 'intake', 'questions', 'proposals', 'digest', 'standup', 'diskguard'
foreach ($c in $jobCommands) { Copy-Item "$RepoDir\hermes\agent_job.py" (Join-Path $scripts "agent_$c.py") -Force }
$skillDir = Join-Path $hh 'skills\productivity\agent-ops'; New-Item -ItemType Directory -Force $skillDir | Out-Null
# pre-1.0 installs used this name; two copies would give Hermes two competing skills
$legacySkill = Join-Path $hh 'skills\productivity\emergen-agent-ops\SKILL.md'
if (Test-Path $legacySkill) { Remove-Item $legacySkill; Remove-Item (Split-Path $legacySkill) -ErrorAction SilentlyContinue }
$utf8 = New-Object System.Text.UTF8Encoding($false)  # no BOM; PowerShell 5.1's utf8 adds one
$skill = [IO.File]::ReadAllText("$RepoDir\hermes\agent-ops\SKILL.md", $utf8)
[IO.File]::WriteAllText((Join-Path $skillDir 'SKILL.md'), $skill.Replace('{{HERMES_HOME}}', $hh).Replace('{{TIMESHEET_EMPLOYEE}}', $cfg.TIMESHEET_EMPLOYEE), $utf8)
Write-Step "bridge scripts and skill installed in $hh"

# ---- config from the Paperclip ids ----
$idsJson = (& wsl.exe -d $cfg.WSL_DISTRO -u $cfg.WSL_USER -- cat "/home/$($cfg.WSL_USER)/.agent-stack/ids.json") -join "`n"
$ids = $idsJson -replace "`0", '' | ConvertFrom-Json
if (-not $ids.company -or -not $ids.manager -or -not $ids.estimator) { throw "Paperclip ids missing; run wsl/40-org.sh first." }
$cfgFile = Join-Path $scripts 'agent_ops.config.json'
$projectMap = @{}
if (Test-Path $cfgFile) { $old = [IO.File]::ReadAllText($cfgFile) | ConvertFrom-Json; if ($old.project_map) { $projectMap = $old.project_map } }
$json = [ordered]@{
    paperclip_api      = 'http://localhost:3100/api'
    company_id         = $ids.company
    manager_agent_id   = $ids.manager
    estimator_agent_id = $ids.estimator
    ready_tag          = $cfg.ODOO_READY_TAG
    timesheet_employee = $cfg.TIMESHEET_EMPLOYEE
    project_map        = $projectMap
    standup_title      = $cfg.STANDUP_TITLE
    standup_name       = $cfg.STANDUP_NAME
    standup_active_stages = $(if ($cfg.STANDUP_ACTIVE_STAGES) { $cfg.STANDUP_ACTIVE_STAGES } else { 'To Do,Doing,In Dev,In Progress,Working on,QA Issues' })
    workdays           = $(if ($cfg.WORKDAYS) { $cfg.WORKDAYS } else { '0,1,2,3,4,5' })
    disk_min_free_gb   = $(if ($cfg.DISK_MIN_FREE_GB) { $cfg.DISK_MIN_FREE_GB } else { '4' })
    disk_resume_free_gb = $(if ($cfg.DISK_RESUME_FREE_GB) { $cfg.DISK_RESUME_FREE_GB } else { '6' })
} | ConvertTo-Json
[IO.File]::WriteAllText($cfgFile, $json, $utf8)
Write-Step "wrote $cfgFile (project_map preserved)"

Push-Location $scripts
try { & $py agent_ops.py init; if ($LASTEXITCODE) { throw "agent_ops.py init failed" } } finally { Pop-Location }

# ---- Hermes may read Odoo but never write it: every write goes through an approved proposal ----
$odooWriteTools = '["bulk_operation","execute_action","execute_method","save_doc","save_sop"]'
if ((hermes config get mcp_servers.odoo 2>&1) -match 'odoo-mcp') {
    hermes config set mcp_servers.odoo.tools.exclude $odooWriteTools | Out-Null
    Write-Step "Hermes odoo MCP write tools disabled (restart the gateway to apply: Stop the hermes gateway process, Start-ScheduledTask Hermes_Gateway)"
} else {
    Write-Warn "no 'odoo' MCP server in Hermes config; if Hermes reaches Odoo another way, make that read-only yourself"
}

# ---- cron jobs: created, or updated in place to match config.env ----
function Channel($key) { $v = $cfg[$key]; if ($v) { $v } else { $cfg.DISCORD_CHANNEL_ID } }  # fall back to the main channel
$jobs = @(
    @{ name = 'agent-intake';    schedule = $cfg.INTAKE_SCHEDULE; channel = Channel 'DISCORD_ACTIVITY_CHANNEL_ID' }
    @{ name = 'agent-questions'; schedule = $cfg.INTAKE_SCHEDULE; channel = Channel 'DISCORD_QUESTIONS_CHANNEL_ID' }
    @{ name = 'agent-proposals'; schedule = 'every 5m';           channel = Channel 'DISCORD_APPROVALS_CHANNEL_ID' }
    @{ name = 'agent-digest';    schedule = $cfg.DIGEST_SCHEDULE; channel = Channel 'DISCORD_APPROVALS_CHANNEL_ID' }
    @{ name = 'agent-standup';   schedule = $cfg.STANDUP_SCHEDULE; channel = Channel 'DISCORD_STANDUP_CHANNEL_ID' }
    @{ name = 'agent-diskguard'; schedule = 'every 5m';           channel = Channel 'DISCORD_QUESTIONS_CHANNEL_ID' }
)
# "  <12-hex id> [state]" followed by "    Name:      <name>"
$listing = (hermes cron list 2>&1) -join "`n"
$existing = @{}
foreach ($m in [regex]::Matches($listing, '(?m)^\s+([0-9a-f]{12})\s+\[[^\]]+\]\s*\r?\n\s+Name:\s+(\S+)')) { $existing[$m.Groups[2].Value] = $m.Groups[1].Value }
foreach ($j in $jobs) {
    if (-not $j.schedule) { Write-Warn "$($j.name): no schedule in config.env, skipped"; continue }
    $script = $j.name.Replace('agent-', 'agent_') + '.py'
    $deliver = "discord:$($j.channel)"
    if ($existing[$j.name]) {
        hermes cron edit $existing[$j.name] --schedule "$($j.schedule)" --script $script --no-agent --deliver $deliver | Out-Null
        Write-Step "cron $($j.name) updated ($($j.schedule) -> $deliver)"
    } else {
        hermes cron create "$($j.schedule)" --name $j.name --script $script --no-agent --deliver $deliver | Out-Null
        Write-Step "cron $($j.name) created ($($j.schedule) -> $deliver)"
    }
}

# ---- Discord: reply without @mention, in-channel, with the agent-ops skill, in the channels you type in ----
$interactive = @($cfg.DISCORD_CHANNEL_ID, $cfg.DISCORD_APPROVALS_CHANNEL_ID, $cfg.DISCORD_QUESTIONS_CHANNEL_ID, $cfg.DISCORD_NEWPROJECT_CHANNEL_ID) |
    Where-Object { $_ } | Sort-Object -Unique
function Get-HermesConfig($key) {
    # an unset key writes to stderr; don't let $ErrorActionPreference='Stop' turn that into a failure
    $ErrorActionPreference = 'Continue'
    $v = (hermes config get $key 2>$null) -join ','
    if ($LASTEXITCODE -or $v -match 'not set') { '' } else { $v }
}
function Merge-Csv($key) {
    $cur = (Get-HermesConfig $key) -replace "['\s\[\]]", ''
    $all = @($cur -split ',' | Where-Object { $_ -match '^\d+$|^\*$' }) + $interactive | Sort-Object -Unique
    hermes config set $key ($all -join ',') | Out-Null
}
Merge-Csv 'discord.free_response_channels'
Merge-Csv 'discord.no_thread_channels'
# YAML flow with single quotes: PowerShell 5.1 strips double quotes from native-command arguments
$bindings = '[' + (($interactive | ForEach-Object { "{id: '$_', skills: [agent-ops]}" }) -join ', ') + ']'
hermes config set discord.channel_skill_bindings $bindings | Out-Null
Write-Step "Discord: Hermes answers without @mention and with the agent-ops skill in $($interactive.Count) channel(s) (restart the gateway to apply)"

# ---- gateway watchdog ----
$gs = Join-Path $hh 'gateway-service'; New-Item -ItemType Directory -Force $gs | Out-Null
Copy-Item "$RepoDir\hermes\gateway-watchdog.ps1" $gs -Force
if (-not (Get-ScheduledTask -TaskName 'Hermes_Gateway' -ErrorAction SilentlyContinue)) {
    Write-Warn "Hermes_Gateway task not found; run 'hermes gateway install' so the gateway starts at logon."
}
$me = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$gs\gateway-watchdog.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Hermes-Gateway-Watchdog' -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Every 15 min: restarts the Hermes gateway via Hermes_Gateway if it is not running' -Force | Out-Null
Write-Step "task Hermes-Gateway-Watchdog registered (every 15 min)"
