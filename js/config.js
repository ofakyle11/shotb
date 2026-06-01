// js/config.js
// ═════════════════════════════════════════════════════════════════════════
// SHOTBREAK — Client Configuration (SINGLE SOURCE OF TRUTH)
// ═════════════════════════════════════════════════════════════════════════
// This file is the ONLY place the Firebase web config and owner metadata
// live for all client pages (app.html, workflow/, editor/).
//
// The apiKey is a PUBLIC Firebase web key by design (sent to every browser).
// Real protection comes from:
//   - Firestore Security Rules (see firestore.rules)
//   - Google Cloud API key restrictions (HTTP referrers + allowed APIs)
//   - Netlify environment variables for all server-side secrets
//   - OWNER_TOKEN_SECRET + short-lived HMAC owner tokens
//
// ROTATION PROCEDURE (when key or owners change):
//   1. Edit ONLY this file.
//   2. Update the matching values in Netlify env if FIREBASE_* server vars change.
//   3. Commit → push → Netlify auto-deploys.
//   4. (Optional) Bump a cache-bust query param on the <script src> tags below.
//   5. Verify the three pages load and auth still works.
//
// NEVER put real PATs, Stripe keys, Anthropic keys, or owner passwords here
// or anywhere else in the client. Those belong exclusively in Netlify env vars.

(function () {
  'use strict';

  const CFG = {
    firebase: {
      apiKey: "AIzaSyA5-NRXzzkWuGafQ5-EukGF9WMnQ2txFFA",
      authDomain: "shotbreak-9f342.firebaseapp.com",
      projectId: "shotbreak-9f342",
      storageBucket: "shotbreak-9f342.firebasestorage.app",
      messagingSenderId: "515766987392",
      appId: "1:515766987392:web:ac3644d952c69d11c7d465"
    },
    owners: {
      emails: [
        'kyle@shotbreak.io',
        'scott@shotbreak.io',
        'steve@shotbreak.io'
      ],
      meta: {
        kyle:  { name: 'Kyle',  color: '#d4a843' },
        scott: { name: 'Scott', color: '#60a5fa' },
        steve: { name: 'Steve', color: '#a78bfa' }
      }
    }
  };

  // Freeze so nothing can mutate the config at runtime
  window.SHOTBREAK_CONFIG = Object.freeze(CFG);

  // Back-compat aliases used by existing inline code and older comments
  window.OWNER_EMAILS = new Set(CFG.owners.emails);
  window.OWNER_META = CFG.owners.meta;

  // Optional: expose a tiny helper
  window.getShotbreakFirebaseConfig = () => CFG.firebase;
})();