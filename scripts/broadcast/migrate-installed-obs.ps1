param([ValidateSet('Migrate','Resume','RemovePortable')][string]$Phase = 'Migrate')
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$portable = Join-Path $root 'obs-33.0.0'
$source = Join-Path $portable 'config\obs-studio'
$target = Join-Path $env:APPDATA 'obs-studio'
$exe = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'
$receipt = Join-Path $root 'installed-obs-migration-result.json'
$step = 'preflight'
function Save-Result($value) { $value | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $receipt }
try {
  if ($Phase -eq 'RemovePortable') {
    $previous = Get-Content -Raw -LiteralPath $receipt | ConvertFrom-Json
    if (-not $previous.migrated -or -not (Test-Path -LiteralPath (Join-Path $previous.backup 'portable-config\basic\profiles\SYMF\basic.ini'))) { throw 'Verified migration backup required.' }
    if (-not (Test-Path -LiteralPath (Join-Path $target 'basic\profiles\SYMF\basic.ini'))) { throw 'Installed profile missing.' }
    $item = Get-Item -LiteralPath $portable
    if ($item.FullName -ne (Join-Path $root 'obs-33.0.0') -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected portable target.' }
    if (Get-Process -Name obs64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $portable 'bin\64bit\obs64.exe') }) { throw 'Portable app still running.' }
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($portable, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    if (Test-Path -LiteralPath $portable) { throw 'Portable app removal incomplete.' }
    $previous | Add-Member -NotePropertyName portableRemoved -NotePropertyValue $true -Force
    $previous | Add-Member -NotePropertyName recoverableInRecycleBin -NotePropertyValue $true -Force
    Save-Result $previous
    exit 0
  }
  if ((Get-AuthenticodeSignature -LiteralPath $exe).Status -ne 'Valid') { throw 'Installed OBS signature invalid.' }
  if (-not (Test-Path -LiteralPath (Join-Path $source 'basic\profiles\SYMF\basic.ini'))) { throw 'Source SYMF profile missing.' }
  $resuming = $Phase -eq 'Resume'
  $backup = $null
  if ($resuming) {
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $root 'migration-backups') -Directory -Filter 'installed-obs-*' | Sort-Object Name -Descending)
    if ($backups.Count -eq 0) { throw 'No migration backup.' }
    $backup = $backups[0].FullName
    foreach ($relative in @('basic\profiles\SYMF\basic.ini','basic\scenes\SYMF.json')) {
      if ((Get-FileHash -LiteralPath (Join-Path $source $relative)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $target $relative)).Hash -or (Get-FileHash -LiteralPath (Join-Path $source $relative)).Hash -ne (Get-FileHash -LiteralPath (Join-Path (Join-Path $backup 'portable-config') $relative)).Hash) { throw 'Resume does not match the saved migration.' }
    }
  } elseif ((Test-Path -LiteralPath (Join-Path $target 'basic\profiles\SYMF')) -or (Test-Path -LiteralPath (Join-Path $target 'basic\scenes\SYMF.json'))) { throw 'Existing SYMF configuration must not be overwritten.' }
  $step = 'firewall-check'
  $firewall = Get-NetFirewallRule -DisplayName 'SYMF OBS control - block network'
  if ([string]$firewall.Enabled -ne 'True' -or [string]$firewall.Action -ne 'Block') { throw 'Existing local-control network block required.' }
  # Ask only owned OBS windows to close normally; never force-kill, dismiss an
  # active-output warning, or stop an unknown executable. Unsaved settings flush.
  $step = 'normal-window-close'
  $processes = @(Get-Process -Name obs64 -ErrorAction SilentlyContinue)
  foreach ($process in $processes) {
    if ($process.Path -notin @($exe,(Join-Path $portable 'bin\64bit\obs64.exe'))) { throw 'Unexpected OBS instance.' }
    [void]$process.CloseMainWindow()
  }
  for ($i=0; $i -lt 40; $i++) {
    if (-not (Get-Process -Name obs64 -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Name obs64 -ErrorAction SilentlyContinue) { throw 'Please close OBS normally before migration; no force-close performed.' }
  $step = 'backup'
  $launcher = Join-Path $root 'Start-SYMF.ps1'
  if (-not $resuming) {
    $backup = Join-Path $root ('migration-backups\installed-obs-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    Copy-Item -LiteralPath $source -Destination (Join-Path $backup 'portable-config') -Recurse
    Copy-Item -LiteralPath $target -Destination (Join-Path $backup 'installed-config') -Recurse
    Copy-Item -LiteralPath $launcher -Destination (Join-Path $backup 'Start-SYMF-before.ps1')
  }
  # Preserve stream credentials configured in the installed app after audit.
  # If destinations conflict, stop instead of choosing or exposing either key.
  $step = 'destination-preservation'
  $credentialFiles = @(Get-ChildItem -LiteralPath (Join-Path $target 'basic\profiles') -Filter 'service.json' -File -Recurse | Where-Object {
    $s = Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json
    [bool]$s.settings.key -or [bool]$s.settings.server
  })
  if ($credentialFiles.Count -gt 1) { throw 'Multiple installed destinations; user choice required.' }
  $oldService = Join-Path $source 'basic\profiles\SYMF\service.json'
  $portableService = Get-Content -Raw -LiteralPath $oldService | ConvertFrom-Json
  if ($credentialFiles.Count -eq 1 -and ($portableService.settings.key -or $portableService.settings.server)) {
    if ((Get-FileHash -LiteralPath $oldService).Hash -ne (Get-FileHash -LiteralPath $credentialFiles[0].FullName).Hash) { throw 'Conflicting destinations; user choice required.' }
  }
  $step = 'config-copy'
  if (-not $resuming) {
    Copy-Item -LiteralPath (Join-Path $source 'basic\profiles\SYMF') -Destination (Join-Path $target 'basic\profiles\SYMF') -Recurse
    Copy-Item -LiteralPath (Join-Path $source 'basic\scenes\SYMF.json') -Destination (Join-Path $target 'basic\scenes\SYMF.json')
  }
  if ($credentialFiles.Count -eq 1) { Copy-Item -LiteralPath $credentialFiles[0].FullName -Destination (Join-Path $target 'basic\profiles\SYMF\service.json') -Force }
  foreach ($name in @('global.ini','user.ini')) { Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $target $name) -Force }
  $wsDir = Join-Path $target 'plugin_config\obs-websocket'
  New-Item -ItemType Directory -Path $wsDir -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $source 'plugin_config\obs-websocket\config.json') -Destination (Join-Path $wsDir 'config.json') -Force
  # Stream keys and the same purpose-bound local-control secret stay on laptop.
  $step = 'private-config-access'
  $acl = Get-Acl -LiteralPath $target
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $target -AclObject $acl
  $launcherText = @'
$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'
if (Get-Process obs64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { exit 0 }
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList @('--profile','SYMF','--collection','SYMF','--disable-missing-files-check','--websocket_ipv4_only')
'@
  $step = 'launcher-and-shortcut'
  [IO.File]::WriteAllText($launcher,$launcherText,(New-Object Text.UTF8Encoding($false)))
  $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'SYMF Broadcast.lnk'
  if (Test-Path -LiteralPath $shortcutPath) {
    Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $backup 'SYMF Broadcast-before.lnk')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.IconLocation = "$exe,0"
    $shortcut.Description = 'Open installed OBS Studio with the SYMF profile. Streaming stays manual.'
    $shortcut.Save()
  }
  Save-Result @{migrated=$true;backup=$backup;credentialCopied=($credentialFiles.Count -eq 1);credentialHashPreserved=($credentialFiles.Count -eq 0 -or (Get-FileHash -LiteralPath $credentialFiles[0].FullName).Hash -eq (Get-FileHash -LiteralPath (Join-Path $target 'basic\profiles\SYMF\service.json')).Hash);outputStarted=$false;portableRemoved=$false}
  $step = 'launch'
  & $launcher
} catch {
  Save-Result @{migrated=$false;stage=$step;error='Migration stopped safely; original configurations retained.';errorType=$_.Exception.GetType().Name;outputStarted=$false}
  exit 1
}
