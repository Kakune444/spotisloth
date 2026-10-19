param(
    [Parameter(Mandatory=$true)][ValidateSet('Spotify','Spotisloth')][string]$Client,
    [string]$ExecutablePath,
    [switch]$StopOnly,
    [ValidateSet('Normal','Maximized')][string]$WindowStyle='Maximized',
    [string]$OutputPath
)
$ErrorActionPreference='Stop'
if(!$ExecutablePath){
    $ExecutablePath=if($Client -eq 'Spotify'){Join-Path $env:APPDATA 'Spotify/Spotify.exe'}else{Join-Path $PSScriptRoot '../.local/desktop/spotisloth-desktop.exe'}
}
$executable=(Resolve-Path -LiteralPath $ExecutablePath).Path
$rootName=[IO.Path]::GetFileNameWithoutExtension($executable)
$roots=@(Get-Process -Name $rootName -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $executable})
$included=[Collections.Generic.HashSet[int]]::new()
foreach($root in $roots){[void]$included.Add($root.Id)}
$tree=Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId
do{
    $added=$false
    foreach($item in $tree){if($included.Contains([int]$item.ParentProcessId) -and $included.Add([int]$item.ProcessId)){$added=$true}}
}while($added)
$processes=@(foreach($processId in $included){Get-Process -Id $processId -ErrorAction SilentlyContinue})
# Only the resolved executable and its observed descendants are stopped.
foreach($root in $roots){Stop-Process -InputObject $root -ErrorAction SilentlyContinue}
foreach($process in $processes){
    try{if(!$process.HasExited){Stop-Process -InputObject $process -ErrorAction SilentlyContinue;$process.WaitForExit(5000)|Out-Null}}catch{}
}
if($StopOnly){[pscustomobject]@{client=$Client;stopped=$true}|ConvertTo-Json;exit}
$started=[DateTimeOffset]::UtcNow
$previousBenchmarkFlag=[Environment]::GetEnvironmentVariable('SPOTISLOTH_BENCHMARK_MAXIMIZE','Process')
try{
    [Environment]::SetEnvironmentVariable('SPOTISLOTH_BENCHMARK_MAXIMIZE',$(if($Client -eq 'Spotisloth' -and $WindowStyle -eq 'Maximized'){'1'}else{$null}),'Process')
    Start-Process -FilePath $executable -WorkingDirectory ([IO.Path]::GetDirectoryName($executable)) -WindowStyle $WindowStyle
}finally{[Environment]::SetEnvironmentVariable('SPOTISLOTH_BENCHMARK_MAXIMIZE',$previousBenchmarkFlag,'Process')}
$result=[pscustomobject]@{
    client=$Client;startedAtUtc=$started.ToString('o');startedAtEpochMs=$started.ToUnixTimeMilliseconds()
    windowStyle=$WindowStyle;restart='process restart; OS and network caches retained'
    executableVersion=(Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
}
if($OutputPath){$result|ConvertTo-Json|Set-Content -LiteralPath $OutputPath -Encoding utf8}
$result|ConvertTo-Json
