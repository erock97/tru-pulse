param([Parameter(Mandatory=$true)][string]$OutputDirectory,[Parameter(Mandatory=$true)][string]$InventoryFile,[ValidateRange(0,3)][int]$Shard=0,[ValidateRange(1,4)][int]$ShardCount=1)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $root | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root 'leads') | Out-Null
$inventory=Get-Content -Raw $InventoryFile|ConvertFrom-Json
$account=$inventory.account
. "$PSScriptRoot/auth-team.ps1" -Tag $inventory.tag -Account $account
$headers=@{Accept='application/json';'X-Requested-With'='XMLHttpRequest';'X-System'='fub-spa'}
function Read-Fub([string]$url) {
 $uri=[uri]$url
 if($uri.Scheme -ne 'https' -or $uri.Host -ne "$account.followupboss.com" -or !$uri.AbsolutePath.StartsWith('/api/v1/')){throw 'Unexpected pagination origin'}
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
$people=@($inventory.people|Where-Object {([long]$_.id % $ShardCount) -eq $Shard})
if([IO.Path]::GetFullPath($InventoryFile) -ne (Join-Path $root 'inventory.json')){$inventory|ConvertTo-Json -Depth 10|Set-Content (Join-Path $root 'inventory.json')}
Write-Output "Inventory: $($people.Count) leads; collecting historical Change Log."
$done=0;$failed=0
foreach($person in $people){
 $path=Join-Path $root "leads/$($person.id).json"
 if(Test-Path $path){$old=Get-Content -Raw $path|ConvertFrom-Json;if($old.status -eq 'complete' -and $old.account -eq $account -and $old.personId -eq $person.id){$done++;continue}}
 try{
  $events=Read-Pages "https://$account.followupboss.com/api/v1/timeline?personId=$($person.id)&types=ChangeLog&limit=100" 'timeline'
  foreach($event in $events){if($event.personId -ne $person.id -or $event.type -ne 'ChangeLog'){throw 'History ownership/type mismatch'}}
  $stageEvents=@($events|Where-Object {$_.item.name -match '(?i)^stage\b'}|ForEach-Object {@{id=$_.id;date=$_.item.date;description=$_.item.name;createdBy=$_.item.createdBy}})
  @{account=$account;personId=$person.id;status='complete';fetchedAt=[datetime]::UtcNow.ToString('o');totalChangeLogs=$events.Count;stageEvents=$stageEvents}|ConvertTo-Json -Depth 8|Set-Content $path
  $done++
 }catch{ $failed++; @{account=$account;personId=$person.id;status='failed';reason='History request or validation failed'}|ConvertTo-Json|Set-Content $path; Write-Output "History failed for lead $($person.id).";if([int]$_.Exception.Response.StatusCode -in @(401,403)){Write-Output 'Session refused; stopping for renewal.';break} }
 if(($done+$failed)%25 -eq 0){Write-Output "History: $done complete, $failed failed / $($people.Count)"}
}
@{account=$account;shard=$Shard;shardCount=$ShardCount;startedAt=$started;finishedAt=[datetime]::UtcNow.ToString('o');expected=$people.Count;complete=$done;failed=$failed;status=$(if($done -eq $people.Count){'complete'}else{'partial'})}|ConvertTo-Json|Set-Content (Join-Path $root "manifest-$Shard.json")
Write-Output "Finished: $done / $($people.Count); $failed failures."
