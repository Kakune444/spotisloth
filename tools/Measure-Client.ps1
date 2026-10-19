param(
    [Parameter(Mandatory=$true)][ValidateSet('Spotify','Spotisloth')][string]$Client,
    [ValidateRange(3,900)][int]$Seconds=30,
    [ValidateSet('Idle','Navigation','Playback')][string]$Scenario='Idle',
    [ValidateRange(250,5000)][int]$IntervalMs=1000,
    [string]$OutputPath
)
$ErrorActionPreference='Stop'
$rootName=if($Client -eq 'Spotify'){'Spotify.exe'}else{'spotisloth-desktop.exe'}
$samples=[Collections.Generic.List[object]]::new()
$previousCpu=@{}
$previousAt=$null
$clock=[Diagnostics.Stopwatch]::StartNew()
$nextSampleMs=0.0
$logicalProcessors=[Environment]::ProcessorCount
$elapsedTotal=0.0
$cpuTotal=0.0
function Get-Median([double[]]$Values){
    $ordered=@($Values | Sort-Object)
    if(!$ordered.Count){return $null}
    $middle=[math]::Floor($ordered.Count/2)
    if($ordered.Count%2){return $ordered[$middle]}
    return ($ordered[$middle-1]+$ordered[$middle])/2
}
do{
    $waitMs=$nextSampleMs-$clock.Elapsed.TotalMilliseconds
    if($waitMs -gt 0){Start-Sleep -Milliseconds ([int][math]::Ceiling($waitMs))}
    # Only process relationships and counters are read; no command lines or UI text.
    $processTree=Get-CimInstance Win32_Process -Property Name,ProcessId,ParentProcessId
    $included=[Collections.Generic.HashSet[int]]::new()
    foreach($item in $processTree | Where-Object { $_.Name -eq $rootName }){[void]$included.Add([int]$item.ProcessId)}
    if($included.Count -eq 0){throw "$Client is not running."}
    do{
        $added=$false
        foreach($item in $processTree){if($included.Contains([int]$item.ParentProcessId) -and $included.Add([int]$item.ProcessId)){$added=$true}}
    }while($added)
    $resident=@{}
    foreach($counter in Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess,WorkingSetPrivate){
        if($included.Contains([int]$counter.IDProcess)){$resident[[int]$counter.IDProcess]=[long]$counter.WorkingSetPrivate}
    }
    $now=[DateTimeOffset]::UtcNow
    $privateBytes=0L;$workingSet=0L;$privateWorkingSet=0L;$cpuDelta=0.0
    $currentCpu=@{};$count=0;$residentCount=0
    foreach($processId in $included){
        $process=Get-Process -Id $processId -ErrorAction SilentlyContinue
        if(!$process){continue}
        try{
            $started=$process.StartTime.ToUniversalTime()
            $identity="$processId/$($started.Ticks)"
            $cpu=$process.TotalProcessorTime.TotalSeconds
            $privateBytes+=$process.PrivateMemorySize64;$workingSet+=$process.WorkingSet64;$count++
            if($resident.ContainsKey($processId)){$privateWorkingSet+=$resident[$processId];$residentCount++}
            if($previousCpu.ContainsKey($identity)){$cpuDelta+=[math]::Max(0,$cpu-$previousCpu[$identity])}
            elseif($null -ne $previousAt -and $started -ge $previousAt.UtcDateTime){$cpuDelta+=$cpu}
            $currentCpu[$identity]=$cpu
        }catch{continue}
    }
    $elapsed=if($null -eq $previousAt){0.0}else{($now-$previousAt).TotalSeconds}
    if($elapsed -gt 0){$cpuTotal+=$cpuDelta;$elapsedTotal+=$elapsed}
    $samples.Add([pscustomobject]@{
        atUtc=$now.ToString('o');elapsedSeconds=[math]::Round($clock.Elapsed.TotalSeconds,3)
        processCount=$count;privateResidentCoverage=$residentCount
        privateBytesMiB=[math]::Round($privateBytes/1MB,3)
        privateWorkingSetMiB=if($residentCount -eq $count){[math]::Round($privateWorkingSet/1MB,3)}else{$null}
        workingSetMiB=[math]::Round($workingSet/1MB,3)
        cpuSeconds=[math]::Round($cpuDelta,6);intervalSeconds=[math]::Round($elapsed,6)
        cpuPercent=if($elapsed -le 0){$null}else{[math]::Round(100*$cpuDelta/$elapsed/$logicalProcessors,4)}
    })
    $previousCpu=$currentCpu;$previousAt=$now;$nextSampleMs+=$IntervalMs
}while($clock.Elapsed.TotalSeconds -lt $Seconds)
$cpuValues=@($samples | Where-Object {$null -ne $_.cpuPercent} | ForEach-Object {$_.cpuPercent} | Sort-Object)
$residentValues=@($samples | Where-Object {$null -ne $_.privateWorkingSetMiB} | ForEach-Object {$_.privateWorkingSetMiB})
$result=[pscustomobject]@{
    schemaVersion=2;client=$Client;scenario=$Scenario;sampleCount=$samples.Count
    durationSeconds=[math]::Round($elapsedTotal,3);logicalProcessors=$logicalProcessors
    includesDescendants=$true;cpuDenominator='total machine capacity'
    medianPrivateWorkingSetMiB=Get-Median $residentValues
    medianPrivateBytesMiB=Get-Median @($samples.privateBytesMiB)
    medianWorkingSetMiB=Get-Median @($samples.workingSetMiB)
    averageCpuPercent=if($elapsedTotal -gt 0){[math]::Round(100*$cpuTotal/$elapsedTotal/$logicalProcessors,4)}else{$null}
    p95CpuPercent=$cpuValues[[math]::Min($cpuValues.Count-1,[math]::Ceiling($cpuValues.Count*0.95)-1)]
    totalCpuSeconds=[math]::Round($cpuTotal,6);residentSampleCoverage=$residentValues.Count
    note='Private working set is resident private RAM. Private bytes are committed memory. Total working sets can double-count shared pages.'
    samples=$samples
}
if($OutputPath){$result|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $OutputPath -Encoding utf8}
$result|Select-Object client,scenario,sampleCount,durationSeconds,logicalProcessors,includesDescendants,medianPrivateWorkingSetMiB,medianPrivateBytesMiB,medianWorkingSetMiB,averageCpuPercent,p95CpuPercent,residentSampleCoverage|ConvertTo-Json
