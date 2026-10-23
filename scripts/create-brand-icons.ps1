# Deterministic raster exports of the code-native Hyzz road/H mark.
Add-Type -AssemblyName System.Drawing
$rootPath=Split-Path -Parent $PSScriptRoot
foreach($audience in @('customer','driver')){
 $background=if($audience -eq 'driver'){'#D4F467'}else{'#16765B'}
 $foreground=if($audience -eq 'driver'){'#16765B'}else{'#D4F467'}
 $bitmap=New-Object Drawing.Bitmap 1024,1024
 $graphics=[Drawing.Graphics]::FromImage($bitmap)
 $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
 $graphics.Clear([Drawing.ColorTranslator]::FromHtml($background))
 $brush=New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml($foreground))
 $points=[Drawing.PointF[]]@([Drawing.PointF]::new(275,750),[Drawing.PointF]::new(365,270),[Drawing.PointF]::new(485,270),[Drawing.PointF]::new(447,470),[Drawing.PointF]::new(628,470),[Drawing.PointF]::new(666,270),[Drawing.PointF]::new(786,270),[Drawing.PointF]::new(695,750),[Drawing.PointF]::new(575,750),[Drawing.PointF]::new(607,580),[Drawing.PointF]::new(426,580),[Drawing.PointF]::new(394,750))
 $graphics.FillPolygon($brush,$points)
 $laneBrush=New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml($background))
 $graphics.FillRectangle($laneBrush,475,518,45,13)
 $graphics.FillRectangle($laneBrush,549,518,45,13)
 $bitmap.Save((Join-Path $rootPath "assets\hyzz-$audience-icon.png"),[Drawing.Imaging.ImageFormat]::Png)
 $laneBrush.Dispose();$brush.Dispose();$graphics.Dispose();$bitmap.Dispose()
}
