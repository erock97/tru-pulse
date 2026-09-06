param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$raw=& infisical secrets --projectId 8ae8aecb-79a2-4311-8fa3-82c44c2c5662 --env prod --path /FUB-Keys --output json --silent 2>$null
if($LASTEXITCODE -ne 0){throw 'Vault read failed'}
$entries=($raw|Out-String)|ConvertFrom-Json
foreach($tag in @('SIGNATURE','SCOTTMOORE','SATISH','SYNERGY','WOOSLEY','COSTIGAN')){
 $key=($entries|Where-Object secretKey -eq "FUB_KEY_$tag").secretValue
 if(!$key){throw 'Missing key'}
 $headers=@{Authorization=('Basic '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($key.Trim()+':')))}
 function Read-Pages($url,$field){
  $rows=[Collections.Generic.List[object]]::new();$seen=[Collections.Generic.HashSet[string]]::new()
  while($url){
   $uri=[uri]$url
   if($uri.Host -ne 'api.followupboss.com' -or $uri.Scheme -ne 'https' -or !$uri.AbsolutePath.StartsWith('/v1/')){throw 'Wrong pagination origin'}
   if(!$seen.Add($url) -or $seen.Count -gt 1000){throw 'Pagination bound'}
   $r=Invoke-RestMethod $url -Headers $headers -TimeoutSec 30
   if($null -eq $r.$field){throw 'Missing collection'}
   foreach($row in $r.$field){$rows.Add($row)}
   $url=$r._metadata.nextLink
   if(!$url -and $r._metadata.total -gt $rows.Count){throw 'Pagination ended before declared total'}
   Start-Sleep -Milliseconds 150
  }
  return ,$rows.ToArray()
 }
 $identity=Invoke-RestMethod 'https://api.followupboss.com/v1/identity' -Headers $headers
 $users=Read-Pages 'https://api.followupboss.com/v1/users?limit=100' 'users'
 $start=if($tag -eq 'SIGNATURE'){'2024-09-05T00:00:00Z'}else{'2026-01-01T00:00:00Z'}
 $people=Read-Pages "https://api.followupboss.com/v1/people?limit=100&includeTrash=true&createdAfter=$start&fields=id,created,updated,stage,source,assignedUserId,assignedTo" 'people'
 $stages=Read-Pages 'https://api.followupboss.com/v1/stages?limit=100' 'stages'
 $result=@{tag=$tag;account=$identity.account.domain;snapshotAt=[datetime]::UtcNow.ToString('o');users=@($users|Select-Object id,name,role,status,isOwner,isAdmin);userFields=@($users[0].PSObject.Properties.Name);people=$people;stages=@($stages|Select-Object id,name)}
 $dir=[IO.Path]::GetFullPath($OutputDirectory)
 New-Item -ItemType Directory -Force $dir|Out-Null
 $result|ConvertTo-Json -Depth 10|Set-Content (Join-Path $dir "$tag-inventory.json")
 @{tag=$tag;account=$result.account;users=$users.Count;userFields=$result.userFields;statuses=@($users|Group-Object status|Select-Object Name,Count);sources=@($people|Group-Object source|Where-Object Name -match '(?i)zillow|realtor|vip|opcity'|Select-Object Name,Count);people=$people.Count}|ConvertTo-Json -Depth 6 -Compress
}
