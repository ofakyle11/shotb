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

  // Temporary bypass for owner-only deploys / investor round while the
  // system user Identity Toolkit call is broken (common with restricted API keys).
  // Set SYSTEM_TOKEN_BYPASS=true in Netlify env to enable.
  if (process.env.SYSTEM_TOKEN_BYPASS === 'true' || process.env.SYSTEM_TOKEN_BYPASS === '1') {
    console.warn('[verify-token] SYSTEM_TOKEN_BYPASS active — using dummy system token. Only safe for owner testing.');
    return 'bypass_system_token_for_owners';
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
    const errObj = d && d.error ? d.error : {};
    const errMsg = errObj.message || '';
    const status = r.status;

    if (errMsg.includes('admin-restricted') || errMsg.includes('ADMIN_ONLY_OPERATION')) {
      throw new Error(
        `SYSTEM_AUTH_FAIL (status ${status}): The FIREBASE_API_KEY in Netlify env is likely restricted and does not allow Identity Toolkit calls (accounts:signInWithPassword).\n\n` +
        `Most common fix:\n` +
        `1. In Google Cloud Console for shotbreak-9f342 → APIs & Services → Credentials\n` +
        `2. Find the key used in your Netlify FIREBASE_API_KEY var\n` +
        `3. Edit it → API restrictions → make sure "Identity Toolkit API" is allowed (or set to "Don't restrict")\n` +
        `4. Also check Application restrictions (it should allow the Netlify function IPs or be unrestricted for server use)\n\n` +
        `Alternative (recommended for simplicity): Set FIREBASE_API_KEY in Netlify to the exact same public web key from js/config.js (AIzaSyA5-NRXzzkWuGafQ5-EukGF9WMnQ2txFFA). It already works for the browser.\n\n` +
        `Temporary workaround: Set SYSTEM_TOKEN_BYPASS=true in Netlify env to allow owners to use the system while you fix the key.`
      );
    }
    throw new Error(`SYSTEM_AUTH_FAIL (status ${status}): ` + JSON.stringify(d));
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