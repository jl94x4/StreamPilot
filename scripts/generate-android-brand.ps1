# StreamPilot splash, TV banner, and splash icon from static/logo.png
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logoPath = Join-Path $root 'static\logo.png'
$res = Join-Path $root 'plex-client\android\app\src\main\res'
$logo = [System.Drawing.Image]::FromFile($logoPath)

$bg = [System.Drawing.Color]::FromArgb(7, 8, 12)
$bannerBg = [System.Drawing.Color]::FromArgb(44, 46, 51)
$orange = [System.Drawing.Color]::FromArgb(245, 158, 11)
$white = [System.Drawing.Color]::FromArgb(248, 250, 252)

function New-Gfx([int]$w, [int]$h, $clear = $null) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    if ($null -eq $clear) { $clear = $bg }
    $g.Clear($clear)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    return @{ Bmp = $bmp; G = $g }
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "wrote $path ($($bmp.Width)x$($bmp.Height))"
}

function Add-Glow($g, [int]$cx, [int]$cy, [int]$radius, [int]$alpha) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($cx - $radius, $cy - $radius, $radius * 2, $radius * 2)
    $gb = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
    $gb.CenterColor = [System.Drawing.Color]::FromArgb($alpha, $orange)
    $gb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $orange))
    $g.FillPath($gb, $path)
    $gb.Dispose()
    $path.Dispose()
}

function Draw-CenteredLogo($g, [int]$w, [int]$h, [double]$scale, [int]$glowAlpha = 0) {
    $size = [int][Math]::Round([Math]::Min($w, $h) * $scale)
    $x = [int][Math]::Round(($w - $size) / 2.0)
    $y = [int][Math]::Round(($h - $size) / 2.0)
    if ($glowAlpha -gt 0) {
        Add-Glow $g ([int]($w / 2)) ([int]($h / 2)) ([int]($size * 0.78)) $glowAlpha
    }
    $g.DrawImage($logo, $x, $y, $size, $size)
}

function Draw-TrackedWordmark($g, [int]$cx, [int]$y, [float]$fontPx) {
    $text = 'STREAMPILOT'
    $font = $null
    foreach ($name in @('Segoe UI Semibold', 'Segoe UI', 'Arial')) {
        try {
            $font = New-Object System.Drawing.Font $name, $fontPx, ([System.Drawing.FontStyle]::Bold)
            if ($font) { break }
        } catch { }
    }
    if (-not $font) { $font = New-Object System.Drawing.Font 'Arial', $fontPx, ([System.Drawing.FontStyle]::Bold) }
    $sf = [System.Drawing.StringFormat]::GenericTypographic
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(210, $orange))
    $origin = New-Object System.Drawing.PointF 0, 0
    $gap = $fontPx * 0.32
    $widths = New-Object 'System.Collections.Generic.List[float]'
    $total = 0.0
    foreach ($ch in $text.ToCharArray()) {
        $cw = $g.MeasureString([string]$ch, $font, $origin, $sf).Width
        [void]$widths.Add($cw)
        $total += $cw
    }
    $total += $gap * ($text.Length - 1)
    $x = [float]($cx - ($total / 2.0))
    for ($i = 0; $i -lt $text.Length; $i++) {
        $g.DrawString([string]$text[$i], $font, $brush, $x, [float]$y, $sf)
        $x += $widths[$i] + $gap
    }
    $font.Dispose()
    $brush.Dispose()
}

function Write-Splash([int]$w, [int]$h, [string]$rel) {
    $min = [Math]::Min($w, $h)
    $logoSize = [int][Math]::Round($min * 0.16)
    $fontPx = [Math]::Max(8.0, [float]($min * 0.028))
    $gap = [int][Math]::Round($min * 0.036)
    $blockH = $logoSize + $gap + [int][Math]::Ceiling($fontPx)
    $top = [int][Math]::Round(($h - $blockH) / 2.0)
    $cx = [int]($w / 2)
    $ctx = New-Gfx $w $h
    Add-Glow $ctx.G $cx ($top + [int]($logoSize / 2)) ([int]($logoSize * 1.2)) 28
    $ctx.G.DrawImage($logo, $cx - [int]($logoSize / 2), $top, $logoSize, $logoSize)
    Draw-TrackedWordmark $ctx.G $cx ($top + $logoSize + $gap) $fontPx
    Save-Png $ctx.Bmp (Join-Path $res $rel)
    $ctx.G.Dispose()
    $ctx.Bmp.Dispose()
}

# Native window splash (same sizes Capacitor already ships).
Write-Splash 480 320 'drawable\splash.png'
Write-Splash 480 320 'drawable-land-mdpi\splash.png'
Write-Splash 800 480 'drawable-land-hdpi\splash.png'
Write-Splash 1280 720 'drawable-land-xhdpi\splash.png'
Write-Splash 1600 960 'drawable-land-xxhdpi\splash.png'
Write-Splash 1920 1280 'drawable-land-xxxhdpi\splash.png'
Write-Splash 320 480 'drawable-port-mdpi\splash.png'
Write-Splash 480 800 'drawable-port-hdpi\splash.png'
Write-Splash 720 1280 'drawable-port-xhdpi\splash.png'
Write-Splash 960 1600 'drawable-port-xxhdpi\splash.png'
Write-Splash 1280 1920 'drawable-port-xxxhdpi\splash.png'

# Android 12+ splash icon: circular logo in the safe zone.
$icon = 576
$ctx = New-Gfx $icon $icon
Add-Glow $ctx.G ([int]($icon / 2)) ([int]($icon / 2)) 190 28
Draw-CenteredLogo $ctx.G $icon $icon 0.56
$nodpi = Join-Path $res 'drawable-nodpi'
if (-not (Test-Path $nodpi)) { New-Item -ItemType Directory -Path $nodpi | Out-Null }
Save-Png $ctx.Bmp (Join-Path $nodpi 'splash_icon.png')
$ctx.G.Dispose()
$ctx.Bmp.Dispose()

function New-RoundRect([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [Math]::Max(2, $r * 2)
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
    $path.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
    $path.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-FadedPosters($g, [int]$w, [int]$h) {
    $palette = @(
        @(176, 54, 48),
        @(34, 96, 112),
        @(184, 104, 40),
        @(78, 54, 128),
        @(138, 48, 72)
    )
    $posterH = [int][Math]::Round($h * 1.02)
    $posterW = [int][Math]::Round($posterH * 0.68)
    $count = 5
    $span = $w + [int]($posterW * 0.45)
    $step = $span / $count
    $x0 = -1 * [int]($posterW * 0.28)
    $radius = [Math]::Max(1, [int]($h * 0.012))
    for ($i = 0; $i -lt $count; $i++) {
        $rgb = $palette[$i]
        $x = [int][Math]::Round($x0 + ($i * $step))
        $y = [int][Math]::Round(($h - $posterH) / 2.0 + (($i % 2) * $h * 0.045 - $h * 0.02))
        $path = New-RoundRect $x $y $posterW $posterH $radius
        $top = [System.Drawing.Color]::FromArgb(158, $rgb[0], $rgb[1], $rgb[2])
        $bottom = [System.Drawing.Color]::FromArgb(148, [int]($rgb[0] * 0.28), [int]($rgb[1] * 0.28), [int]($rgb[2] * 0.28))
        $rect = New-Object System.Drawing.Rectangle $x, $y, $posterW, $posterH
        $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $top, $bottom, 90.0
        $g.FillPath($brush, $path)
        $brush.Dispose()
        $path.Dispose()
    }
    $wash = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(78, $bannerBg))
    $g.FillRectangle($wash, 0, 0, $w, $h)
    $wash.Dispose()
}

function Write-Banner([int]$w, [int]$h, [string]$rel) {
    $ctx = New-Gfx $w $h $bannerBg
    Draw-FadedPosters $ctx.G $w $h
    Draw-CenteredLogo $ctx.G $w $h 0.74
    Save-Png $ctx.Bmp (Join-Path $res $rel)
    $ctx.G.Dispose()
    $ctx.Bmp.Dispose()
}

Write-Banner 160 90 'drawable-mdpi\tv_banner.png'
Write-Banner 240 135 'drawable-hdpi\tv_banner.png'
Write-Banner 320 180 'drawable-xhdpi\tv_banner.png'
Write-Banner 480 270 'drawable-xxhdpi\tv_banner.png'
Write-Banner 640 360 'drawable-xxxhdpi\tv_banner.png'

$logo.Dispose()
Write-Output 'android brand assets ok'
