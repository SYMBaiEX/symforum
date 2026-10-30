$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem
$commands = @{}
foreach ($name in @('obs64', 'ffmpeg', 'node', 'python', 'nvidia-smi', 'winget')) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($command) { $commands[$name] = $command.Source }
}
$obsPaths = @("${env:ProgramFiles}\obs-studio\bin\64bit\obs64.exe", "${env:LOCALAPPDATA}\Programs\obs-studio\bin\64bit\obs64.exe") | Where-Object { Test-Path $_ }
$gpu = @()
if ($commands.ContainsKey('nvidia-smi')) { $gpu = & $commands['nvidia-smi'] --query-gpu=name,memory.total,utilization.gpu,memory.used --format=csv,noheader,nounits }
[ordered]@{
  os = $os.Caption
  version = $os.Version
  user = [Environment]::UserName
  profile = $env:USERPROFILE
  cpu = $cpu.Name
  logicalProcessors = $cpu.NumberOfLogicalProcessors
  memoryGiB = [Math]::Round($computer.TotalPhysicalMemory / 1GB)
  commands = $commands
  obsPaths = @($obsPaths)
  obsProcesses = @(Get-Process obs64 -ErrorAction SilentlyContinue | Select-Object Id, Path, SessionId)
  desktopSessions = @(Get-Process explorer -ErrorAction SilentlyContinue | Select-Object Id, SessionId)
  gpu = @($gpu)
  diskFreeGiB = [Math]::Round((Get-PSDrive C).Free / 1GB)
} | ConvertTo-Json -Depth 5 -Compress
