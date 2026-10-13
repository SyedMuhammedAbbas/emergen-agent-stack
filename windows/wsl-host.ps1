# .wslconfig memory limit for WSL (the skill renderer runs there). Idempotent.
# The old WSL-Agents-Keepalive task and vmIdleTimeout=-1 kept Paperclip running; neither is set any more.
. "$PSScriptRoot\lib.ps1"
$cfg = Read-Config

# ---- .wslconfig ----
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$content = if (Test-Path $wslconfig) { Get-Content $wslconfig -Raw } else { '' }
$changed = $false
if ($content -notmatch '(?m)^\[wsl2\]') { $content = "[wsl2]`r`n" + $content; $changed = $true }
foreach ($kv in @{ memory = $cfg.WSL_MEMORY }.GetEnumerator()) {
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
