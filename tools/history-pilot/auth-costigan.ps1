$ErrorActionPreference='Stop'
$raw=& infisical secrets --projectId 8ae8aecb-79a2-4311-8fa3-82c44c2c5662 --env prod --path /fub-logins --output json --silent 2>$null
if($LASTEXITCODE -ne 0){throw 'Infisical read failed'}
$secrets=($raw|Out-String)|ConvertFrom-Json
$username=($secrets|Where-Object secretKey -eq 'FUB_USER_COSTIGAN').secretValue
$password=($secrets|Where-Object secretKey -eq 'FUB_PASS_COSTIGAN').secretValue
if(!$username -or !$password){throw 'Required login values unavailable'}
$page=Invoke-WebRequest -Uri 'https://login.followupboss.com/login?subdomain=compass627' -SessionVariable fubSession
$csrf=[regex]::Match($page.Content,'fubcsrf_[a-zA-Z0-9]+').Value
$body=@{email=$username;password=$password;subdomain='compass627';start_url='';remember='0';csrf_token=$csrf}
$login=Invoke-WebRequest -Uri 'https://login.followupboss.com/login/index' -Method Post -Body $body -WebSession $fubSession
