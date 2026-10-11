# M0c: native Windows, symlinked skills + per-issue git worktree + device-guard.sh through Git Bash.
$base = 'http://127.0.0.1:3299/api'
$root = 'C:\Abbas\Emergen\agent-stack\spikes\native-win'
$repo = Join-Path $root 'repo'
$gitBash = 'C:\Program Files\Git\bin\bash.exe'
$guard = 'C:/Abbas/Emergen/agent-stack/wsl/hooks/device-guard.sh'
$json = @{ 'Content-Type' = 'application/json' }
function Post($u, $b) { Invoke-RestMethod -Method Post "$base$u" -ContentType 'application/json' -Body ($b | ConvertTo-Json -Depth 12) }

# 1. repo hooks: node logger (as M0b) + the real device-guard through Git Bash (full path, not the WSL bash.exe on PATH)
$hookFwd = ((Join-Path $repo '.claude\hook.mjs') -replace '\\', '/')
$bashFwd = $gitBash -replace '\\', '/'
$settings = @{ hooks = @{ PreToolUse = @(@{ matcher = '*'; hooks = @(
    @{ type = 'command'; command = "node `"$hookFwd`"" },
    @{ type = 'command'; command = "`"$bashFwd`" `"$guard`"" }) }) } } | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $repo '.claude\settings.json'), $settings, (New-Object Text.UTF8Encoding $false))
Set-Location $repo
git add -A; git commit -qm 'hooks' 2>$null

# 2. isolated workspaces + project with git_worktree policy
Invoke-RestMethod -Method Patch "$base/instance/settings/experimental" -ContentType 'application/json' -Body '{"enableIsolatedWorkspaces":true}' | Out-Null
$c  = (Get-Content (Join-Path $root 'company.id')).Trim()
$qaId = (Get-Content (Join-Path $root 'qa.id')).Trim()
$wt = (Join-Path $root 'worktrees') -replace '\\', '/'
$ref = (git -C $repo rev-parse --abbrev-ref HEAD).Trim()
$policy = @{ enabled = $true; defaultMode = 'isolated_workspace'; allowIssueOverride = $true
             workspaceStrategy = @{ type = 'git_worktree'; baseRef = $ref; worktreeParentDir = $wt } }
$proj = Post "/companies/$c/projects" @{ name = 'M0c'; description = 'native worktree spike'; status = 'in_progress'; leadAgentId = $qaId; executionWorkspacePolicy = $policy }
"project: $($proj.id)"
Post "/projects/$($proj.id)/workspaces" @{ name = 'repo'; sourceType = 'git_repo'; cwd = $repo; defaultRef = $ref; isPrimary = $true } | Out-Null

# 3. agent: drop the fixed cwd so the project workspace is used
$qa = Invoke-RestMethod "$base/agents/$qaId"
$cfg = $qa.adapterConfig
$cfg.PSObject.Properties.Remove('cwd')
Invoke-RestMethod -Method Patch "$base/agents/$qaId" -ContentType 'application/json' -Body (@{ adapterConfig = $cfg } | ConvertTo-Json -Depth 12) | Out-Null

# 4. issue: write a file, then try a blocked command
$desc = "1) Create a file worktree-proof.txt in your working directory containing exactly: worktree ok. 2) Then run this exact shell command and quote its output: adb install test.apk . 3) Reply with the single word done. Do nothing else."
$iss = Post "/companies/$c/issues" @{ title = 'M0c: worktree + device guard'; description = $desc; assigneeAgentId = $qaId; projectId = $proj.id }
"issue: $($iss.id) $($iss.identifier)"
$iss.id | Set-Content (Join-Path $root 'issue-c.id')
$proj.id | Set-Content (Join-Path $root 'project-c.id')
