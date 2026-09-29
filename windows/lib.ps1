# Shared helpers for the Windows setup scripts. Dot-source it.
$ErrorActionPreference = 'Stop'
$RepoDir = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "[agent-stack] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[agent-stack] warning: $msg" -ForegroundColor Yellow }

function Read-Config {
    $file = Join-Path $RepoDir 'config.env'
    if (-not (Test-Path $file)) { throw "config.env not found. Copy config.example.env to config.env and edit it." }
    $cfg = @{}
    foreach ($line in Get-Content $file) {
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
    }
    foreach ($k in 'WSL_DISTRO', 'WSL_USER') { if (-not $cfg[$k]) { throw "config.env: $k is empty" } }
    return $cfg
}

# Run a repo script inside WSL. Returns the exit code.
function Invoke-WslScript($cfg, [string]$script, [switch]$AsRoot) {
    $wslArgs = @('-d', $cfg.WSL_DISTRO, '--cd', $RepoDir)
    if ($AsRoot) { $wslArgs += @('-u', 'root') } else { $wslArgs += @('-u', $cfg.WSL_USER) }
    $wslArgs += @('--', 'bash', $script)
    & wsl.exe @wslArgs | ForEach-Object { $_ -replace "`0", '' } | Where-Object { $_ -notmatch 'Failed to mount' } | Write-Host
    return $LASTEXITCODE
}

function Get-HermesHome {
    if ($env:HERMES_HOME) { return $env:HERMES_HOME }
    return Join-Path $env:LOCALAPPDATA 'hermes'
}
