# Starts the Hermes gateway (via its own Hermes_Gateway task) only if no gateway process is running.
$running = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object { $_.CommandLine -match 'hermes_cli\.main\s+gateway\s+run' }
if (-not $running) {
    Start-ScheduledTask -TaskName 'Hermes_Gateway'
    Add-Content -Path "$env:LOCALAPPDATA\hermes\logs\gateway-watchdog.log" -Value "$(Get-Date -Format s) gateway not running; restarted"
}
