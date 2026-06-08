# SHOTBREAK Secure Config Deployment Instructions

This folder contains the hardened v91 state after the client config centralization pass (April 2026).

## Current State (Safe "Commit 1" version)

- `js/config.js` — new single source of truth (Firebase web config + owner emails/meta)
- `app.html`, `workflow/index.html`, `editor/index.html` — updated to load the central config
- Old literal config blocks are **still present** in the three HTML files (additive / zero-risk first deploy)
- `SECURITY.md` — new root security & rotation guide
- `docs/INTEGRATION_GUIDE.md` — lightly updated

**This is the recommended version to deploy first.**

## Recommended Rollout (Two Commits)

### Commit 1 (Deploy this first — zero risk)
1. Copy these files into your real Git repo working tree:
   - `js/config.js` (new)
   - The three patched `.html` files
   - `SECURITY.md` (new)
   - Updated `docs/INTEGRATION_GUIDE.md`
2. Commit with a message like:
   > "Security: centralize client Firebase config in js/config.js (safe additive deploy)"
3. Push → Netlify deploys.
4. Hard-refresh the three pages and verify everything still works (login, owner accounts, basic flows).
5. Optionally ask 1-2 other people to test.

### Commit 2 (Cleanup — only after Commit 1 is verified live)
Remove the old duplicated Firebase + OWNER blocks from the three HTML files so the config lives in exactly one place.

(You can ask me to generate the fully-clean "Commit 2" versions of the three HTML files right now if you want them prepared in advance.)

## Quick Verification After Deploy

Run these checks on the live site:

- View source on app.html / workflow / editor — you should see `<script src="js/config.js">`
- The old long `firebase.initializeApp({ apiKey: "AIzaSyA5-..." ... })` literal should eventually disappear after Commit 2
- Login still works
- Owner accounts (current kyleF/steveC/scottD shorts + originals) still get the special UI/behavior (via real Firebase login or proper /verify-owner tokens only). Use Shotbreak/get-owner-token.ps1 after setting the OWNER_PW_* envs.
- No console errors about missing `SHOTBREAK_CONFIG` or Firebase init

## Rollback (if anything feels off)

**Fastest rollback:**
In the GitHub web editor, simply delete the line `<script src="js/config.js">` from the three HTML files and commit. The previous commit still contains the full old literals, so the site reverts instantly.

## Other Recommended Actions (Non-Code)

1. **Revoke any old PATs** immediately if there is any chance they were ever in this repo.
2. In GitHub repo settings → Security: turn on **Secret scanning + Push protection**.
3. In Google Cloud Console for project `shotbreak-9f342`: restrict the Firebase web API key to your domains only.
4. Review the live Netlify environment variables (they are the real secrets now).

## Historical Note

Dozens of older `SHOTBREAK-vXX-*` folders in your Downloads still contain the old duplicated config. Those are archival only. Do not use them as the base for future work. Start new patches from a clean checkout of the repo after these changes land.

---

## Agent Stack + Grok/xAI Support (v91 follow-up)

The agent execution layer (agent-invoke + agent-orchestrate) now routes exclusively through `netlify/functions/lib/llm.js`.

**Important for your setup (no Anthropic key):**
- This snapshot is configured in **MAX POWER MODE** on Grok.
- Every agent (including all specialists) uses the full `grok-3` model.
- Higher token budgets for richer, higher-quality structured output.

**Required Netlify environment variables right now:**
- `GROK_API_KEY` or `XAI_API_KEY` → your xAI key (this is what powers everything)

You do **not** need to set `LLM_PROVIDER` — it will auto-use Grok + max power.

Client auth is fully unified on `js/auth.js` + `js/config.js`.

Generated during the "All of them" unification pass (agent stack + client).