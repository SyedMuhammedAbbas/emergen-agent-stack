# .wslconfig and the logon task that keeps WSL (and its systemd services) running. Idempotent.
. "$PSScriptRoot\lib.ps1"
$cfg = Read-Config

# ---- .wslconfig ----
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$content = if (Test-Path $wslconfig) { Get-Content $wslconfig -Raw } else { '' }
$changed = $false
if ($content -notmatch '(?m)^\[wsl2\]') { $content = "[wsl2]`r`n" + $content; $changed = $true }
foreach ($kv in @{ vmIdleTimeout = '-1'; memory = $cfg.WSL_MEMORY }.GetEnumerator()) {
    if (-not $kv.Value) { continue }
    if ($content -match "(?m)^$($kv.Key)=") {
        $new = $content -replace "(?m)^$($kv.Key)=[^\r\n]*", "$($kv.Key)=$($kv.Value)"
        if ($new -ne $content) { $content = $new; $changed = $true }
    } else {
        $content = $content -replace '(?m)^\[wsl2\]\s*$', "[wsl2]`r`n$($kv.Key)=$($kv.Value)"; $changed = $true
    }
}
if ($changed) {
    Set-Content -Path $wslconfig -Value $content.TrimEnd() -Encoding ascii
    Write-Warn ".wslconfig updated. It applies after 'wsl --shutdown' (this also restarts Docker Desktop)."
} else { Write-Step ".wslconfig ok" }

# ---- keepalive task ----
$me = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless wsl.exe -d $($cfg.WSL_DISTRO) --exec sleep infinity"
# At logon, plus every 15 minutes: IgnoreNew makes the repeat a no-op while it runs, and restarts it
# after anything (e.g. 'wsl --shutdown') killed it.
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $me),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15))
)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
$existing = Get-ScheduledTask -TaskName 'WSL-Agents-Keepalive' -ErrorAction SilentlyContinue
if ($existing) {
    # update in place so a running keepalive (and the agents in WSL) is not interrupted
    Set-ScheduledTask -TaskName 'WSL-Agents-Keepalive' -Action $action -Trigger $triggers -Settings $settings -Principal $principal | Out-Null
} else {
    Register-ScheduledTask -TaskName 'WSL-Agents-Keepalive' -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
        -Description 'Keeps WSL running so the Paperclip and jev-router systemd services stay up' | Out-Null
}
if ((Get-ScheduledTask -TaskName 'WSL-Agents-Keepalive').State -ne 'Running') { Start-ScheduledTask -TaskName 'WSL-Agents-Keepalive' }
Write-Step "task WSL-Agents-Keepalive registered (at logon and every 15 min)"
