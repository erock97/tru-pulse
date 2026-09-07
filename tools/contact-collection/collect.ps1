param([Parameter(Mandatory=$true)][string]$Snapshot,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$inputSnapshot=Get-Content -Raw $Snapshot|ConvertFrom-Json
$org='bfada794-d88a-401c-80db-74b106178c86'
if($inputSnapshot.orgId -ne $org){throw 'This collector is scoped to the verified Costigan pilot'}
$root=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $root|Out-Null
. "$PSScriptRoot/../history-pilot/auth-team.ps1" -Tag COSTIGAN -Account compass627
$headers=@{Accept='application/json';'X-Requested-With'='XMLHttpRequest';'X-System'='fub-spa'}
$manifest=@{orgId=$org;account='compass627';capturedAt=[datetime]::UtcNow.ToString('o');complete=$false;leads=@()}
$manifest|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'manifest.json')
foreach($lead in $inputSnapshot.leads){
 if($lead.orgId -ne $org -or $lead.leadId -notmatch '^\d+$'){throw 'Invalid contact identity'}
 $person=Invoke-RestMethod "https://compass627.followupboss.com/api/v1/people/$($lead.leadId)" -WebSession $fubSession -Headers $headers
 if([string]$person.id -ne $lead.leadId -or [string]$person.assignedUserId -ne $lead.agentId -or [datetime]$person.created -ne [datetime]$lead.createdAt){throw 'Contact ownership or creation changed; review before replacing snapshot'}
 $url="https://compass627.followupboss.com/api/v1/timeline?personId=$($lead.leadId)&limit=100"
 $seen=[Collections.Generic.HashSet[string]]::new();$rows=[Collections.Generic.List[object]]::new();$ids=[Collections.Generic.HashSet[string]]::new()
 while($url){
  $uri=[uri]$url
  if($uri.Scheme -ne 'https' -or $uri.Host -ne 'compass627.followupboss.com' -or $uri.AbsolutePath -ne '/api/v1/timeline' -or !$seen.Add($url) -or $seen.Count -gt 100){throw 'Invalid timeline pagination'}
  $r=Invoke-RestMethod $uri -WebSession $fubSession -Headers $headers
  if($null -eq $r.timeline -or $null -eq $r._metadata.total){throw 'Missing timeline collection or coverage metadata'}
  foreach($row in $r.timeline){if([string]$row.personId -ne $lead.leadId -or !$ids.Add([string]$row.id)){throw 'Foreign or duplicate timeline record'};$rows.Add($row)}
  $url=$r._metadata.nextLink
  if(!$url -and $rows.Count -ne $r._metadata.total){throw 'Incomplete timeline'}
 }
 @{personId=$lead.leadId;complete=$true;timeline=$rows.ToArray()}|ConvertTo-Json -Depth 50|Set-Content (Join-Path $root "$($lead.leadId).json")
 $manifest.leads+=@{id=$lead.leadId;records=$rows.Count}
}
$manifest.capturedAt=[datetime]::UtcNow.ToString('o')
$manifest.complete=$true
$manifest|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'manifest.json')
Write-Output "Collected complete timelines for $($manifest.leads.Count) contacts. No live data written."
