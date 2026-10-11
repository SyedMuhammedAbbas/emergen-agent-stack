# M0b: one real claude_local agent run on native Windows (scratch instance on :3299).
$base = 'http://127.0.0.1:3299'
$root = 'C:\Abbas\Emergen\agent-stack\spikes\native-win'
$repo = Join-Path $root 'repo'
$fwd  = $repo -replace '\\', '/'

New-Item -ItemType Directory -Force (Join-Path $repo '.claude') | Out-Null
Set-Location $repo
git init -q
git config user.email spike@example.invalid
git config user.name spike
Set-Content README.md 'spike repo'
git add -A
git commit -qm init

# PreToolUse hook written in node so it does not depend on bash being on PATH
$hook = Join-Path $repo '.claude\hook.mjs'
$js = "import fs from 'node:fs'; let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{ const j=JSON.parse(s||'{}'); fs.appendFileSync('$fwd/hook.log', new Date().toISOString()+' '+j.hook_event_name+' '+(j.tool_name||'')+'\n'); });"
[IO.File]::WriteAllText($hook, $js, (New-Object Text.UTF8Encoding $false))
$hookFwd = $hook -replace '\\', '/'
$settings = @{ hooks = @{ PreToolUse = @(@{ matcher = '*'; hooks = @(@{ type = 'command'; command = "node `"$hookFwd`"" }) }) } } | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $repo '.claude\settings.json'), $settings, (New-Object Text.UTF8Encoding $false))

$c  = (Invoke-RestMethod "$base/api/companies")[0].id
$qa = (Invoke-RestMethod "$base/api/companies/$c/agents") | Where-Object { $_.name -eq 'QA' }
$cfg = $qa.adapterConfig
$cfg | Add-Member -Force -NotePropertyName cwd -NotePropertyValue $repo
$cfg.model = 'claude-haiku-5-5'
$body = @{ adapterConfig = $cfg; runtimeConfig = @{ heartbeat = @{ enabled = $false; maxConcurrentRuns = 1 } } } | ConvertTo-Json -Depth 12
$p = Invoke-RestMethod -Method Patch "$base/api/agents/$($qa.id)" -ContentType 'application/json' -Body $body
"patched: $($p.name) cwd=$($p.adapterConfig.cwd) model=$($p.adapterConfig.model)"

$issBody = @{ title = 'Native spike: write hello.txt'; description = 'Create a file hello.txt in the working directory containing exactly: native ok. Then reply with the single word done. Do nothing else.'; assigneeAgentId = $qa.id } | ConvertTo-Json
$iss = Invoke-RestMethod -Method Post "$base/api/companies/$c/issues" -ContentType 'application/json' -Body $issBody
"issue: $($iss.id) $($iss.identifier) status=$($iss.status)"
$qa.id  | Set-Content (Join-Path $root 'qa.id')
$iss.id | Set-Content (Join-Path $root 'issue.id')
$c      | Set-Content (Join-Path $root 'company.id')
