Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'icons'
New-Item -ItemType Directory -Path $icons -Force | Out-Null

foreach ($size in 192, 512) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(11, 13, 18))

  $margin = [int]($size * 0.14)
  $bookWidth = [int]($size * 0.52)
  $bookHeight = [int]($size * 0.58)
  $bookX = [int](($size - $bookWidth) / 2)
  $bookY = [int]($size * 0.23)
  $radiusPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(124, 156, 255), [single]($size * 0.055))
  $pagePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(244, 246, 251), [single]($size * 0.025))
  $headphonePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(89, 212, 153), [single]($size * 0.06))

  $graphics.DrawRectangle($radiusPen, $bookX, $bookY, $bookWidth, $bookHeight)
  $graphics.DrawLine($pagePen, [int]($size / 2), $bookY, [int]($size / 2), $bookY + $bookHeight)
  $graphics.DrawArc($headphonePen, $margin, $margin, $size - 2 * $margin, $size - 2 * $margin, 190, 160)
  $graphics.DrawLine($headphonePen, $margin, [int]($size * 0.48), $margin, [int]($size * 0.68))
  $graphics.DrawLine($headphonePen, $size - $margin, [int]($size * 0.48), $size - $margin, [int]($size * 0.68))

  $path = Join-Path $icons "icon-$size.png"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $headphonePen.Dispose()
  $pagePen.Dispose()
  $radiusPen.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
