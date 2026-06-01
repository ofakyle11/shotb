// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Shared Token Verification Library
//  Single source of truth for authenticating incoming requests.
// ═══════════════════════════════════════════════════════════════════════════
//
// Supported token types:
//   1. Owner tokens (format: owner:name:expires:hmac)
//      Issued by /netlify/functions/verify-owner using OWNER_TOKEN_SECRET + OWNER_PW_*
//   2. Firebase ID Tokens (standard JWT from Firebase Auth)
//
// Returns a normalized identity object:
//   {
//     uid: string,
//     email?: string,
//     isOwner: boolean,
//     tier?: 'owner' | 'free' | ...,
//     name?: string,           // only for owner tokens
//     source: 'owner_token' | 'firebase'
//   }
//
// Usage in a function:
//   const { verifyToken, getSystemToken, rawTokenFromEvent } = require('./lib/verify-token');
//   const auth = await verifyToken(event);
//   if (!auth.isOwner) { ... }
//
// All sensitive values come exclusively from process.env.

'use strict';

// ── Environment helpers (centralized) ─────────────────────────────────────
const FIREBASE_API_KEY    = () => process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = () => process.env.FIREBASE_PROJECT_ID;

let _systemTokenCache = { token: null, expires: 0 };

async function getSystemToken() {
  const now = Date.now();
  if (_systemTokenCache.token && _systemTokenCache.expires > now + 60_000) {
    return _systemTokenCache.token;
  }
  const email    = process.env.SYSTEM_EMAIL;
  const password = process.env.SYSTEM_PASSWORD;
  if (!email || !password) throw new Error('SYSTEM_EMAIL / SYSTEM_PASSWORD not set');

  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE_API_KEY(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const d = await r.json();
  if (!r.ok || !d.idToken) {
    const errMsg = (d && d.error && d.error.message) || '';
    if (errMsg.includes('admin-restricted') || errMsg.includes('ADMIN_ONLY_OPERATION')) {
      throw new Error(
        'SYSTEM_AUTH_FAIL: Email/Password sign-in is DISABLED in Firebase Console. ' +
        'Go to Authentication → Sign-in method → enable Email/Password. ' +
        'Also confirm SYSTEM_EMAIL and SYSTEM_PASSWORD env vars in Netlify are correct and the user exists in Firebase Auth.'
      );
    }
    throw new Error('SYSTEM_AUTH_FAIL: ' + JSON.stringify(d));
  }

  _systemTokenCache = {
    token:   d.idToken,
    expires: now + (parseInt(d.expiresIn || '3600', 10) * 1000),
  };
  return d.idToken;
}

// ── Token extraction ──────────────────────────────────────────────────────
function rawTokenFromEvent(event) {
  return ((event.headers.authorization || event.headers.Authorization || '')
    .replace(/^Bearer\s+/i, '')).trim();
}

// ── Owner token verification (delegates to verify-owner.js) ──────────────
function verifyOwnerTokenFromRequire(token) {
  // Lazy require to avoid circular issues during bundling
  const { verifyOwnerToken } = require('../verify-owner');
  return verifyOwnerToken(token);
}

// ── Main verification function ────────────────────────────────────────────
async function verifyToken(eventOrRawToken) {
  let tk;
  if (typeof eventOrRawToken === 'string') {
    tk = eventOrRawToken;
  } else {
    tk = rawTokenFromEvent(eventOrRawToken);
  }

  if (!tk) throw new Error('NO_TOKEN');

  // ── Path 1: Custom Owner Token ─────────────────────────────────────────
  if (tk.startsWith('owner:')) {
    const verified = verifyOwnerTokenFromRequire(tk);
    if (!verified) throw new Error('BAD_OWNER_TOKEN');

    return {
      uid: 'owner_' + verified.name,
      name: verified.name,
      isOwner: true,
      tier: 'owner',
      source: 'owner_token',
    };
  }

  // ── Path 2: Firebase ID Token ──────────────────────────────────────────
  const OWNER_EMAIL_SET = new Set(
    (process.env.OWNER_EMAILS || 'kyle@shotbreak.io,scott@shotbreak.io,steve@shotbreak.io')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  );

  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: tk }),
    }
  );
  const d = await r.json();
  if (!r.ok || !d.users || !d.users[0]) throw new Error('BAD_TOKEN');

  const u = d.users[0];
  const email = (u.email || '').toLowerCase().trim();
  const isOwner = OWNER_EMAIL_SET.has(email);

  return {
    uid: u.localId,
    email: u.email,
    isOwner,
    tier: isOwner ? 'owner' : 'free',
    source: 'firebase',
  };
}

// ── Convenience helper ────────────────────────────────────────────────────
function requireOwner(authResult) {
  if (!authResult || !authResult.isOwner) {
    throw new Error('OWNER_REQUIRED');
  }
  return authResult;
}

module.exports = {
  rawTokenFromEvent,
  verifyToken,
  getSystemToken,
  requireOwner,
};