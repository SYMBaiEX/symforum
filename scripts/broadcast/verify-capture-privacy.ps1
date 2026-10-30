$ErrorActionPreference = 'Stop'
$result=@()
foreach($browser in @('Google\Chrome','Microsoft\Edge')) {
 $base="HKCU:\Software\Policies\$browser"
 $policy=Get-ItemProperty -LiteralPath $base
 if($policy.AudioCaptureAllowed -ne 0 -or $policy.VideoCaptureAllowed -ne 0){throw 'Browser capture-deny policy missing.'}
 foreach($hive in @('HKCU:','HKLM:')) {
  foreach($kind in @('Audio','Video')) {
   $key="$hive\Software\Policies\$browser\${kind}CaptureAllowedUrls"
   $exceptions=@(Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue|ForEach-Object {$_.PSObject.Properties|Where-Object {$_.Name -notmatch '^PS'}})
   if($exceptions.Count){throw 'Capture exception found.'}
  }
 }
 $result+=@{browser=$browser;cameraDeniedPolicy=$true;microphoneDeniedPolicy=$true;exceptions=0}
}
$usage=@()
foreach($kind in @('webcam','microphone')) {
 $keys=@(Get-ChildItem -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\$kind\NonPackaged" -ErrorAction SilentlyContinue|Where-Object {$_.PSChildName -match '(chrome|msedge)\.exe$'})
 $active=0
 foreach($key in $keys){$v=Get-ItemProperty -LiteralPath $key.PSPath;if($v.LastUsedTimeStart -gt 0 -and $v.LastUsedTimeStop -eq 0){$active++}}
 $usage+=@{capability=$kind;recordedBrowserEntries=$keys.Count;activeUsageRecords=$active}
}
[ordered]@{policies=$result;windowsUsage=$usage;scope='Chrome and Edge browser capture; not OS-wide hardware disable';policyRegistryVerified=$true;browserPermissionApiTested=$false}|ConvertTo-Json -Depth 5 -Compress
