$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$portableJava=Join-Path (Split-Path -Parent $projectPath) '.build-tools\java17\jdk-17.0.20.1+1'
if(Test-Path -LiteralPath $portableJava){$env:JAVA_HOME=$portableJava}
if(-not $env:JAVA_HOME){throw 'Set JAVA_HOME to Java 17 before verification.'}
$sdkPath=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$toolsPath=Join-Path $sdkPath 'build-tools\36.0.0'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$results=@()
foreach($audience in @('customer','driver')){
 $apkPath=Join-Path $projectPath "frontend\$audience\apk\Hyzz-$audience.apk"
 if(-not(Test-Path -LiteralPath $apkPath)){throw "Missing APK: $apkPath"}
 $compatibilityPath=Join-Path $projectPath "build\Hyzz-$audience.apk"
 if((Get-FileHash -LiteralPath $apkPath).Hash -ne (Get-FileHash -LiteralPath $compatibilityPath).Hash){throw 'App-folder APK differs from compatibility output'}
 $signature=& (Join-Path $toolsPath 'apksigner.bat') verify --verbose --print-certs $apkPath
 if($LASTEXITCODE -ne 0){throw "Signature verification failed: $audience"}
 $badging=& (Join-Path $toolsPath 'aapt.exe') dump badging $apkPath
 if($LASTEXITCODE -ne 0 -or -not($badging -match "package: name='com.hyzz.$audience'")){throw "Wrong Android package: $audience"}
 if($badging -match 'android.permission.(READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|SYSTEM_ALERT_WINDOW)'){throw "Unexpected inherited or background permission: $audience"}
 if($audience -eq "customer" -and $badging -match "android.permission.ACCESS_BACKGROUND_LOCATION"){throw "Customer app must not request background tracking"}
 if($audience -eq "driver" -and -not($badging -match "android.permission.ACCESS_BACKGROUND_LOCATION")){throw "Driver tracking permission missing"}
 if($audience -eq "driver" -and -not($badging -match "android.permission.FOREGROUND_SERVICE_LOCATION")){throw "Driver foreground service permission missing"}
 $resources=(& (Join-Path $toolsPath 'aapt2.exe') dump resources $apkPath) -join "`n"
 if($LASTEXITCODE -ne 0){throw 'Unable to inspect packaged resources'}
 $artMatch=[regex]::Match($resources,'drawable/assets_hyzzjourney\s*\n[^\n]*\(file\)\s+(\S+)')
 if(-not $artMatch.Success){throw "Missing Hyzz illustration resource mapping: $audience"}
 $artPath=$artMatch.Groups[1].Value
 foreach($brandAsset in @('assets_hyzzcustomericon','assets_hyzzdrivericon')){if($resources -notmatch "drawable/$brandAsset"){throw "Missing logo resource: $brandAsset"}}
 $zip=[IO.Compression.ZipFile]::OpenRead($apkPath)
 try{
  foreach($entry in @('assets/index.android.bundle','classes.dex','lib/arm64-v8a/libreactnative.so')){if(-not $zip.GetEntry($entry) -or $zip.GetEntry($entry).Length -le 0){throw "Missing APK content: $entry"}}
  if(-not $zip.GetEntry($artPath) -or $zip.GetEntry($artPath).Length -le 0){throw "Missing embedded Hyzz illustration file: $audience"}
  $bundleReader=New-Object IO.StreamReader($zip.GetEntry('assets/index.android.bundle').Open())
  try{$bundleText=$bundleReader.ReadToEnd()}finally{$bundleReader.Dispose()}
  if(-not $bundleText.Contains('https://api.srtechcreators.in')){throw "New API domain missing from compiled bundle: $audience"}
  if($bundleText.Contains('https://hyzz.bedatatech.com')){throw "Obsolete API domain remains in compiled bundle: $audience"}
  $configEntry=$zip.GetEntry('assets/app.config')
  if(-not $configEntry){throw 'Embedded Expo config not found'}
  $reader=New-Object IO.StreamReader($configEntry.Open());try{$config=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
  if($config.extra.appVariant -ne $audience){throw "Embedded audience mismatch: $audience"}
  if(-not($badging -match "versionCode='$($config.android.versionCode)'")){throw "Native/Expo version code mismatch: $audience"}
  $result=[pscustomobject]@{file=$apkPath;bytes=(Get-Item -LiteralPath $apkPath).Length;sha256=(Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash;package="com.hyzz.$audience";name=$config.name;audience=$config.extra.appVariant;signatureVerified=$true;signing='Android standard debug key - internal testing only';abi='arm64-v8a';minimumAndroid='7.0 (API 24)';badging=($badging|Select-String 'package:|sdkVersion:|targetSdkVersion:|application-label:|launchable-activity:|native-code:').Line}
  $results+=$result
  $result|Select-Object file,bytes,sha256,package,name,audience,signatureVerified|Format-List
 }finally{$zip.Dispose()}
}
$results|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $projectPath 'build\apk-verification.json') -Encoding UTF8
