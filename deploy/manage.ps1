param([ValidateSet('start','stop','restart')][string]$Action = 'restart') # Limit control to the three supported application actions.
$ErrorActionPreference = 'Stop' # Return a clear failure if the task cannot be managed.
$root = Split-Path $PSScriptRoot -Parent # Restrict process matching to this installation directory.
$node = (Get-Command node.exe -ErrorAction Stop).Source # Resolve the installed Node.js executable used by the deployment.
if ($Action -in @('stop','restart')) { Stop-ScheduledTask -TaskName 'TailscaleAdmin-LAN'; Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $node -and $_.CommandLine.Contains((Join-Path $root 'deployment-launcher.mjs')) } | ForEach-Object { Stop-Process -Id $_.ProcessId } } # Stop only the owned task and its verified Node process.
if ($Action -in @('start','restart')) { Start-ScheduledTask -TaskName 'TailscaleAdmin-LAN' } # Start the existing installation without duplicating it.
Write-Host ('TailscaleAdmin-LAN: ' + $Action) # Report the requested task action.
