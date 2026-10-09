<#
.SYNOPSIS
  Installs or updates the agent stack. Safe to re-run; it stops with instructions when a manual step is needed.
.PARAMETER SkipHermes
  Skip the Hermes bridge (Odoo intake, Discord digest, approvals).
.PARAMETER OnlyOrg
  Only re-apply agents/org.json, agent instructions and skills (after editing them).
#>
param([switch]$SkipHermes, [switch]$OnlyOrg)
. "$PSScriptRoot\windows\lib.ps1"
$cfg = Read-Config

function Invoke-Step($name, $script, [switch]$AsRoot) {
    Write-Step "== $name"
    $code = Invoke-WslScript $cfg $script -AsRoot:$AsRoot
    if ($code -eq 3) { Write-Host "`nRe-run .\install.ps1 after the steps above." -ForegroundColor Yellow; exit 3 }
    if ($code -ne 0) { throw "$name failed (exit $code)" }
}

if (-not $OnlyOrg) {
    $distros = (wsl.exe -l -q) -replace "`0", '' | Where-Object { $_.Trim() }
    if ($distros -notcontains $cfg.WSL_DISTRO) {
        throw "WSL distro $($cfg.WSL_DISTRO) not installed. In an admin PowerShell: wsl --install -d $($cfg.WSL_DISTRO), create the Linux user, then re-run."
    }
    $free = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
    if ($free -lt 5) { throw "Only $free GB free on C:. WSL's disk lives on C: and goes read-only when C: fills up. Free at least 5 GB first." }

    Write-Step "== Windows host"
    & "$PSScriptRoot\windows\wsl-host.ps1"
    Invoke-Step 'WSL base packages' 'wsl/10-base.sh' -AsRoot
    Invoke-Step 'WSL tools' 'wsl/20-tools.sh'
    Invoke-Step 'Browser dependencies' 'wsl/25-browser-deps.sh' -AsRoot
    Invoke-Step 'Services and logins' 'wsl/30-services.sh'
}
Invoke-Step 'Paperclip org, agents and skills' 'wsl/40-org.sh'
# ponytail plugin for Claude Code on Windows too (40-org.sh installs it in WSL; vetting note there)
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Step "== ponytail plugin (Windows Claude Code)"
    if (-not ((claude plugin marketplace list 2>$null) -match 'ponytail')) { claude plugin marketplace add DietrichGebert/ponytail | Out-Null }
    claude plugin install ponytail@ponytail 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { claude plugin update ponytail@ponytail 2>$null | Out-Null }
}
if (-not $SkipHermes -and -not $OnlyOrg) {
    Write-Step "== Hermes bridge"
    & "$PSScriptRoot\windows\hermes-bridge.ps1"
}
Write-Step "done. Paperclip: http://localhost:3100  jev-router live view: http://127.0.0.1:4100"
