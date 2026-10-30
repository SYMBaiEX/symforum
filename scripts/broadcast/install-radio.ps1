$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$server = Join-Path $root 'tools\radio\server.mjs'
$media = Join-Path $root 'audio'
if (-not (Test-Path $server) -or -not (Test-Path (Join-Path $media 'playlist.json'))) { throw 'Copy the prepared radio files before installation.' }
$taskName = 'SYMF Broadcast - NyX Radio'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Radio task already exists; inspect rather than overwrite.' }
$node = (Get-Command node).Source
$launcher = Join-Path $root 'Run-Radio.ps1'
$script = @'
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$env:SYMF_RADIO_MEDIA = Join-Path $root 'audio'
& '__NODE__' (Join-Path $root 'tools\radio\server.mjs') 1>> (Join-Path $root 'radio.log') 2>> (Join-Path $root 'radio-error.log')
exit $LASTEXITCODE
'@
[IO.File]::WriteAllText($launcher,$script.Replace('__NODE__',$node.Replace("'","''")),(New-Object Text.UTF8Encoding($false)))
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`"" -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Local-only NyX audio and transparent now-playing overlay. Never starts a stream.' | Out-Null
Start-ScheduledTask -TaskName $taskName
$ready=$false
for($i=0;$i -lt 20;$i++) {
  try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:4471/health' -TimeoutSec 2; if($r.ready){$ready=$true;break} } catch {}
  Start-Sleep -Milliseconds 500
}
if(-not $ready){throw 'Local music service did not become ready.'}
$listener=Get-NetTCPConnection -State Listen -LocalPort 4471
if(@($listener|Where-Object {$_.LocalAddress -ne '127.0.0.1'}).Count){throw 'Radio must not listen on the network.'}
[ordered]@{ready=$ready;trackCount=$r.trackCount;loopbackOnly=$true;task=$taskName;broadcastStarted=$false}|ConvertTo-Json -Compress
