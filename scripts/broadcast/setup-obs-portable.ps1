param([string]$Version = '33.0.0')
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$app = Join-Path $root "obs-$Version"
$exe = Join-Path $app 'bin\64bit\obs64.exe'
if (-not (Test-Path $exe)) { throw 'Install the verified portable OBS build first.' }
if (Get-Process obs64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { throw 'The dedicated OBS instance is running. Do not rewrite its active configuration.' }
$config = Join-Path $app 'config\obs-studio'
$profile = Join-Path $config 'basic\profiles\SYMF'
$scenes = Join-Path $config 'basic\scenes'
$plugin = Join-Path $config 'plugin_config\obs-websocket'
$records = Join-Path $root 'recordings'
foreach ($directory in @($profile,$scenes,$plugin,$records)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$acl = Get-Acl $root
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in @($identity.User.Value,'S-1-5-18','S-1-5-32-544')) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -Path $root -AclObject $acl
function Write-Utf8([string]$Path,[string]$Content) { [IO.File]::WriteAllText($Path,$Content,(New-Object Text.UTF8Encoding($false))) }
$globalIni = @'
[General]
EnableAutoUpdates=false
[Video]
Renderer=Direct3D 11
'@
$userIni = @'
[General]
FirstRun=true
Pre19Defaults=false
Pre21Defaults=false
Pre23Defaults=false
Pre24.1Defaults=false
[Basic]
Profile=SYMF
ProfileDir=SYMF
SceneCollection=SYMF
SceneCollectionFile=SYMF
ConfigOnNewProfile=false
[BasicWindow]
WarnBeforeStartingStream=true
WarnBeforeStoppingStream=true
SysTrayEnabled=true
SysTrayWhenStarted=true
BrowserHWAccel=true
'@
$profileIni = @"
[General]
Name=SYMF
[Video]
BaseCX=1920
BaseCY=1080
OutputCX=1920
OutputCY=1080
FPSType=0
FPSCommon=30
ScaleType=bicubic
ColorFormat=NV12
ColorSpace=709
ColorRange=Partial
[Audio]
SampleRate=48000
ChannelSetup=Stereo
[Output]
Mode=Simple
FilenameFormatting=SYMF-Local-%CCYY-%MM-%DD-%hh-%mm-%ss
Reconnect=true
RetryDelay=5
MaxRetries=20
[SimpleOutput]
VBitrate=4500
ABitrate=128
StreamEncoder=nvenc
StreamAudioEncoder=aac
UseAdvanced=true
NVENCPreset2=p5
RecQuality=Stream
RecEncoder=nvenc
RecFormat2=mkv
FilePath=$records
"@
foreach ($entry in @(@{Path=(Join-Path $config 'global.ini');Value=$globalIni},@{Path=(Join-Path $config 'user.ini');Value=$userIni},@{Path=(Join-Path $profile 'basic.ini');Value=$profileIni})) {
  if (Test-Path $entry.Path) { throw "Dedicated configuration already exists; preserve it: $($entry.Path)" }
  Write-Utf8 $entry.Path $entry.Value
}
$scene = @{name='SYMF';current_scene='SYMF Live';current_program_scene='SYMF Live';scene_order=@(@{name='SYMF Live'});sources=@(@{name='SYMF Live';id='scene';versioned_id='scene';settings=@{items=@()}});groups=@();transitions=@();current_transition='Fade';transition_duration=300;modules=@{}}
Write-Utf8 (Join-Path $scenes 'SYMF.json') ($scene | ConvertTo-Json -Depth 8)
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$websocket = @{first_load=$false;server_enabled=$true;server_port=4458;alerts_enabled=$false;auth_required=$true;server_password=[Convert]::ToBase64String($bytes)}
Write-Utf8 (Join-Path $plugin 'config.json') ($websocket | ConvertTo-Json)
# Block network access to the authenticated control port; local access uses loopback.
if (-not (Get-NetFirewallRule -DisplayName 'SYMF OBS control - block network' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'SYMF OBS control - block network' -Direction Inbound -Action Block -Protocol TCP -LocalPort 4458 -Profile Any | Out-Null
}
Write-Utf8 (Join-Path $app 'portable_mode.txt') ''
$launcher = Join-Path $root 'Start-SYMF.ps1'
$launcherText = @'
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$exe = Join-Path $root 'obs-33.0.0\bin\64bit\obs64.exe'
if (Get-Process obs64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { exit 0 }
# Deliberately no --startstreaming and no destination credentials in arguments.
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList @('--portable','--profile','SYMF','--collection','SYMF','--minimize-to-tray','--disable-updater','--disable-missing-files-check','--websocket_ipv4_only')
'@
Write-Utf8 $launcher $launcherText
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
if (Get-ScheduledTask -TaskName 'SYMF Broadcast - Start OBS' -ErrorAction SilentlyContinue) { throw 'Dedicated startup task already exists; inspect instead of overwriting.' }
Register-ScheduledTask -TaskName 'SYMF Broadcast - Start OBS' -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Start the isolated SYMF OBS profile at user sign-in. Never starts streaming automatically.' | Out-Null
Start-ScheduledTask -TaskName 'SYMF Broadcast - Start OBS'
[ordered]@{root=$root;profile='SYMF';scene='SYMF Live';width=1920;height=1080;fps=30;encoder='NVENC H.264';controlAuthenticated=$true;controlNetworkBlocked=$true;startupTask='SYMF Broadcast - Start OBS';streamingConfigured=$false} | ConvertTo-Json -Compress
