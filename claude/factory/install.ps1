# Deploys the Claude factory (telemetry hook, approval gate, dashboard) to %USERPROFILE%\.claude\factory,
# merges its hooks into both Claude Code settings.json files (Desktop: .claude, terminal: .claude-personal),
# and (re)starts the dashboard as the \ClaudeFactoryDashboard logon task on http://127.0.0.1:7777.
# Re-run after editing anything here (protected.json, pricing.json, ...). Idempotent.
#   powershell -ExecutionPolicy Bypass -File claude\factory\install.ps1 [-NoDashboard] [-RemoveHooks]
param([switch]$NoDashboard, [switch]$RemoveHooks)
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dst = Join-Path $env:USERPROFILE '.claude\factory'
$node = (Get-Command node -ErrorAction Stop).Source

$files = 'lib.js', 'telemetry.js', 'approval-gate.js', 'protected.json', 'pricing.json', 'install-hooks.js',
         'dashboard\server.js', 'dashboard\index.html', 'dashboard\run-hidden.vbs'
New-Item -ItemType Directory -Force (Join-Path $dst 'dashboard'), (Join-Path $dst 'data') | Out-Null
foreach ($f in $files) { Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force }
Write-Host "Copied $($files.Count) files to $dst"

foreach ($dir in '.claude', '.claude-personal') {
  $settings = Join-Path $env:USERPROFILE "$dir\settings.json"
  if (-not (Test-Path $settings)) { Write-Host "skip: $settings not found"; continue }
  if (-not (Test-Path "$settings.bak-steps67")) { Copy-Item $settings "$settings.bak-steps67" }
  $hookArgs = @((Join-Path $dst 'install-hooks.js'), $settings, $dst)
  if ($RemoveHooks) { $hookArgs += '--remove' }
  & $node @hookArgs
  if ($LASTEXITCODE -ne 0) { throw "hook merge failed for $settings" }
}

if ($NoDashboard) { return }
$task = 'ClaudeFactoryDashboard'
$vbs = Join-Path $dst 'dashboard\run-hidden.vbs'
# stop a previous dashboard so the new code is served; refuse if something else owns the port
$listen = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $listen) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
  if ($p.CommandLine -like '*factory*server.js*') { Stop-Process -Id $p.ProcessId -Force }
  else { throw "Port 7777 is used by another program ($($p.Name), pid $($p.ProcessId)); dashboard not started." }
}
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$opts = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $opts -Description 'Claude factory dashboard on http://127.0.0.1:7777' -Force | Out-Null
Start-ScheduledTask -TaskName $task
Start-Sleep -Seconds 2
if (Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue) { Write-Host 'Dashboard: http://127.0.0.1:7777' }
else { Write-Warning "Dashboard did not start; see $dst\data\dashboard.log" }
