param([switch]$EngineOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = Split-Path $PSScriptRoot -Parent
$cacheRoot = Join-Path $repoRoot '.cache/android-ai'
New-Item -ItemType Directory -Force $cacheRoot | Out-Null
$engineRevision = 'f2cc7282ce0042641df55e0e563b75e824e2b647'
$modelRevision = '91cad51170dc346986eccefdc2dd33a9da36ead9'
$modelName = 'qwen2.5-1.5b-instruct-q4_k_m.gguf'
$modelHash = '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'
$engineRoot = Join-Path $cacheRoot "llama.cpp-$engineRevision"
if (!(Test-Path -LiteralPath (Join-Path $engineRoot '.ready'))) {
    $archive = Join-Path $cacheRoot 'engine.zip'
    if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest "https://codeload.github.com/ggml-org/llama.cpp/zip/$engineRevision" -OutFile $archive -UseBasicParsing }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -match '^llama\.cpp-[^/]+/(tools|examples|tests|models|media|\.github)/') { continue }
            $destination = [System.IO.Path]::GetFullPath((Join-Path $cacheRoot $entry.FullName))
            if (!$destination.StartsWith($cacheRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path' }
            if ($entry.Name -eq '') { New-Item -ItemType Directory -Force $destination | Out-Null; continue }
            New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
    } finally { $zip.Dispose() }
    (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash | Set-Content (Join-Path $cacheRoot 'engine-archive.sha256')
    Set-Content (Join-Path $engineRoot '.ready') $engineRevision
}
Write-Output "Engine ready: $engineRevision"
$licenseRoot = Join-Path $repoRoot 'android/app/src/main/assets/licenses'
New-Item -ItemType Directory -Force $licenseRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $engineRoot 'LICENSE') -Destination (Join-Path $licenseRoot 'llama.cpp-LICENSE.txt')
if (!(Test-Path -LiteralPath (Join-Path $licenseRoot 'Qwen2.5-LICENSE.txt'))) {
    Invoke-WebRequest "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/$modelRevision/LICENSE" -OutFile (Join-Path $licenseRoot 'Qwen2.5-LICENSE.txt') -UseBasicParsing
}
if (!(Test-Path -LiteralPath (Join-Path $licenseRoot 'nlohmann-json-LICENSE.txt'))) {
    Invoke-WebRequest 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/LICENSE.MIT' -OutFile (Join-Path $licenseRoot 'nlohmann-json-LICENSE.txt') -UseBasicParsing
}
if (!$EngineOnly) {
    $modelFile = Join-Path $cacheRoot $modelName
    if (!(Test-Path -LiteralPath $modelFile)) {
        $partial = "$modelFile.partial"
        Invoke-WebRequest "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/$modelRevision/$($modelName)?download=true" -OutFile $partial -UseBasicParsing
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelHash) { throw 'Model checksum mismatch; file was not activated.' }
        Move-Item -LiteralPath $partial -Destination $modelFile
    }
    if ((Get-FileHash -LiteralPath $modelFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelHash) { throw 'Cached model checksum mismatch.' }
    Write-Output "Model verified: $modelName"
}
