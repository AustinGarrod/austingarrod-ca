param(
    [ValidateSet('Inspect','Configure','Upload','Verify')][string]$Action='Inspect',
    [string]$CredentialPath=$env:REPORTS_CREDENTIAL_PATH
)
$ErrorActionPreference='Stop'
if (!$CredentialPath) { throw 'Pass -CredentialPath for a local DPAPI-protected reporting API token.' }
$secure=(Get-Content -LiteralPath $CredentialPath -Raw).Trim() | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$previousToken=$env:SENTRY_AUTH_TOKEN
try {
    $env:SENTRY_AUTH_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $headers=@{Authorization=('Bearer '+$env:SENTRY_AUTH_TOKEN)}
    $base='https://reports.garrod.house/api/0/'
    switch($Action) {
        Inspect {
            $project=Invoke-RestMethod ($base+'projects/garrod-house/austingarrodca/') -Headers $headers
            $project | Select-Object id,slug,platform,eventThrottleRate,scrubIPAddresses | ConvertTo-Json -Compress
            gh secret list --repo AustinGarrod/austingarrod-ca
            gh auth status
        }
        Configure {
            $env:SENTRY_AUTH_TOKEN | gh secret set REPORTS_AUTH_TOKEN --repo AustinGarrod/austingarrod-ca
            if($LASTEXITCODE -ne 0){throw 'GitHub reporting secret setup failed.'}
            Write-Output 'Existing protected reporting token saved directly to GitHub Actions secret REPORTS_AUTH_TOKEN.'
        }
        Upload {
            npm run reporting:upload
            if($LASTEXITCODE -ne 0){throw 'Source map upload failed.'}
        }
        Verify {
            $issues=Invoke-RestMethod ($base+'organizations/garrod-house/issues/?project=8&query=environment%3Areporting-verification') -Headers $headers
            foreach($issue in $issues){
                $event=Invoke-RestMethod ($base+'issues/'+$issue.id+'/events/latest/') -Headers $headers
                $frames=@($event.entries | Where-Object type -eq exception | ForEach-Object {$_.data.values} | ForEach-Object {$_.stacktrace.frames})
                [pscustomobject]@{issue=$issue.id;event=$event.eventID;title=$issue.title;tags=$event.tags;frames=@($frames | Where-Object {$_.filename -match 'src/|bootstrap.php|contact.php|geocode.php'} | Select-Object filename,lineNo,function,context)} | ConvertTo-Json -Depth 7 -Compress
            }
        }
    }
} finally {
    $env:SENTRY_AUTH_TOKEN=$previousToken
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
