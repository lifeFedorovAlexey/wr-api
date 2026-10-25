param(
  [string]$TaskName = "WildRift Assistant Daily Generation",
  [string]$WorkerScript = (Join-Path $PSScriptRoot 'assistant-worker.mjs'),
  [Parameter(Mandatory=$true)][string]$StateDir,
  [Parameter(Mandatory=$true)][string]$EnvFile
)

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$node = (Get-Command node -ErrorAction Stop).Source
$WorkerScript = (Resolve-Path -LiteralPath $WorkerScript).Path
$EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
$StateDir = [IO.Path]::GetFullPath($StateDir)
if (($WorkerScript + $EnvFile + $StateDir).Contains('"')) { throw 'Quotes in paths are not supported' }
$command = "& '{0}' '{1}' --state-dir '{2}' --env-file '{3}'; exit `$LASTEXITCODE" -f $node.Replace("'","''"),$WorkerScript.Replace("'","''"),$StateDir.Replace("'","''"),$EnvFile.Replace("'","''")
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $encoded" -WorkingDirectory (Split-Path $WorkerScript)
$trigger = @(
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)),
  (New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name))
)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Imports Lux texts at 06:30 Moscow through Gemma in LM Studio; catches up at login, publishes heartbeat, restores resources it started" -Force
Write-Host "Installed '$TaskName': one task, heartbeat every 5 minutes, generation daily at 06:30 Moscow with catch-up."
