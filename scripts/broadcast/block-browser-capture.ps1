# User-approved browser-wide privacy policy. Does not restart browsers or touch profiles.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$entries = @()
foreach ($browser in @('Google\Chrome', 'Microsoft\Edge')) {
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    $base = "$hive\Software\Policies\$browser"
    foreach ($kind in @('Audio', 'Video')) {
      $exceptions = @(Get-ItemProperty -LiteralPath "$base\${kind}CaptureAllowedUrls" -ErrorAction SilentlyContinue | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } })
      if ($exceptions.Count -gt 0) { throw 'Existing capture exceptions require manual review; no policies changed.' }
      $p = Get-ItemProperty -LiteralPath $base -ErrorAction SilentlyContinue
      $name = "${kind}CaptureAllowed"
      if ($hive -eq 'HKLM:' -and $null -ne $p.$name -and $p.$name -ne 0) { throw 'Machine capture policy conflicts; no policies changed.' }
      if ($hive -eq 'HKCU:') { $entries += @{path=$base;name=$name;existed=($null -ne $p.$name);value=$p.$name} }
    }
  }
}
$backup = Join-Path $root 'browser-capture-policy-before.xml'
if (-not (Test-Path -LiteralPath $backup)) { $entries | Export-Clixml -LiteralPath $backup }
foreach ($entry in $entries) {
  if (-not (Test-Path -LiteralPath $entry.path)) { New-Item -Path $entry.path -Force | Out-Null }
  New-ItemProperty -LiteralPath $entry.path -Name $entry.name -PropertyType DWord -Value 0 -Force | Out-Null
}
foreach ($entry in $entries) {
  if ((Get-ItemProperty -LiteralPath $entry.path).($entry.name) -ne 0) { throw 'Policy readback failed.' }
}
[ordered]@{configured=$true;chromeCamera=$false;chromeMicrophone=$false;edgeCamera=$false;edgeMicrophone=$false;backupPreserved=$true;browsersRestarted=$false;ongoingCaptureNotVerified=$true} | ConvertTo-Json -Compress
