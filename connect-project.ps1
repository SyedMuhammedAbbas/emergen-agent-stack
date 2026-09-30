<#
.SYNOPSIS
  Connects a project (one or more git repos) to the agents, and optionally links it to an Odoo project.
.EXAMPLE
  # your existing checkouts on D:, linked to Odoo project 91
  .\connect-project.ps1 -Name NeuraX -Base staging -OdooProjectId 91 `
      -LocalPath D:\Projects\Emergen\NeuraX\neurax-backend, D:\Projects\Emergen\NeuraX\neurax-dashboard, D:\Projects\Emergen\NeuraX\neurax-app
.EXAMPLE
  # fresh clones inside WSL
  .\connect-project.ps1 -Name NeuraX -Base staging -Repo Emergen-Tech/neurax-backend, Emergen-Tech/neurax-app
.PARAMETER Name
  Paperclip project name.
.PARAMETER LocalPath
  Existing local git checkouts (Windows paths). Agents work in separate git worktrees, so your open files are not touched.
.PARAMETER Repo
  GitHub owner/repo or git URL to clone into WSL instead. The first repo (LocalPath first) is the primary workspace.
.PARAMETER Base
  Branch agents branch from and open PRs against (default: each repo's default branch).
.PARAMETER OdooProjectId
  Odoo project id. Tickets tagged agent-ready in that project are filed under this Paperclip project, and the
  Timekeeper logs your time for these repos against it.
.PARAMETER OdooProject
  Odoo project name, if you prefer names over ids.
#>
param(
    [Parameter(Mandatory)][string]$Name,
    [string[]]$LocalPath = @(),
    [string[]]$Repo = @(),
    [string]$Base = '',
    [int]$OdooProjectId = 0,
    [string]$OdooProject = ''
)
. "$PSScriptRoot\windows\lib.ps1"
$cfg = Read-Config
if (-not $LocalPath -and -not $Repo) { throw "Give -LocalPath and/or -Repo" }

function ConvertTo-WslPath([string]$p) {
    $full = (Resolve-Path $p).Path
    if ($full -notmatch '^([A-Za-z]):\\(.*)$') { throw "not a drive path: $p" }
    "/mnt/$($Matches[1].ToLower())/$($Matches[2] -replace '\\', '/')"
}

$wslArgs = @('-d', $cfg.WSL_DISTRO, '-u', $cfg.WSL_USER, '--cd', $RepoDir, '--exec', 'bash', 'wsl/50-connect-project.sh', '--name', $Name)
if ($Base) { $wslArgs += @('--base', $Base) }
if ($OdooProjectId) { $wslArgs += @('--odoo-project-id', "$OdooProjectId") }
foreach ($p in $LocalPath) { $wslArgs += @('--path', (ConvertTo-WslPath $p)) }
foreach ($r in $Repo) { $wslArgs += @('--repo', $r) }
$out = & wsl.exe @wslArgs | ForEach-Object { "$_" -replace "`0", '' } | Where-Object { $_ -notmatch 'Failed to mount' }
$code = $LASTEXITCODE
$out | Where-Object { $_ -notmatch '^PAPERCLIP_PROJECT_ID=' } | Write-Host
if ($code) { throw "connect-project failed" }
$projectId = ($out | Where-Object { $_ -match '^PAPERCLIP_PROJECT_ID=(.+)$' } | ForEach-Object { $Matches[1] }) | Select-Object -Last 1

$keys = @()
if ($OdooProjectId) { $keys += "$OdooProjectId" }
if ($OdooProject) { $keys += $OdooProject }
if ($keys) {
    $cfgFile = Join-Path (Get-HermesHome) 'scripts\agent_ops.config.json'
    if (-not (Test-Path $cfgFile)) { Write-Warn "Hermes bridge not installed; skipping the Odoo link"; return }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $json = [IO.File]::ReadAllText($cfgFile) | ConvertFrom-Json
    if (-not $json.project_map) { $json | Add-Member -NotePropertyName project_map -NotePropertyValue ([pscustomobject]@{}) -Force }
    foreach ($k in $keys) { $json.project_map | Add-Member -NotePropertyName $k -NotePropertyValue $projectId -Force }
    [IO.File]::WriteAllText($cfgFile, ($json | ConvertTo-Json -Depth 5), $utf8)
    Write-Step "Odoo project $($keys -join ' / ') -> Paperclip project $projectId"
}
