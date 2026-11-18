param(
    [Parameter(Mandatory = $true)][string]$GamePath,
    [string]$Python = 'python',
    [string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$privateRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.local-game'))
$logicRoot = if ($OutputRoot) { [IO.Path]::GetFullPath($OutputRoot) } else { Join-Path $privateRoot 'logic' }
if (!$logicRoot.StartsWith($privateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputRoot must be inside the ignored repository .local-game directory.'
}
$toolsRoot = Join-Path $logicRoot 'tools'
$cppPath = Join-Path $toolsRoot 'Cpp2IL.exe'
$cppUrl = 'https://github.com/SamboyCoding/Cpp2IL/releases/download/2022.1.0-pre-release.21/Cpp2IL-2022.1.0-pre-release.21-Windows.exe'
$cppHash = '663fb432433b4371fd1ee0ebc321a8fff2a9aac5ac4230c843f9e03ddee4e04c'
$nativePath = Join-Path $GamePath 'GameAssembly.dll'
$metadataPath = Join-Path $GamePath 'Idle Slayer_Data/il2cpp_data/Metadata/global-metadata.dat'
if (!(Test-Path -LiteralPath $nativePath) -or !(Test-Path -LiteralPath $metadataPath)) {
    throw 'GamePath must contain GameAssembly.dll and Idle Slayer_Data/il2cpp_data/Metadata/global-metadata.dat.'
}
New-Item -ItemType Directory -Force $toolsRoot | Out-Null
if (!(Test-Path -LiteralPath $cppPath)) {
    Invoke-WebRequest $cppUrl -OutFile $cppPath
}
if ((Get-FileHash -LiteralPath $cppPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $cppHash) {
    throw 'Cpp2IL checksum mismatch; inspect the local tool before running it.'
}

# Cpp2IL reads the PE and metadata offline. It does not start the game or invoke
# methods inside GameAssembly.dll. Raw reconstructions stay outside Git/site.
Push-Location $logicRoot
try {
    foreach ($format in @('dummydll', 'diffable-cs', 'isil')) {
        $folder = switch ($format) { 'dummydll' { 'dummy' }; 'diffable-cs' { 'cs' }; 'isil' { 'isil' } }
        $arguments = @('--game-path', $GamePath, '--exe-name', 'Idle Slayer', '--output-as', $format, '--output-to', (Join-Path $logicRoot $folder))
        if ($format -eq 'diffable-cs') { $arguments += @('--use-processor', 'attributeinjector') }
        if ($format -eq 'isil') { $arguments += @('--use-processor', 'callanalyzer') }
        & $cppPath @arguments 2>&1 | Tee-Object -FilePath (Join-Path $logicRoot "$folder.log")
        if ($LASTEXITCODE -ne 0) { throw "Cpp2IL $format failed with exit code $LASTEXITCODE." }
    }
    & $Python (Join-Path $PSScriptRoot 'inspect-methods.py') --game-path $GamePath --logic-root $logicRoot --check-receipt (Join-Path $PSScriptRoot 'native-method-receipt.json')
    if ($LASTEXITCODE -ne 0) { throw "Method evidence inspection failed with exit code $LASTEXITCODE." }
} finally {
    Pop-Location
}
