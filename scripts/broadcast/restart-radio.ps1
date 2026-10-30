$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$expected=Join-Path $root 'tools\radio\server.mjs'
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort 4471 -ErrorAction SilentlyContinue)
foreach($listener in $listeners){
 $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
 if($listener.LocalAddress -ne '127.0.0.1' -or $process.Name -ne 'node.exe' -or -not $process.CommandLine.Contains($expected)){throw 'Unrecognized listener; do not stop it.'}
}
Stop-ScheduledTask -TaskName 'SYMF Broadcast - NyX Radio'
foreach($listener in $listeners){Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue}
Start-ScheduledTask -TaskName 'SYMF Broadcast - NyX Radio'
$ready=$false
for($i=0;$i -lt 20;$i++) {try{$r=Invoke-RestMethod 'http://127.0.0.1:4471/health' -TimeoutSec 1;if($r.ready){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 500}
if(-not $ready){throw 'Radio restart not ready'}
[ordered]@{ready=$true;onlyOwnedRadioRestarted=$true;broadcastStarted=$false}|ConvertTo-Json -Compress
