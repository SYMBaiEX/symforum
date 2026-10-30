# Restore only the existing, dedicated SYMF window. Never starts an output.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'SYMF-Broadcast'
$exe = Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'
$receipt = Join-Path $root 'show-obs-result.json'
try {
  $owned = @(Get-Process -Name obs64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
  if ($owned.Count -gt 1) { throw 'Multiple dedicated instances; refusing to choose.' }
  if ($owned.Count -eq 0) {
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -ArgumentList @('--profile','SYMF','--collection','SYMF','--disable-missing-files-check','--websocket_ipv4_only')
    Start-Sleep -Seconds 3
    $owned = @(Get-Process -Name obs64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
  }
  if ($owned.Count -ne 1) { throw 'Dedicated instance unavailable.' }
  Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class SymfObsWindow {
  public delegate bool Visitor(IntPtr hwnd, IntPtr value);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor callback, IntPtr value);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
}
'@
  $script:target = [IntPtr]::Zero
  $script:ownedId = [uint32]$owned[0].Id
  $callback = [SymfObsWindow+Visitor]{ param($window, $value)
    $ownerId = [uint32]0
    [void][SymfObsWindow]::GetWindowThreadProcessId($window, [ref]$ownerId)
    if ($ownerId -eq $script:ownedId) {
      $title = New-Object Text.StringBuilder 256
      [void][SymfObsWindow]::GetWindowText($window, $title, $title.Capacity)
      if ($title.ToString() -match '^OBS .*Profile: SYMF') { $script:target = $window; return $false }
    }
    return $true
  }
  [void][SymfObsWindow]::EnumWindows($callback, [IntPtr]::Zero)
  if ($script:target -eq [IntPtr]::Zero) { throw 'Dedicated window not found in interactive session.' }
  [void][SymfObsWindow]::ShowWindowAsync($script:target, 9)
  Start-Sleep -Milliseconds 300
  $activated = [SymfObsWindow]::SetForegroundWindow($script:target)
  $visible = [SymfObsWindow]::IsWindowVisible($script:target)
  @{visible=$visible;foregroundRequested=$activated;processId=$script:ownedId;outputStarted=$false} | ConvertTo-Json -Compress | Set-Content -LiteralPath $receipt
} catch {
  @{visible=$false;error='Could not restore the dedicated OBS window';outputStarted=$false} | ConvertTo-Json -Compress | Set-Content -LiteralPath $receipt
  exit 1
}
