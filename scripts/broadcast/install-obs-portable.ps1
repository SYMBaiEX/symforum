param(
  [string]$Version = '33.0.0',
  [string]$ExpectedSha256 = '3369a3ecd67b5669a8a08d77357f87cc786d1fba42fbbd1054d841a69f6271a7'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$app = Join-Path $root "obs-$Version"
$archive = Join-Path $root "OBS-Studio-$Version-Windows-x64.zip"
New-Item -ItemType Directory -Path $root -Force | Out-Null
if (-not (Test-Path (Join-Path $app 'bin\64bit\obs64.exe'))) {
  if (-not (Test-Path $archive)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/obsproject/obs-studio/releases/download/$Version/OBS-Studio-$Version-Windows-x64.zip" -OutFile $archive
  }
  $hash = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
  if ($hash -ne $ExpectedSha256) { throw 'Official OBS archive checksum mismatch; installation stopped.' }
  if (Test-Path $app) { throw 'Incomplete destination exists. Inspect before replacing it.' }
  Expand-Archive -Path $archive -DestinationPath $app
}
$exe = Join-Path $app 'bin\64bit\obs64.exe'
$signature = Get-AuthenticodeSignature $exe
if ($signature.Status -ne 'Valid') { throw 'OBS executable signature is not valid.' }
if ($signature.SignerCertificate.Subject -notmatch '^CN="?OBS Project, LLC"?,') { throw 'Unexpected OBS executable publisher.' }
[ordered]@{ root = $root; app = $app; exe = $exe; version = $Version; signature = [string]$signature.Status; publisher = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress
