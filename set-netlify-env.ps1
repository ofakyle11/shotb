# Run this AFTER logging into Netlify in browser.
# I cannot set env vars without your Netlify auth token.
# This opens the exact pages you need.

Write-Host "SHOTBREAK NETLIFY ENV SETUP" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Open Netlify dashboard -> your Shotbreak site -> Site configuration -> Environment variables"
Write-Host "2. Add these (Production + Deploy previews scope for each):"
Write-Host ""
Write-Host "   XAI_API_KEY          (from local-backend/.env or my-owner-pws docs)"
Write-Host "   WAVESPEED_API_KEY"
Write-Host "   FIREBASE_API_KEY     = AIzaSyA5-NRXzzkWuGafQ5-EukGF9WMnQ2txFFA"
Write-Host "   OWNER_TOKEN_SECRET   (long random string)"
Write-Host "   OWNER_PW_KYLEF       (from my-owner-pws.txt)"
Write-Host "   OWNER_PW_STEVEC"
Write-Host "   OWNER_PW_SCOTTD"
Write-Host ""
Write-Host "3. Deploys -> Trigger deploy -> Clear cache and deploy site"
Write-Host ""
Write-Host "Git push already done: commit e61752f on main"
Write-Host "Netlify should auto-build from GitHub if connected."
Write-Host ""

$site = "https://app.netlify.com"
Start-Process $site
Write-Host "Opened Netlify dashboard in browser." -ForegroundColor Green