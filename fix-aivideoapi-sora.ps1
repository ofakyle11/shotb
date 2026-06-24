# Store aivideoapi.ai Sora 2 API key on production (Firebase server_secrets).
# Get your key at: https://aivideoapi.ai/api-keys
# Usage:
#   $env:AIVIDEOAPI_API_KEY = 'sk-...'
#   .\fix-aivideoapi-sora.ps1
# Or:
#   .\fix-aivideoapi-sora.ps1 -ApiKey 'sk-...' -OwnerPassword '...'

param(
  [string]$ApiKey,
  [string]$OwnerName = 'kyleF',
  [string]$OwnerPassword
)

$ErrorActionPreference = 'Stop'
$Base = 'https://shotbreak.io/.netlify/functions'

if (-not $ApiKey) { $ApiKey = $env:AIVIDEOAPI_API_KEY }
if (-not $ApiKey) { $ApiKey = $env:OPENAI_API_KEY }
if (-not $ApiKey -or -not $ApiKey.Trim().StartsWith('sk-')) {
  Write-Host 'Set AIVIDEOAPI_API_KEY env var or pass -ApiKey sk-... (from https://aivideoapi.ai/api-keys)' -ForegroundColor Red
  exit 1
}

if (-not $OwnerPassword) {
  $secure = Read-Host 'Owner password (OWNER_PW_KYLEF)' -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $OwnerPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host 'Getting owner token...' -ForegroundColor Cyan
$ownerBody = @{ name = $OwnerName; password = $OwnerPassword } | ConvertTo-Json
$owner = Invoke-RestMethod -Uri "$Base/verify-owner" -Method Post -Body $ownerBody -ContentType 'application/json'
if (-not $owner.token) { throw 'verify-owner failed' }

$headers = @{
  Authorization = 'Bearer ' + $owner.token
  'Content-Type' = 'application/json'
}

Write-Host 'Storing aivideoapi key (Firebase server_secrets)...' -ForegroundColor Cyan
$setBody = @{ action = 'set_aivideoapi_key'; api_key = $ApiKey.Trim() } | ConvertTo-Json
$set = Invoke-RestMethod -Uri "$Base/generate-video" -Method Post -Headers $headers -Body $setBody

Write-Host 'Verifying providers...' -ForegroundColor Cyan
$provBody = @{ action = 'providers' } | ConvertTo-Json
$prov = Invoke-RestMethod -Uri "$Base/generate-video" -Method Post -Headers $headers -Body $provBody

$prov | ConvertTo-Json -Depth 4
if ($prov.aivideoapi -and $prov.sora_provider -eq 'aivideoapi') {
  Write-Host "`nDone — Sora 2 will route via aivideoapi.ai. Top up credits at https://aivideoapi.ai/dashboard/billing if needed." -ForegroundColor Green
} else {
  Write-Host "`nKey still not visible to functions. Check FIREBASE_DB_SECRET on Netlify." -ForegroundColor Yellow
  exit 2
}