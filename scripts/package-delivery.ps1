$ErrorActionPreference='Stop'
$rootPath=Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
function New-PortableZip($directory,$destination){
 $base=[IO.Path]::GetFullPath($directory).TrimEnd([IO.Path]::DirectorySeparatorChar)
 if(Test-Path -LiteralPath $destination){Remove-Item -LiteralPath $destination}
 $archive=[IO.Compression.ZipFile]::Open($destination,[IO.Compression.ZipArchiveMode]::Create)
 try{
  foreach($file in Get-ChildItem -LiteralPath $base -Recurse -File -Force){
   $entry=$file.FullName.Substring($base.Length+1).Replace('\','/')
   [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$entry,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
  }
 }finally{$archive.Dispose()}
}
& node (Join-Path $PSScriptRoot 'prepare-admin-vercel.cjs') | Out-Null
if($LASTEXITCODE -ne 0){throw 'Failed to prepare standalone admin source'}
$adminSourcePath=[IO.File]::ReadAllText((Join-Path $rootPath 'build\admin-vercel-source-path.txt')).Trim()
$adminVercelArchive=Join-Path $rootPath 'frontend\admin\release\Hyzz-admin-vercel.zip'
New-Item -ItemType Directory -Path (Split-Path -Parent $adminVercelArchive) -Force|Out-Null
if(Test-Path -LiteralPath $adminVercelArchive){Remove-Item -LiteralPath $adminVercelArchive}
New-PortableZip $adminSourcePath $adminVercelArchive
function Add-SourceDirectory($archive,$directory,$relative,$prefix='Hyzz/'){
 foreach($item in Get-ChildItem -LiteralPath $directory -Force){
  $name=$item.Name
  $entryName=if($relative){$relative+'/'+$name}else{$name}
  if($item.PSIsContainer){
   if($name -in @('node_modules','.git','.expo','.gradle','.cxx','.browser-check','.browser-mobile-check','.browser-fixture-check','build','dist','.idea','release','apk','web-preview') -or $name -like '.browser-*' -or $name -like 'dist-*'){continue}
   Add-SourceDirectory $archive $item.FullName $entryName $prefix
  }else{
   if($name -match '\.(apk|aab|keystore|jks|log|zip)$' -or $name -eq 'local.properties' -or ($name -like '.env*' -and $name -ne '.env.example') -or $name -eq 'credentials.json'){continue}
   [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$item.FullName,$prefix+$entryName,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
  }
 }
}
$sourceArchive=Join-Path $rootPath 'build\Hyzz-source.zip'
if(Test-Path -LiteralPath $sourceArchive){Remove-Item -LiteralPath $sourceArchive}
$zip=[IO.Compression.ZipFile]::Open($sourceArchive,[IO.Compression.ZipArchiveMode]::Create)
try{Add-SourceDirectory $zip $rootPath ''}finally{$zip.Dispose()}
$adminArchive=Join-Path $rootPath 'build\Hyzz-admin-web.zip'
if(Test-Path -LiteralPath $adminArchive){Remove-Item -LiteralPath $adminArchive}
New-PortableZip (Join-Path $rootPath 'frontend\admin\dist') $adminArchive
New-Item -ItemType Directory -Path (Join-Path $rootPath 'frontend\admin\release') -Force|Out-Null
Copy-Item -LiteralPath $adminArchive -Destination (Join-Path $rootPath 'frontend\admin\release\Hyzz-admin-web.zip') -Force
$backendArchive=Join-Path $rootPath 'build\Hyzz-backend.zip'
if(Test-Path -LiteralPath $backendArchive){Remove-Item -LiteralPath $backendArchive}
$zip=[IO.Compression.ZipFile]::Open($backendArchive,[IO.Compression.ZipArchiveMode]::Create)
try{Add-SourceDirectory $zip (Join-Path $rootPath 'backend') '' 'backend/'}finally{$zip.Dispose()}
New-Item -ItemType Directory -Path (Join-Path $rootPath 'backend\release') -Force|Out-Null
Copy-Item -LiteralPath $backendArchive -Destination (Join-Path $rootPath 'backend\release\Hyzz-backend.zip') -Force
$websitePath=Join-Path $rootPath 'frontend\website'
$websiteRelease=Join-Path $websitePath 'release'
New-Item -ItemType Directory -Path $websiteRelease -Force|Out-Null
$websiteSource=Join-Path $websiteRelease 'Hyzz-website-vercel.zip'
if(Test-Path -LiteralPath $websiteSource){Remove-Item -LiteralPath $websiteSource}
$websiteZip=[IO.Compression.ZipFile]::Open($websiteSource,[IO.Compression.ZipArchiveMode]::Create)
try{Add-SourceDirectory $websiteZip $websitePath '' ''}finally{$websiteZip.Dispose()}
New-PortableZip (Join-Path $websitePath 'dist') (Join-Path $websiteRelease 'Hyzz-website-web.zip')
Get-Item -LiteralPath $sourceArchive,$adminArchive|Select-Object FullName,Length
