# .SYNOPSIS
#   Get a fresh 4-part owner HMAC token for kyleF / steveC / scottD / steveK (or the original kyle/scott/steve).
#   Run this after you have set the OWNER_PW_* values in Netlify env and done a clear-cache deploy.
#
#   NOTE: For the browser UI (the app login screen), you can now type the short (kylef etc) + this same OWNER_PW_* value directly into the password field and Sign In.
#   The form calls /verify-owner for owners and logs you in with full privileges (no need to run this ps1 + paste token unless you want a token for curl/scripts or manual localStorage).
#
# .USAGE
#   From the Shotbreak folder:
#     .\get-owner-token.ps1
#
#   Or from the parent folder C:\Users\kylefrancis :
#     .\Shotbreak\get-owner-token.ps1
#
#   Then choose the short name when prompted, paste the password when asked (it will be hidden).
#
#   The script will:
#   - Call https://shotbreak.io/.netlify/functions/verify-owner
#   - Print the token
#   - Copy the token to your clipboard (if possible)
#   - Show example curl and PowerShell usage for agent calls
#
#   You can also run with parameters (no prompts):
#   .\get-owner-token.ps1 -Name kyleF -Password "the-long-pw-here"
#   Or from parent: .\Shotbreak\get-owner-token.ps1 -Name kyleF -Password "..."
#
#   NEVER hardcode the password in this file or anywhere else.
#
# CURRENT MAPPING (as of this script):
#   kyleF  -> kylef@shotbreak.io   (in OWNER_NAME_TO_EMAIL + lists)
#   steveC -> stevec@shotbreak.io
#   scottD -> scottd@shotbreak.io
#   steveK -> stevek@shotbreak.io
#   (plus the three plain originals)
#
# If your actual owner emails are on different domains (as discussed), give me the three full addresses (e.g. kyle@yourdomain.com) and I will update the map in the two verify-token.js + all OWNER_EMAILS arrays so both token-based and Firebase UI logins use the real addresses.
#

<#
To run from your current prompt (PS C:\Users\kylefrancis>):
  .\Shotbreak\get-owner-token.ps1

With params:
  .\Shotbreak\get-owner-token.ps1 -Name kyleF -Password "YOUR_OWNER_PW_KYLEF_VALUE"
#>

param(
    [string]$Name,
    [string]$Password,
    [switch]$NoClipboard
)

$ErrorActionPreference = 'Stop'

$ProdUrl = "https://shotbreak.io/.netlify/functions/verify-owner"

function Get-ShortName {
    $valid = @('kyleF','steveC','scottD','steveK','kyle','scott','steve')
    while ($true) {
        $choice = Read-Host "Enter owner short name (kyleF / steveC / scottD / steveK / kyle / scott / steve) [default: kyleF]"
        if (-not $choice) { $choice = 'kyleF' }
        $choice = $choice.Trim()
        if ($valid -contains $choice) { return $choice }
        Write-Host "Invalid. Choose one of: $($valid -join ', ')" -ForegroundColor Yellow
    }
}

function Get-PasswordSecure {
    param([string]$Prompt = "Paste the OWNER_PW_ value for this owner (input will be hidden)")
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (-not $Name) {
    $Name = Get-ShortName
} else {
    $Name = $Name.Trim()
}

if (-not $Password) {
    $Password = Get-PasswordSecure
}

$body = @{
    name = $Name
    password = $Password
} | ConvertTo-Json -Depth 3

Write-Host "Requesting token for '$Name' from $ProdUrl ..." -ForegroundColor Cyan

$response = $null
try {
    $response = Invoke-RestMethod -Uri $ProdUrl -Method Post -Body $body -ContentType 'application/json' -ErrorAction Stop
} catch {
    Write-Host "`n❌ Error calling verify-owner:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message
    }
    Write-Host "`nCommon causes:"
    Write-Host " - You did not put the OWNER_PW_... password into Netlify yet (or forgot SCOTTD)"
    Write-Host " - You did not click 'Clear cache and deploy site' after adding the password"
    Write-Host " - Wrong short name (use kyleF or steveK etc)"
    Write-Host ""
    Write-Host "Open the file NETLIFY_ALL_FIXED_STEPS.txt (double click it) and follow the 5 super simple steps."
    Write-Host "Tip: You can re-run this script any time you want a fresh token. Tokens last about 12 hours."
    return
}

if ($response -and $response.token) {
    $token = $response.token
    Write-Host "`n✅ Success! Token received." -ForegroundColor Green
    Write-Host "Name: $($response.name)" -ForegroundColor Gray

    Write-Host "`n=== FULL TOKEN (copy this) ===" -ForegroundColor Yellow
    Write-Host $token -ForegroundColor White

    if ($response.expires) {
        # Compatible with older Windows PowerShell 5.1
        try {
            $unixEpoch = New-Object DateTime 1970,1,1,0,0,0, [System.DateTimeKind]::Utc
            $exp = $unixEpoch.AddMilliseconds($response.expires).ToLocalTime()
            Write-Host "Expires: $exp (local)" -ForegroundColor Gray
        } catch {
            Write-Host "Expires: (unavailable in this PowerShell version)" -ForegroundColor Gray
        }
    }

    if (-not $NoClipboard) {
        try {
            Set-Clipboard -Value $token
            Write-Host "`n(Token copied to clipboard)" -ForegroundColor Green
        } catch {
            Write-Host "(Could not copy to clipboard automatically: $($_.Exception.Message))" -ForegroundColor DarkYellow
        }
    }

    Write-Host "`n=== HOW TO USE THE TOKEN ===" -ForegroundColor Cyan

    Write-Host "1. In PowerShell for direct function calls:"
    $exampleBody = @{ agent_id = "auteur_plan"; input = @{ script = "A short test script about a hero finding a lost key in an old house." } } | ConvertTo-Json -Compress
    Write-Host @"
`$headers = @{ Authorization = "Bearer $token" }
`$body = '$exampleBody'
Invoke-RestMethod -Uri "https://shotbreak.io/.netlify/functions/agent-invoke" -Method Post -Headers `$headers -Body `$body -ContentType 'application/json'
"@
    Write-Host "   (Note: if you get 502 error, do the Clear cache and deploy site step in the NETLIFY_ALL_FIXED_STEPS.txt file. That makes the agent code live.)"

    Write-Host "`n2. For browser testing (in console on the app page):"
    Write-Host "   localStorage.setItem('SB_OWNER_TOKEN', '$token'); location.reload();"

    Write-Host "`n3. cURL example:"
    Write-Host "   curl -X POST https://shotbreak.io/.netlify/functions/agent-orchestrate \"
    Write-Host "        -H \"Authorization: Bearer $token\" \"
    Write-Host "        -H \"Content-Type: application/json\" \"
    Write-Host "        -d '{\"chain\":\"full_production\",\"input\":{...}}'"

    Write-Host "`nThe token gives full owner privileges (isOwner=true, unlimited) for the mapped email of this short."
    Write-Host "If you are using different real emails for the Firebase accounts, tell me the three emails and I will update the OWNER_NAME_TO_EMAIL map + lists so both token and Firebase login paths work with the real addresses."

} else {
    Write-Host "Response did not contain a token:" -ForegroundColor Red
    if ($response) {
        $response | ConvertTo-Json -Depth 5 | Write-Host
    }
}

Write-Host "`nTip: You can re-run this script any time the token is about to expire or you want a fresh one."
Write-Host "     The token is valid for 12 hours by default."
