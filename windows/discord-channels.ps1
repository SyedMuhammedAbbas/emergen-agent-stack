<#
.SYNOPSIS
  Creates the "Agent Ops" category and channels in your Discord server with Hermes's bot, saves their ids in
  config.env, and re-points the Hermes jobs at them. Idempotent.
.PARAMETER GuildId
  Your Discord server id (Developer Mode on, right-click the server icon, Copy Server ID).
.NOTES
  The bot needs the "Manage Channels" permission (Server Settings > Roles > the bot's role).
#>
param([Parameter(Mandatory)][string]$GuildId)
. "$PSScriptRoot\lib.ps1"
$cfg = Read-Config
$hh = Get-HermesHome
$py = Join-Path $hh 'hermes-agent\venv\Scripts\python.exe'
$scripts = Join-Path $hh 'scripts'
Copy-Item "$RepoDir\hermes\discord_setup.py" $scripts -Force

$lines = & $py (Join-Path $scripts 'discord_setup.py') $GuildId
if ($LASTEXITCODE) { throw "Discord channel setup failed" }

# write/replace the ids in config.env
$envPath = Join-Path $RepoDir 'config.env'
$content = [IO.File]::ReadAllText($envPath)
foreach ($l in $lines) {
    if ($l -notmatch '^([A-Z_]+)=(\d+)$') { continue }
    $k, $v = $Matches[1], $Matches[2]
    if ($content -match "(?m)^$k=") { $content = $content -replace "(?m)^$k=[^\r\n]*", "$k=$v" } else { $content = $content.TrimEnd() + "`n$k=$v`n" }
    Write-Step "$k=$v"
}
[IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding($false)))

& "$PSScriptRoot\hermes-bridge.ps1"
