# User explicitly approved restarting Chrome and Edge on ai-laptop only.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$targets=@()
foreach($name in @('chrome','msedge')) {
 $processes=@(Get-Process $name -ErrorAction SilentlyContinue)
 if($processes.Count -eq 0){continue}
 $exe=($processes|Where-Object {$_.Path}|Select-Object -First 1).Path
 if(-not $exe -or -not (Test-Path -LiteralPath $exe)){throw 'Could not resolve installed browser path.'}
 $targets+=@{name=$name;exe=$exe;oldIds=@($processes.Id)}
}
foreach($t in $targets){
 foreach($p in @(Get-Process $t.name -ErrorAction SilentlyContinue|Where-Object {$_.MainWindowHandle -ne 0})){[void]$p.CloseMainWindow()}
}
Start-Sleep -Seconds 4
foreach($t in $targets){Get-Process $t.name -ErrorAction SilentlyContinue|Stop-Process -Force}
Start-Sleep -Seconds 1
if(@(Get-Process chrome,msedge -ErrorAction SilentlyContinue).Count){throw 'Browser processes remain; do not claim restart complete.'}
$launcher=Join-Path $root 'Restart-Browsers-Once.ps1'
$body='$ErrorActionPreference = "Stop"'+[Environment]::NewLine
foreach($t in $targets){$body+="Start-Process -FilePath '"+$t.exe.Replace("'","''")+"' -ArgumentList '--restore-last-session'"+[Environment]::NewLine}
[IO.File]::WriteAllText($launcher,$body,(New-Object Text.UTF8Encoding($false)))
$taskName='SYMF Privacy - Browser Restart Once'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'Owned restart task already exists.'}
$principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1)) -Description 'User-approved one-time browser restart after capture-deny policy; no streaming.' | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8
$verification=@()
foreach($t in $targets){
 $now=@(Get-Process $t.name -ErrorAction SilentlyContinue)
 $verification+=@{browser=$t.name;running=($now.Count -gt 0);oldProcessesGone=(@($now|Where-Object {$t.oldIds -contains $_.Id}).Count -eq 0)}
}
if(@($verification|Where-Object {-not $_.running -or -not $_.oldProcessesGone}).Count){throw 'Browser restart verification incomplete.'}
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
[ordered]@{restarted=$verification;temporaryTaskRemoved=$true;macBrowsersTouched=$false;broadcastStarted=$false}|ConvertTo-Json -Depth 4 -Compress
