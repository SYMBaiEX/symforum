$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$portable = Join-Path $root 'obs-33.0.0'
$installed = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'
$config = Join-Path $env:APPDATA 'obs-studio'
$oldConfig = Join-Path $portable 'config\obs-studio'
function ServiceSummary($file) {
  if (-not (Test-Path -LiteralPath $file)) { return @{exists=$false;hasServer=$false;hasKey=$false} }
  $data = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json
  return @{exists=$true;hasServer=[bool]$data.settings.server;hasKey=[bool]$data.settings.key}
}
function ConfigSummary($directory) {
  $profiles = @()
  $profileDir = Join-Path $directory 'basic\profiles'
  if (Test-Path -LiteralPath $profileDir) {
    $profiles = @(Get-ChildItem -LiteralPath $profileDir -Directory | ForEach-Object {
      @{folder=$_.Name;service=(ServiceSummary (Join-Path $_.FullName 'service.json'))}
    })
  }
  $scenes = @()
  $sceneDir = Join-Path $directory 'basic\scenes'
  if (Test-Path -LiteralPath $sceneDir) { $scenes = @(Get-ChildItem -LiteralPath $sceneDir -Filter '*.json' | ForEach-Object { $_.Name }) }
  $websocket = Join-Path $directory 'plugin_config\obs-websocket\config.json'
  $ws = @{exists=$false}
  if (Test-Path -LiteralPath $websocket) {
    $w = Get-Content -Raw -LiteralPath $websocket | ConvertFrom-Json
    $ws = @{exists=$true;enabled=$w.server_enabled;port=$w.server_port;authenticated=$w.auth_required}
  }
  return @{exists=(Test-Path -LiteralPath $directory);profiles=$profiles;scenes=$scenes;websocket=$ws}
}
$signature = Get-AuthenticodeSignature -LiteralPath $installed
$portableItem = Get-Item -LiteralPath $portable
$size = (Get-ChildItem -LiteralPath $portable -Recurse -File | Measure-Object -Property Length -Sum).Sum
@{
  installed=@{exists=(Test-Path -LiteralPath $installed);version=(Get-Item -LiteralPath $installed).VersionInfo.ProductVersion;signature=[string]$signature.Status;publisher=$signature.SignerCertificate.Subject}
  portable=@{exists=$true;reparse=[bool]($portableItem.Attributes -band [IO.FileAttributes]::ReparsePoint);bytes=$size;config=(ConfigSummary $oldConfig)}
  normalConfig=(ConfigSummary $config)
  processes=@(Get-Process -Name obs64 -ErrorAction SilentlyContinue | Select-Object Id,Path,SessionId)
  startup=@(Get-ScheduledTask -TaskName 'SYMF Broadcast*' | Select-Object TaskName,State)
} | ConvertTo-Json -Depth 7 -Compress
