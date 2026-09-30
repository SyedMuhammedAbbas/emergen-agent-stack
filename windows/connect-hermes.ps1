<#
.SYNOPSIS
  Adds Hermes to the Paperclip org as the "Ops (Hermes)" agent (hermes_gateway adapter). Idempotent.
.DESCRIPTION
  Run it yourself: it creates a local API key shared between Hermes and Paperclip and never prints it.
  1. WSL must use mirrored networking so Paperclip (in WSL) can reach Hermes on 127.0.0.1:8642.
  2. Enables the Hermes API server (loopback only) with a generated API_SERVER_KEY in <HERMES_HOME>\.env.
  3. Restarts the Hermes gateway and waits for the API.
  4. Creates or updates the Paperclip agent with that key, reporting to the Manager.
#>
. "$PSScriptRoot\lib.ps1"
$cfg = Read-Config
$hh = Get-HermesHome
$envFile = Join-Path $hh '.env'
$api = 'http://127.0.0.1:3100/api'
$hermesApi = 'http://127.0.0.1:8642'

# ---- 1. mirrored networking ----
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$wc = if (Test-Path $wslconfig) { Get-Content $wslconfig -Raw } else { "[wsl2]`r`n" }
if ($wc -notmatch '(?m)^networkingMode=mirrored') {
    if ($wc -match '(?m)^networkingMode=') { $wc = $wc -replace '(?m)^networkingMode=.*$', 'networkingMode=mirrored' }
    else { $wc = $wc -replace '(?m)^\[wsl2\]\s*$', "[wsl2]`r`nnetworkingMode=mirrored" }
    Set-Content -Path $wslconfig -Value $wc.TrimEnd() -Encoding ascii
    Write-Warn "WSL networking set to mirrored. Run 'wsl --shutdown' (restarts WSL, the agents and Docker Desktop), wait ~1 minute, then re-run this script."
    exit 3
}
$mode = ((& wsl.exe -d $cfg.WSL_DISTRO -- wslinfo --networking-mode) -replace "`0", '' | Where-Object { $_ -notmatch 'Failed to mount' }) -join ''
if ($mode.Trim() -ne 'mirrored') { Write-Warn "WSL still reports '$($mode.Trim())'. Run 'wsl --shutdown', then re-run."; exit 3 }

# ---- 2. Hermes API server key (generated locally, never printed) ----
$lines = if (Test-Path $envFile) { Get-Content $envFile } else { @() }
if (-not ($lines | Where-Object { $_ -match '^API_SERVER_KEY=.{16,}' })) {
    $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
    $lines = @($lines | Where-Object { $_ -notmatch '^API_SERVER_(KEY|HOST|PORT)=' }) +
             @("API_SERVER_KEY=$key", 'API_SERVER_HOST=127.0.0.1', 'API_SERVER_PORT=8642')
    [IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
    Write-Step "Hermes API server enabled on 127.0.0.1:8642 (key stored in $envFile)"
    $restart = $true
}
$key = (($lines | Where-Object { $_ -match '^API_SERVER_KEY=' }) -replace '^API_SERVER_KEY=', '').Trim()

# ---- 3. restart the gateway if needed, wait for the API ----
function Test-HermesApi { try { Invoke-WebRequest "$hermesApi/health" -UseBasicParsing -TimeoutSec 3 | Out-Null; $true } catch { $_.Exception.Response -ne $null } }
if ($restart -or -not (Test-HermesApi)) {
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
        Where-Object { $_.CommandLine -match 'hermes_cli\.main\s+gateway\s+run' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Start-Sleep 2
    Start-ScheduledTask -TaskName 'Hermes_Gateway'
    Write-Step "restarting the Hermes gateway..."
    $ok = $false
    for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep 2; $ok = Test-HermesApi }
    if (-not $ok) { throw "Hermes API did not come up on $hermesApi; check hermes gateway status and $hh\logs" }
}
Write-Step "Hermes API answering on $hermesApi"
$fromWsl = ((& wsl.exe -d $cfg.WSL_DISTRO -- curl -s -o /dev/null -w '%{http_code}' -m 5 "$hermesApi/health") -replace "`0", '' | Where-Object { $_ -notmatch 'Failed to mount' }) -join ''
if ($fromWsl -notmatch '^\d{3}$' -or $fromWsl -eq '000') { throw "Paperclip (WSL) cannot reach $hermesApi (got '$fromWsl')" }
Write-Step "reachable from WSL (HTTP $fromWsl)"

# ---- 4. Paperclip agent ----
# After 'wsl --shutdown' the keepalive task is gone until logon, and Paperclip needs up to ~2 minutes to start.
if ((Get-ScheduledTask -TaskName 'WSL-Agents-Keepalive' -ErrorAction SilentlyContinue).State -ne 'Running') {
    Start-ScheduledTask -TaskName 'WSL-Agents-Keepalive'
}
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
    try { Invoke-WebRequest "$api/health" -UseBasicParsing -TimeoutSec 3 | Out-Null; $up = $true } catch { Start-Sleep 3 }
}
if (-not $up) { throw "Paperclip is not answering on $api after 3 minutes (wsl: paperclipai service logs)" }
$idsJson = ((& wsl.exe -d $cfg.WSL_DISTRO -u $cfg.WSL_USER -- cat "/home/$($cfg.WSL_USER)/.agent-stack/ids.json") -replace "`0", '' | Where-Object { $_ -notmatch 'Failed to mount' }) -join "`n"
$ids = $idsJson | ConvertFrom-Json
if (-not $ids.company -or -not $ids.manager) { throw "run install.ps1 first (Paperclip ids missing)" }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$instr = [IO.File]::ReadAllText((Join-Path $RepoDir 'agents\ops-hermes.md'), $utf8).Replace('{{COMPANY_NAME}}', $cfg.COMPANY_NAME)
$adapterConfig = [ordered]@{
    apiBaseUrl = $hermesApi; apiKey = $key; paperclipApiUrl = 'http://127.0.0.1:3100'
    sessionKeyStrategy = 'issue'; timeoutSec = 900; instructions = $instr
}
# PowerShell 5.1 emits a JSON array as one object; ForEach-Object unrolls it
$agents = (Invoke-RestMethod "$api/companies/$($ids.company)/agents") | ForEach-Object { $_ }
$existing = @($agents | Where-Object { $_.name -eq 'Ops (Hermes)' }) | Select-Object -First 1
$body = [ordered]@{
    name = 'Ops (Hermes)'; role = 'general'; title = 'Operations (Odoo, Discord)'; icon = 'zap'
    reportsTo = $ids.manager; adapterType = 'hermes_gateway'; adapterConfig = $adapterConfig; budgetMonthlyCents = 1000
}
$json = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 5))
if ($existing) {
    Invoke-RestMethod -Method Patch "$api/agents/$($existing.id)" -ContentType 'application/json; charset=utf-8' -Body $json | Out-Null
    $agentId = $existing.id; Write-Step "updated agent Ops (Hermes) ($agentId)"
} else {
    $created = Invoke-RestMethod -Method Post "$api/companies/$($ids.company)/agents" -ContentType 'application/json; charset=utf-8' -Body $json
    $agentId = $created.id; Write-Step "created agent Ops (Hermes) ($agentId)"
}
# no double quotes: PowerShell 5.1 mangles them in native-command arguments
$save = 'f=~/.agent-stack/ids.json; jq --arg v $1 ''.ops=$v'' $f > $f.tmp && mv $f.tmp $f'
# --exec skips the login shell, which would otherwise expand $f before bash sees it
& wsl.exe -d $cfg.WSL_DISTRO -u $cfg.WSL_USER --cd / --exec bash -c $save _ $agentId | Out-Null
if ($LASTEXITCODE) { Write-Warn "could not save the agent id to ~/.agent-stack/ids.json" }
Write-Step "done. Assign an issue to 'Ops (Hermes)' in Paperclip to try it."
