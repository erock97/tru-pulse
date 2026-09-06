param([Parameter(Mandatory=$true)][string]$Tag,[Parameter(Mandatory=$true)][string]$Account)
$ErrorActionPreference='Stop'
$known=@{COSTIGAN='compass627';SIGNATURE='signaturerealtynj28';SCOTTMOORE='themooregroupe';SATISH='sbrealty';SYNERGY='elnewhome';WOOSLEY='woosleygroup'}
if($known[$Tag] -ne $Account){throw 'Team identity does not match verified account'}
$raw=& infisical secrets --projectId 8ae8aecb-79a2-4311-8fa3-82c44c2c5662 --env prod --path /fub-logins --output json --silent 2>$null
if($LASTEXITCODE -ne 0){throw 'Infisical read failed'}
$secrets=($raw|Out-String)|ConvertFrom-Json
$username=($secrets|Where-Object secretKey -eq "FUB_USER_$Tag").secretValue
$password=($secrets|Where-Object secretKey -eq "FUB_PASS_$Tag").secretValue
if(!$username -or !$password){throw 'Required login values unavailable'}
$page=Invoke-WebRequest -Uri "https://login.followupboss.com/login?subdomain=$Account" -SessionVariable fubSession
$csrf=[regex]::Match($page.Content,'fubcsrf_[a-zA-Z0-9]+').Value
if(!$csrf){throw 'Login token missing'}
$body=@{email=$username;password=$password;subdomain=$Account;start_url='';remember='0';csrf_token=$csrf}
$login=Invoke-WebRequest -Uri 'https://login.followupboss.com/login/index' -Method Post -Body $body -WebSession $fubSession
