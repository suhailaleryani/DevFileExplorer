# Draws the app icon source (1024x1024 PNG): a folder with a code glyph on a dark rounded tile.
# Then run:  npx tauri icon <out.png>   to generate every size in src-tauri/icons.
param([string]$Out = (Join-Path $env:TEMP "devfileexplorer-icon.png"))
Add-Type -AssemblyName System.Drawing

$S = 1024
$bmp = New-Object System.Drawing.Bitmap $S, $S
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = "AntiAlias"; $g.InterpolationMode = "HighQualityBicubic"; $g.TextRenderingHint = "AntiAliasGridFit"
$g.Clear([System.Drawing.Color]::Transparent)

function RoundRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}
function Brush2($x1, $y1, $x2, $y2, $c1, $c2) {
  return New-Object System.Drawing.Drawing2D.LinearGradientBrush ((New-Object System.Drawing.PointF $x1, $y1), (New-Object System.Drawing.PointF $x2, $y2), $c1, $c2)
}
$C = { param($hex) [System.Drawing.ColorTranslator]::FromHtml($hex) }

# tile
$tile = RoundRect 24 24 976 976 210
$g.FillPath((Brush2 0 0 0 1024 (& $C "#232a3b") (& $C "#0e1118")), $tile)
$pen = New-Object System.Drawing.Pen ((& $C "#3a4660"), 6)
$g.DrawPath($pen, $tile)

# folder back (tab + body)
$back = New-Object System.Drawing.Drawing2D.GraphicsPath
$back.AddPath((RoundRect 150 270 330 150 44), $false)
$g.FillPath((Brush2 0 270 0 420 (& $C "#f0b94a") (& $C "#d99a22")), $back)
$g.FillPath((Brush2 0 330 0 800 (& $C "#f6c75e") (& $C "#e0a02a")), (RoundRect 150 340 724 460 56))

# folder front panel (slightly darker band so the folder reads as open)
$g.FillPath((Brush2 0 470 0 800 (& $C "#ffd57a") (& $C "#eaa92f")), (RoundRect 150 450 724 350 56))

# code glyph
$font = New-Object System.Drawing.Font ("Consolas", 250, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = "Center"; $fmt.LineAlignment = "Center"
$rect = New-Object System.Drawing.RectangleF 150, 450, 724, 350
$g.DrawString("</>", $font, (New-Object System.Drawing.SolidBrush (& $C "#1b2233")), $rect, $fmt)

$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "wrote $Out"
