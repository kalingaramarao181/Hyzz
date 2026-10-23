param([ValidateSet('customer','driver','both')][string]$Variant='both')
$ErrorActionPreference='Stop'
$projectPath=Split-Path -Parent $PSScriptRoot
$workspacePath=Split-Path -Parent $projectPath
$javaPath=Join-Path $workspacePath '.build-tools\java17\jdk-17.0.20.1+1'
if(Test-Path -LiteralPath $javaPath){$env:JAVA_HOME=$javaPath}
if(-not $env:JAVA_HOME){throw 'Set JAVA_HOME to a Java 17 installation.'}
$defaultSdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if(-not $env:ANDROID_HOME -and (Test-Path -LiteralPath $defaultSdk)){$env:ANDROID_HOME=$defaultSdk}
$testKeystore=Join-Path $projectPath 'android\app\debug.keystore'
if(-not(Test-Path -LiteralPath $testKeystore)){
 # Internal test signing only. Use a private managed release key for production.
 & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -noprompt -keystore $testKeystore -storepass android -alias androiddebugkey -keypass android -dname 'CN=Android Debug,O=Hyzz Test,C=IN' -keyalg RSA -keysize 2048 -validity 10000
 if($LASTEXITCODE -ne 0){throw 'Failed to generate the local test signing key'}
}
$env:NODE_ENV='production'
$outputPath=Join-Path $projectPath 'build'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$variants=if($Variant -eq 'both'){@('customer','driver')}else{@($Variant)}
Push-Location (Join-Path $projectPath 'android')
try {
 foreach($audience in $variants){
  $env:HYZZ_APP_VARIANT=$audience
  $appConfig=(& node -e "process.stdout.write(JSON.stringify(require(process.argv[1])))" (Join-Path $projectPath "frontend\$audience\app.config.js") | ConvertFrom-Json)
  $environmentFile=Join-Path $projectPath "frontend\$audience\.env"
  if(Test-Path -LiteralPath $environmentFile){foreach($line in Get-Content -LiteralPath $environmentFile){if($line -match '^(EXPO_PUBLIC_(CUSTOMER|DRIVER)_API_URL)=(.+)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[3].Trim('"',"'"),'Process')}}}
  $taskName=if($audience -eq 'driver'){':app:assembleDriverRelease'}else{':app:assembleCustomerRelease'}
  # Windows PowerShell turns native stderr warnings into ErrorRecords. Use the
  # process exit code, rather than treating a harmless Gradle warning as failure.
  $previousPreference=$ErrorActionPreference
  try{
   $ErrorActionPreference='Continue'
   & .\gradlew.bat $taskName --daemon --no-watch-fs --no-parallel --console=plain --max-workers=2 --build-cache --stacktrace '-PreactNativeArchitectures=arm64-v8a' "-PhyzzVersionCode=$($appConfig.versionCode)" "-PhyzzVersionName=$($appConfig.version)" *> (Join-Path $projectPath "build-$audience.log")
   $gradleExitCode=$LASTEXITCODE
  }finally{$ErrorActionPreference=$previousPreference}
  if($gradleExitCode -ne 0){throw "Gradle failed. See build-$audience.log"}
  $artifact=Join-Path $projectPath "android\app\build\outputs\apk\$audience\release\app-$audience-release.apk"
  if(-not(Test-Path -LiteralPath $artifact)){throw "APK not found: $artifact"}
  Copy-Item -LiteralPath $artifact -Destination (Join-Path $outputPath "Hyzz-$audience.apk") -Force
  $appOutput=Join-Path $projectPath "frontend\$audience\apk"
  New-Item -ItemType Directory -Path $appOutput -Force|Out-Null
  Copy-Item -LiteralPath $artifact -Destination (Join-Path $appOutput "Hyzz-$audience.apk") -Force
  Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $outputPath "Hyzz-$audience.apk")
 }
}finally{Pop-Location}
