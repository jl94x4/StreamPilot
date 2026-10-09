Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$staticDir = (Resolve-Path (Join-Path $PSScriptRoot '..\static')).Path
$srcPath = Join-Path $staticDir 'logo.png'
$img = [System.Drawing.Image]::FromFile($srcPath)
$bg = [System.Drawing.Color]::FromArgb(11, 15, 25)

function Save-PwaIcon {
    param(
        [int]$Size,
        [double]$LogoScale,
        [string]$OutName
    )
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear($bg)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $max = [int][Math]::Round($Size * $LogoScale)
    $scale = [Math]::Min($max / [double]$img.Width, $max / [double]$img.Height)
    $drawW = [int][Math]::Max(1, [Math]::Round($img.Width * $scale))
    $drawH = [int][Math]::Max(1, [Math]::Round($img.Height * $scale))
    $offsetX = [int][Math]::Round(($Size - $drawW) / 2.0)
    $offsetY = [int][Math]::Round(($Size - $drawH) / 2.0)
    $g.DrawImage($img, $offsetX, $offsetY, $drawW, $drawH)
    $out = Join-Path $staticDir $OutName
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    $fi = Get-Item $out
    Write-Output "$OutName $($fi.Length) bytes (logoScale=$LogoScale)"
}

# Contain the wordmark on a dark square (logo.png is a wide banner, not a badge).
foreach ($size in 192, 512) {
    Save-PwaIcon -Size $size -LogoScale 0.9 -OutName "pwa-icon-$size.png"
}

# Maskable: opaque full-bleed background; keep emblem inside the ~80% safe zone
Save-PwaIcon -Size 512 -LogoScale 0.88 -OutName 'pwa-icon-maskable-512.png'

$img.Dispose()
