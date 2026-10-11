# Starts the Downloads watcher at every logon (hidden) and restarts it if it stops. Run from a normal PowerShell window.
#   .\install-startup.ps1            install and start now
#   .\install-startup.ps1 -Remove    stop and remove
param([switch]$Remove)
$name = 'Downloads-Organizer'
if ($Remove) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*downloads-organizer*watcher.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  "removed"; return
}
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot 'watcher.mjs'
$me = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$node`" `"$script`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Moves new downloads into topic subfolders' -Force | Out-Null
Start-ScheduledTask -TaskName $name
"installed and started: $name (log: $PSScriptRoot\logs\watcher.log)"
