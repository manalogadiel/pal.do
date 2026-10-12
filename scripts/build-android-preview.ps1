$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$jdk21 = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
if (Test-Path $jdk21) { $env:JAVA_HOME = $jdk21 }
Push-Location $repoRoot
try {
    $modelFile = Join-Path $repoRoot '.cache/android-ai/qwen2.5-0.5b-instruct-q4_k_m.gguf'
    if (!(Test-Path -LiteralPath $modelFile)) { & (Join-Path $PSScriptRoot 'prepare-android-ai.ps1') }
    $modelHash = '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db'
    if ((Get-FileHash -LiteralPath $modelFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelHash) { throw 'Bundled model checksum mismatch' }
    $modelAssets = Join-Path $repoRoot 'android/app/src/preview/assets/models'
    New-Item -ItemType Directory -Force $modelAssets | Out-Null
    Copy-Item -LiteralPath $modelFile -Destination (Join-Path $modelAssets 'qwen2.5-0.5b-instruct-q4_k_m.gguf')
    pnpm exec vite build --mode android-preview
    if ($LASTEXITCODE -ne 0) { throw 'Android web build failed' }
    $env:PALDO_ANDROID_PREVIEW = '1'
    pnpm exec cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'Android sync failed' }
    Push-Location (Join-Path $repoRoot 'android')
    try {
        .\gradlew.bat :app:assemblePreviewDebug :app:assemblePreviewDebugAndroidTest :app:testPreviewDebugUnitTest --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Android native build failed' }
    } finally { Pop-Location }
} finally { Remove-Item Env:\PALDO_ANDROID_PREVIEW -ErrorAction SilentlyContinue; Pop-Location }
