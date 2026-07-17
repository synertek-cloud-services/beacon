-- Seeded ComStore components for agent management
INSERT INTO components (id, name, type, origin, scope, category, shell, script, post_conditions, created_at, updated_at)
VALUES
  (
    'store-reinstall-agent-windows',
    'Reinstall Agent (Windows)',
    'script',
    'store',
    'global',
    'Agent Management',
    'powershell',
    '# Downloads and reinstalls the Beacon agent binary in-place without re-enrolling.
# Runs as SYSTEM — the service restarts automatically via SCM recovery (~5 seconds).
# Set SERVER_URL to your Beacon worker URL (e.g. https://rmm-api.example.com).

param()

$serverUrl = $env:SERVER_URL
if (-not $serverUrl) { Write-Error "SERVER_URL variable is required"; exit 1 }

$installDir  = "C:\Program Files\Beacon"
$installPath = Join-Path $installDir "beacon-agent.exe"
$backupPath  = Join-Path $installDir "beacon-agent.exe.bak"
$tempPath    = Join-Path $env:TEMP "beacon-agent-new.exe"

Write-Output "Downloading latest agent from $serverUrl ..."
Invoke-WebRequest -Uri "$serverUrl/v1/agent/download?os=windows&arch=amd64" `
  -OutFile $tempPath -UseBasicParsing

# Rename the running binary (Windows allows renaming an open file by handle).
# This vacates the slot so we can put the new binary in place while the service runs.
if (Test-Path $backupPath) { Remove-Item $backupPath -Force }
Rename-Item -Path $installPath -NewName "beacon-agent.exe.bak" -Force

Move-Item -Path $tempPath -Destination $installPath -Force

Write-Output "Binary replaced. Stopping service — SCM recovery will restart with new binary."

# SYSTEM can stop the service (SDDL grants SW to SY).
# Recovery actions restart it within 5 seconds.
Stop-Service BeaconAgent -Force

Write-Output "Done. Agent will reconnect shortly."',
    '[]',
    unixepoch(),
    unixepoch()
  ),
  (
    'store-restart-agent',
    'Restart Agent',
    'script',
    'store',
    'global',
    'Agent Management',
    'powershell',
    '# Restarts the Beacon agent service on a Windows device.
# Equivalent to the Restart Agent action on the device detail page,
# but available as a job component for bulk or scheduled execution.

Stop-Service BeaconAgent -Force
Write-Output "Agent service stopped — SCM recovery will restart it within 5 seconds."',
    '[]',
    unixepoch(),
    unixepoch()
  );

-- Variable for SERVER_URL on the Reinstall component
INSERT INTO component_variables (id, component_id, name, label, type, options, default_value, description, required, sort_order)
VALUES (
  'store-reinstall-agent-windows-serverurl',
  'store-reinstall-agent-windows',
  'SERVER_URL',
  'Server URL',
  'string',
  NULL,
  '',
  'Beacon worker base URL (e.g. https://rmm-api.example.com). Used to download the latest agent binary.',
  1,
  0
);
