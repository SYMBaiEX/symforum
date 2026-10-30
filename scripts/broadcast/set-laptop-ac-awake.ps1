$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
if (-not (Test-Path $root)) { throw 'Set up the dedicated broadcast folder first.' }
function Read-Power([string]$Setting) {
  $raw = (& powercfg.exe /query SCHEME_CURRENT SUB_SLEEP $Setting) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read active power policy.' }
  $ac = [regex]::Match($raw,'Current AC Power Setting Index:\s*(0x[0-9a-fA-F]+)').Groups[1].Value
  $dc = [regex]::Match($raw,'Current DC Power Setting Index:\s*(0x[0-9a-fA-F]+)').Groups[1].Value
  if (-not $ac -or -not $dc) { throw 'Power policy output was not recognized; no changes made.' }
  return @{ac=$ac;dc=$dc}
}
$before = @{sleep=(Read-Power 'STANDBYIDLE');hibernate=(Read-Power 'HIBERNATEIDLE');scheme=((& powercfg.exe /getactivescheme) -join '')}
$backup = Join-Path $root 'power-policy-before.json'
if (-not (Test-Path $backup)) { [IO.File]::WriteAllText($backup,($before | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false))) }
& powercfg.exe /change standby-timeout-ac 0
if ($LASTEXITCODE -ne 0) { throw 'Could not update AC sleep timeout.' }
& powercfg.exe /change hibernate-timeout-ac 0
if ($LASTEXITCODE -ne 0) { throw 'Could not update AC hibernate timeout.' }
$after = @{sleep=(Read-Power 'STANDBYIDLE');hibernate=(Read-Power 'HIBERNATEIDLE')}
if ($after.sleep.dc -ne $before.sleep.dc -or $after.hibernate.dc -ne $before.hibernate.dc) { throw 'Battery settings changed unexpectedly; inspect power-policy-before.json.' }
[ordered]@{acSleepDisabled=($after.sleep.ac -eq '0x00000000');acHibernateDisabled=($after.hibernate.ac -eq '0x00000000');batterySettingsPreserved=$true;lidActionUnchanged=$true;backup=$backup} | ConvertTo-Json -Compress
