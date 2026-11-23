$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$word = Join-Path $env:WINDIR 'assembly\GAC_MSIL\Microsoft.Office.Interop.Word\15.0.0.0__71e9bce111e9429c\Microsoft.Office.Interop.Word.dll'
$office = Join-Path $env:WINDIR 'assembly\GAC_MSIL\office\15.0.0.0__71e9bce111e9429c\office.dll'
$extensibility = Join-Path $env:WINDIR 'assembly\GAC\Extensibility\7.0.3300.0__b03f5f7f11d50a3a\Extensibility.dll'
foreach ($dependency in @($compiler, $word, $office, $extensibility)) {
    if (!(Test-Path -LiteralPath $dependency -PathType Leaf)) { throw "Missing build dependency: $dependency" }
}
$build = Join-Path $project 'build'
New-Item -Path $build -ItemType Directory -Force | Out-Null
$library = Join-Path $build 'WordEquationTools.dll'
$interop = @("/link:$word", "/link:$office", "/link:$extensibility")
$sources = @(Get-ChildItem -LiteralPath (Join-Path $project 'src') -Filter '*.cs' -File | ForEach-Object FullName)
$flags = @('/nologo','/codepage:65001','/warnaserror','/optimize+')
& $compiler @flags '/target:library' '/platform:anycpu' "/out:$library" @interop @sources
if ($LASTEXITCODE -ne 0) { throw 'Add-in compilation failed.' }
$setup = Join-Path $project 'installer\Setup.cs'
if (Test-Path -LiteralPath $setup) {
    $installer = Join-Path $build 'WordEquationSetup.exe'
    & $compiler @flags '/target:winexe' '/platform:anycpu' "/out:$installer" "/resource:$library,AddIn" $setup
    if ($LASTEXITCODE -ne 0) { throw 'Setup compilation failed.' }
}
$tester = Join-Path $project 'tests\Program.cs'
if (Test-Path -LiteralPath $tester) {
    $testExe = Join-Path $build 'WordEquationTests.exe'
    & $compiler @flags '/target:exe' '/platform:x64' "/out:$testExe" @interop @sources $tester
    if ($LASTEXITCODE -ne 0) { throw 'Test compilation failed.' }
}
