<#
.SYNOPSIS
  Connects a project (one or more git repos) to the agents, and optionally links it to an Odoo project.
.EXAMPLE
  .\connect-project.ps1 -Name NeuraX -Base staging -Repo Emergen-Tech/neurax-backend, Emergen-Tech/neurax-dashboard -OdooProject NeuraX
.PARAMETER Name
  Paperclip project name.
.PARAMETER Repo
  GitHub owner/repo or git URL; several allowed. The first one is the primary workspace.
.PARAMETER Base
  Branch agents branch from and target with PRs (default: each repo's default branch).
.PARAMETER OdooProject
  Exact Odoo project name. Tickets tagged agent-ready in that project are filed under this Paperclip project.
#>
param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string[]]$Repo,
    [string]$Base = '',
    [string]$OdooProject = ''
)
. "$PSScriptRoot\windows\lib.ps1"
$cfg = Read-Config

$wslArgs = @('-d', $cfg.WSL_DISTRO, '-u', $cfg.WSL_USER, '--cd', $RepoDir, '--', 'bash', 'wsl/50-connect-project.sh', '--name', $Name)
if ($Base) { $wslArgs += @('--base', $Base) }
foreach ($r in $Repo) { $wslArgs += @('--repo', $r) }
$out = & wsl.exe @wslArgs | ForEach-Object { "$_" -replace "`0", '' } | Where-Object { $_ -notmatch 'Failed to mount' }
$out | Where-Object { $_ -notmatch '^PAPERCLIP_PROJECT_ID=' } | Write-Host
if ($LASTEXITCODE) { throw "connect-project failed" }
$projectId = ($out | Where-Object { $_ -match '^PAPERCLIP_PROJECT_ID=(.+)$' } | ForEach-Object { $Matches[1] }) | Select-Object -Last 1

if ($OdooProject) {
    $cfgFile = Join-Path (Get-HermesHome) 'scripts\agent_ops.config.json'
    if (-not (Test-Path $cfgFile)) { Write-Warn "Hermes bridge not installed; skipping the Odoo link"; return }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $json = [IO.File]::ReadAllText($cfgFile) | ConvertFrom-Json
    if (-not $json.project_map) { $json | Add-Member -NotePropertyName project_map -NotePropertyValue ([pscustomobject]@{}) -Force }
    $json.project_map | Add-Member -NotePropertyName $OdooProject -NotePropertyValue $projectId -Force
    [IO.File]::WriteAllText($cfgFile, ($json | ConvertTo-Json -Depth 5), $utf8)
    Write-Step "Odoo project '$OdooProject' -> Paperclip project $projectId (new agent-ready tickets go here)"
}
