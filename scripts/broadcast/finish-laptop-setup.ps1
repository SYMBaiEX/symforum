$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$tools = Join-Path $root 'tools'
New-Item -ItemType Directory -Path $tools -Force | Out-Null
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'SYMF Broadcast.lnk'
if (Test-Path $shortcutPath) { throw 'A SYMF Broadcast shortcut already exists; preserve it.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $root 'Start-SYMF.ps1')`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$(Join-Path $root 'obs-33.0.0\bin\64bit\obs64.exe'),0"
$shortcut.Description = 'Open the dedicated SYMF broadcast profile. Streaming remains manual.'
$shortcut.Save()
$notes = @'
SYMF BROADCAST - LAPTOP SETUP

Operator page: https://symf-broadcast.solsymbaiex.workers.dev/
Clean OBS source: https://symf-broadcast.solsymbaiex.workers.dev/program
Health: https://symf-broadcast.solsymbaiex.workers.dev/health

This is a separate portable OBS 33.0.0 install. Profile: SYMF. Scene: SYMF Live.
1080p30, NVENC H.264 CBR 4500 Kbps, AAC 128 Kbps, two-second keyframes.
Only the public forum browser source is captured. Desktop and mic audio are muted.
No Pump.fun URL or stream key is configured. No public stream has been started.
The desktop shortcut and sign-in task OPEN OBS, but NEVER start a broadcast.

For continuous operation, leave this laptop plugged in, online, signed into Windows,
and with the lid open. AC sleep/hibernate timeouts are disabled on the current power
plan. Battery and lid-close policies are unchanged. A reboot still requires Windows
sign-in; no automatic login, stored Windows password or auto-broadcast was enabled.
Network reconnect is configured, but crash/reboot broadcast recovery is not yet
armed. Complete destination setup and a supervised live check before unattended use.

NEXT: Generate Pump.fun RTMP credentials for the intended SYMF token and enter them
locally into OBS Settings > Stream > Custom. Never paste the key into a public page,
source file, screenshot or chat. Do not start streaming until the destination is
confirmed and you are ready for a public stream. No paid Cloudflare encoder exists.

Local status: node "%LOCALAPPDATA%\SYMF-Broadcast\tools\obs-control.mjs" status
Local recordings are retained under the recordings folder for QA comparison.
Original AC power settings are saved in power-policy-before.json.
'@
[IO.File]::WriteAllText((Join-Path $root 'START-HERE.txt'),$notes,(New-Object Text.UTF8Encoding($false)))
[ordered]@{shortcut=$shortcutPath;notes=(Join-Path $root 'START-HERE.txt');tools=$tools;startup='SYMF Broadcast - Start OBS';taskState=[string](Get-ScheduledTask -TaskName 'SYMF Broadcast - Start OBS').State;firewallEnabled=[string](Get-NetFirewallRule -DisplayName 'SYMF OBS control - block network').Enabled} | ConvertTo-Json -Compress
