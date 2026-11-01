# Read-only smoke test of a RUNNING dev app (npm run tauri dev). It sends no mouse or keyboard input.
# Checks: the process is alive, has a window, the window is not tiny, a screenshot is not blank, the dev server answers.
# Usage: powershell -File tests\smoke\app-smoke.ps1   (exit code 0 = all checks passed)
$ErrorActionPreference = "Stop"
$fail = 0
function Check($name, $ok, $detail = "") {
  if ($ok) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name  $detail"; $script:fail++ }
}

$p = Get-Process dev-file-explorer -ErrorAction SilentlyContinue | Select-Object -First 1
Check "dev-file-explorer process is running" ($null -ne $p)
if ($null -eq $p) { exit 1 }
Check "main window exists" ($p.MainWindowHandle -ne 0)
Check "process responds" $p.Responding

try {
  $r = Invoke-WebRequest -Uri "http://localhost:1420" -UseBasicParsing -TimeoutSec 5
  Check "dev server answers on :1420" ($r.StatusCode -eq 200)
  Check "page has the root element" ($r.Content -match 'id="root"')
} catch { Check "dev server answers on :1420" $false $_.Exception.Message }

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class SmokeWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[SmokeWin]::SetProcessDPIAware() | Out-Null
$rc = New-Object SmokeWin+RECT
[SmokeWin]::GetWindowRect($p.MainWindowHandle, [ref]$rc) | Out-Null
$w = $rc.R - $rc.L; $h = $rc.B - $rc.T
Check "window is at least 600x400" ($w -ge 600 -and $h -ge 400) "got ${w}x${h}"

if ($w -gt 0 -and $h -gt 0) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rc.L, $rc.T, 0, 0, $bmp.Size)
  $g.Dispose()
  $colors = @{}
  for ($x = 0; $x -lt $w; $x += 40) { for ($y = 0; $y -lt $h; $y += 40) { $colors[$bmp.GetPixel($x, $y).ToArgb()] = 1 } }
  $out = Join-Path $env:TEMP "devfileexplorer-smoke.png"
  $bmp.Save($out); $bmp.Dispose()
  Check "screenshot is not blank ($($colors.Count) distinct colours, saved to $out)" ($colors.Count -ge 4)
}

if ($fail -gt 0) { Write-Host "$fail check(s) failed"; exit 1 }
Write-Host "all checks passed"
