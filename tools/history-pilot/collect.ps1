param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $root | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root 'leads') | Out-Null
. "$PSScriptRoot/auth-costigan.ps1"
$headers=@{Accept='application/json';'X-Requested-With'='XMLHttpRequest';'X-System'='fub-spa'}
function Read-Fub([string]$url) {
 $uri=[uri]$url
 if($uri.Scheme -ne 'https' -or $uri.Host -ne 'compass627.followupboss.com' -or !$uri.AbsolutePath.StartsWith('/api/v1/')){throw 'Unexpected pagination origin'}
 for($attempt=0;$attempt -lt 4;$attempt++){
  try{return Invoke-RestMethod -Uri $uri -WebSession $fubSession -Headers $headers -TimeoutSec 30}
  catch { $code=[int]$_.Exception.Response.StatusCode; if($code -notin @(429,500,502,503,504) -or $attempt -eq 3){throw};Start-Sleep -Seconds (2+3*$attempt) }
 }
}
function Read-Pages([string]$url,[string]$collection){
 $items=[Collections.Generic.List[object]]::new();$visited=[Collections.Generic.HashSet[string]]::new();$pages=0
 while($url){if(!$visited.Add($url) -or ++$pages -gt 100){throw 'Pagination loop or bound reached'}
  $r=Read-Fub $url
  if($null -eq $r.$collection){throw "Missing collection $collection"}
  foreach($item in $r.$collection){$items.Add($item)}
  $url=$r._metadata.nextLink
  if(!$url -and $r._metadata.total -gt $items.Count){throw 'Pagination ended before declared total'}
  Start-Sleep -Milliseconds 120
 }
 return ,$items.ToArray()
}
$started=[datetime]::UtcNow.ToString('o')
$people=Read-Pages 'https://compass627.followupboss.com/api/v1/people?limit=100&includeTrash=true&fields=id,created,updated,stage,source,assignedUserId,assignedTo' 'people'
$people=@($people | Where-Object {$_.source -eq 'Zillow Preferred' -and [datetime]$_.created -ge [datetime]'2026-01-01T00:00:00Z'} | Sort-Object id -Unique)
$stages=Read-Pages 'https://compass627.followupboss.com/api/v1/stages?limit=100' 'stages'
$inventory=@{account='compass627';team='Costigan';startedAt=$started;snapshotAt=[datetime]::UtcNow.ToString('o');people=@($people|Select-Object id,created,updated,stage,source,assignedUserId,assignedTo);stages=@($stages|Select-Object id,name)}
$inventory|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'inventory.json')
Write-Output "Inventory: $($people.Count) leads; collecting historical Change Log."
$done=0;$failed=0
foreach($person in $people){
 $path=Join-Path $root "leads/$($person.id).json"
 if(Test-Path $path){$old=Get-Content -Raw $path|ConvertFrom-Json;if($old.status -eq 'complete' -and $old.account -eq 'compass627' -and $old.personId -eq $person.id){$done++;continue}}
 try{
  $events=Read-Pages "https://compass627.followupboss.com/api/v1/timeline?personId=$($person.id)&types=ChangeLog&limit=100" 'timeline'
  foreach($event in $events){if($event.personId -ne $person.id -or $event.type -ne 'ChangeLog'){throw 'History ownership/type mismatch'}}
  $stageEvents=@($events|Where-Object {$_.item.name -match '(?i)^stage\b'}|ForEach-Object {@{id=$_.id;date=$_.item.date;description=$_.item.name;createdBy=$_.item.createdBy}})
  @{account='compass627';personId=$person.id;status='complete';fetchedAt=[datetime]::UtcNow.ToString('o');totalChangeLogs=$events.Count;stageEvents=$stageEvents}|ConvertTo-Json -Depth 8|Set-Content $path
  $done++
 }catch{ $failed++; @{account='compass627';personId=$person.id;status='failed';reason='History request or validation failed'}|ConvertTo-Json|Set-Content $path; Write-Output "History failed for lead $($person.id).";if([int]$_.Exception.Response.StatusCode -in @(401,403)){Write-Output 'Session refused; stopping for renewal.';break} }
 if(($done+$failed)%25 -eq 0){Write-Output "History: $done complete, $failed failed / $($people.Count)"}
}
@{account='compass627';startedAt=$started;finishedAt=[datetime]::UtcNow.ToString('o');expected=$people.Count;complete=$done;failed=$failed;status=$(if($done -eq $people.Count){'complete'}else{'partial'})}|ConvertTo-Json|Set-Content (Join-Path $root 'manifest.json')
Write-Output "Finished: $done / $($people.Count); $failed failures."
