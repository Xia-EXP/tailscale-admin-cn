param([Parameter(Mandatory = $true)][string]$Address, [string]$Domain = 'tailscale-admin.local') # Map one private domain to the explicitly selected target address.
$ErrorActionPreference = 'Stop' # Stop before overwriting hosts if any validation or backup fails.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent() # Check the account needed to edit Windows hosts.
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script as administrator.' } # Explain the required local privilege.
$parsed = $null # Prepare a typed IPv4 parser output.
if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $Domain -notmatch '^(?=.{1,253}$)[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*$') { throw 'Enter a valid IPv4 address and domain.' } # Reject extra hosts entries, control characters and invalid domains.
$hostsFile = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts' # Use the Windows installation path instead of a guessed drive.
$original = [IO.File]::ReadAllText($hostsFile) # Preserve the current unrelated hostname mappings.
Copy-Item -LiteralPath $hostsFile -Destination ($hostsFile + '.tsadmin-' + (Get-Date -Format 'yyyyMMddHHmmssfff') + '.bak') # Create a reversible backup before changing this file.
$lines = [Collections.Generic.List[string]]::new() # Build the replacement without deleting other aliases on shared lines.
foreach ($line in ($original -split '\r?\n')) { $parts = $line -split '#', 2; $tokens = @($parts[0].Trim() -split '\s+' | Where-Object { $_ }); if ($tokens.Count -gt 1 -and $Domain -in $tokens[1..($tokens.Count - 1)]) { $aliases = @($tokens[1..($tokens.Count - 1)] | Where-Object { $_ -ine $Domain }); if ($aliases.Count) { $line = $tokens[0] + "`t" + ($aliases -join ' ') + $(if ($parts.Count -gt 1) { ' #' + $parts[1] } else { '' }) } elseif ($parts.Count -gt 1) { $line = '#' + $parts[1] } else { continue } }; $lines.Add($line) } # Remove only previous entries for the chosen domain while keeping all other aliases and comments.
$lines.Add($Address + "`t" + $Domain + ' # TailscaleAdmin-LAN') # Add the requested mapping exactly once.
[IO.File]::WriteAllText($hostsFile, (($lines -join "`r`n").TrimEnd() + "`r`n"), [Text.UTF8Encoding]::new($false)) # Write UTF-8 text and retain the existing hosts file permissions.
& ipconfig.exe /flushdns | Out-Null # Refresh Windows DNS cache so the new private name is immediately available.
Write-Host ($Domain + ' -> ' + $Address) # Display the effective mapping without credentials.
