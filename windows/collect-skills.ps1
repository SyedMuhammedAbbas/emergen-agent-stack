<#
.SYNOPSIS
  Copies third-party skills that are not committed (proprietary or no recorded license, see
  skills/.gitignore and skills/THIRD_PARTY.md) from this machine's Claude / skills installs into the
  repo's skills/ folder (or SKILLS_SOURCE if set). wsl/60-sync-skills.sh then installs everything.
  Skills already in skills/ are skipped.
#>
. "$PSScriptRoot\lib.ps1"
$cfg = Read-Config

$org = Get-Content (Join-Path $RepoDir 'agents\org.json') -Raw | ConvertFrom-Json
$wanted = @($org.commonSkills) + @($org.agents | ForEach-Object { $_.skills }) |
    ForEach-Object { $_.Replace('{{ENGINEERING_SKILL}}', $cfg.ENGINEERING_SKILL) } | Where-Object { $_ } | Sort-Object -Unique
# plus the vendored skills kept out of git (skills/.gitignore): they are restored here on a new machine
$ignored = Get-Content (Join-Path $RepoDir 'skills\.gitignore') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^/([^/]+)/$' } | ForEach-Object { $Matches[1] }
$wanted = @($wanted) + @($ignored) | Sort-Object -Unique
$own = Get-ChildItem (Join-Path $RepoDir 'skills') -Directory | Select-Object -Expand Name
$builtin = 'paperclip', 'paperclip-converting-plans-to-tasks'   # shipped with Paperclip
$wanted = $wanted | Where-Object { $own -notcontains $_ -and $builtin -notcontains $_ }

# Destination: the repo's skills/ (default), or SKILLS_SOURCE if set (WSL path like /mnt/c/Users/me/extra-skills)
if ($cfg.SKILLS_SOURCE) {
    if ($cfg.SKILLS_SOURCE -notmatch '^/mnt/([a-z])/(.*)$') { throw "SKILLS_SOURCE must be a /mnt/<drive>/... path" }
    $dest = "$($Matches[1].ToUpper()):\$($Matches[2] -replace '/', '\')"
} else {
    $dest = Join-Path $RepoDir 'skills'
}
New-Item -ItemType Directory -Force $dest | Out-Null

$roots = @(
    "$env:USERPROFILE\.claude\skills",
    "$env:USERPROFILE\.agents\skills",
    "$env:USERPROFILE\.claude\plugins\cache",
    "$env:APPDATA\Claude\local-agent-mode-sessions"
) | Where-Object { Test-Path $_ }

$found = @{}
foreach ($r in $roots) {
    Get-ChildItem $r -Recurse -Filter SKILL.md -Depth 8 -ErrorAction SilentlyContinue |
        Where-Object { $wanted -contains $_.Directory.Name } |
        ForEach-Object {
            $n = $_.Directory.Name
            if (-not $found[$n] -or $_.LastWriteTime -gt $found[$n].LastWriteTime) { $found[$n] = $_ }
        }
}
foreach ($n in $wanted) {
    if ($found[$n]) {
        Copy-Item $found[$n].Directory.FullName -Destination $dest -Recurse -Force
        Write-Step ("{0,-32} <- {1}" -f $n, $found[$n].Directory.FullName)
    } else {
        Write-Warn "$n not found on this machine; see skills/THIRD_PARTY.md for its source"
    }
}
Write-Step "skills collected in $dest. Apply with: .\install.ps1 -OnlyOrg"
