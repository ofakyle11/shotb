# Owner Login (Shotbreak)

**Credentials live only in Netlify environment variables — never in this repo or on the public site.**

## 1. Browser login (easiest)

On the app Sign In screen:

1. Enter your **short** in the email field: `kylef`, `stevec`, `scottd`, `stevek`, or `kyle` / `scott` / `steve`
2. Enter the matching **OWNER_PW_*** value from Netlify env in the password field
3. Sign In — the app calls `/verify-owner` and stores a 4-part HMAC owner token

Supported shorts:

- `kylef` → kylef@shotbreak.io
- `stevec` → stevec@shotbreak.io
- `scottd` → scottd@shotbreak.io
- `stevek` → stevek@shotbreak.io
- `kyle` / `scott` / `steve` → @shotbreak.io originals

## 2. Token helper (scripts / PowerShell)

After setting `OWNER_PW_*` and `OWNER_TOKEN_SECRET` in Netlify and redeploying:

```powershell
.\Shotbreak\get-owner-token.ps1 -Name kyleF
```

Paste the password when prompted (never hardcode it in scripts).

## 3. Firebase fallback

Owners can also use full email + Firebase password if the account exists in Firebase Auth Console.

## Required Netlify env vars

- `OWNER_TOKEN_SECRET`
- `OWNER_PW_KYLEF`, `OWNER_PW_STEVEC`, `OWNER_PW_SCOTTD`, `OWNER_PW_STEVEK`
- `XAI_API_KEY`, `WAVESPEED_API_KEY` (server-side only)
- `FIREBASE_DB_SECRET`, `STRIPE_WEBHOOK_SECRET`

After any env change: **Clear cache and deploy site**.

## Security note

If passwords were ever committed to git, rotate all `OWNER_PW_*` values and `OWNER_TOKEN_SECRET` immediately.