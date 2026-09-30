<#
.SYNOPSIS
  Copies the third-party skills that agents/org.json needs from this machine's Claude / skills installs
  into the SKILLS_SOURCE folder, so wsl/40-org.sh can import them into Paperclip.
  This repo's own skills come from skills/ and are skipped here.
#>
. "$PSScriptRoot\lib.ps1"
$cfg = Read-Config

$org = Get-Content (Join-Path $RepoDir 'agents\org.json') -Raw | ConvertFrom-Json
$wanted = @($org.commonSkills) + @($org.agents | ForEach-Object { $_.skills }) |
    ForEach-Object { $_.Replace('{{ENGINEERING_SKILL}}', $cfg.ENGINEERING_SKILL) } | Where-Object { $_ } | Sort-Object -Unique
$own = Get-ChildItem (Join-Path $RepoDir 'skills') -Directory | Select-Object -Expand Name
$builtin = 'paperclip', 'paperclip-converting-plans-to-tasks'   # shipped with Paperclip
$wanted = $wanted | Where-Object { $own -notcontains $_ -and $builtin -notcontains $_ }

# SKILLS_SOURCE is a WSL path like /mnt/c/Users/me/agent-skills -> C:\Users\me\agent-skills
if ($cfg.SKILLS_SOURCE -notmatch '^/mnt/([a-z])/(.*)$') { throw "SKILLS_SOURCE must be a /mnt/<drive>/... path" }
$dest = "$($Matches[1].ToUpper()):\$($Matches[2] -replace '/', '\')"
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
