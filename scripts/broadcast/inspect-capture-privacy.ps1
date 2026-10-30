$ErrorActionPreference = 'Stop'
$results = @()
foreach ($browser in @('Google\Chrome', 'Microsoft\Edge')) {
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    $base = "$hive\Software\Policies\$browser"
    $policy = Get-ItemProperty -LiteralPath $base -ErrorAction SilentlyContinue
    $results += [ordered]@{
      browser = $browser
      hive = $hive
      audioCaptureAllowed = $policy.AudioCaptureAllowed
      videoCaptureAllowed = $policy.VideoCaptureAllowed
      audioExceptions = @(Get-ItemProperty -LiteralPath "$base\AudioCaptureAllowedUrls" -ErrorAction SilentlyContinue | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } }).Count
      videoExceptions = @(Get-ItemProperty -LiteralPath "$base\VideoCaptureAllowedUrls" -ErrorAction SilentlyContinue | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } }).Count
    }
  }
}
$processes = @(Get-Process chrome,msedge,obs64 -ErrorAction SilentlyContinue | Group-Object ProcessName | ForEach-Object { @{name=$_.Name;count=$_.Count} })
[ordered]@{policies=$results;processes=$processes} | ConvertTo-Json -Depth 6 -Compress
