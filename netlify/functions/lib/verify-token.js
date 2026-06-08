// Proper token verifier for Shotbreak.
// Supports:
// - Firebase ID tokens (for all users). isOwner=true only if email matches an owner email.
// - 'owner:...' HMAC tokens from /verify-owner endpoint (for owners using name+pw from env).
//
// The OWNER_NAME_TO_EMAIL map lets short names (kyleF/steveC/scottD) resolve to the actual (different) owner emails.
// NO demo allows, NO permissive "any token is owner", NO client bypass tokens.
// Only authorized owners get isOwner via real login or proper token.
//
// ENV: FIREBASE_API_KEY (for lookup), OWNER_TOKEN_SECRET + OWNER_PW_* (for owner tokens)
// Current active owner identifiers for the 3 owners of Shotbreak (plain company @shotbreak emails not all set up yet):
// Shorts for /verify-owner: kyleF, steveC, scottD, steveK (POST {name: "kyleF", password: "..."} or lower)
// Use Shotbreak/get-owner-token.ps1 helper (after setting the OWNER_PW_* envs + redeploy) to easily obtain tokens.
const OWNER_EMAILS = [
  'kyle@shotbreak.io',
  'scott@shotbreak.io',
  'steve@shotbreak.io',
  'kylef@shotbreak.io',
  'stevec@shotbreak.io',
  'scottd@shotbreak.io',
  'stevek@shotbreak.io'
];

// Map from verify-owner short name (lowercased) to the full email identity used for isOwner check + user object.
// This lets the temp shorts (kylef etc) resolve to whatever the real/different owner emails are (change the values when company or personal emails are set up in Firebase).
const OWNER_NAME_TO_EMAIL = {
  'kyle': 'kyle@shotbreak.io',
  'scott': 'scott@shotbreak.io',
  'steve': 'steve@shotbreak.io',
  // Current for the 3 owners (kyleF/steveC/scottD/steveK style)
  'kylef': 'kylef@shotbreak.io',
  'stevec': 'stevec@shotbreak.io',
  'scottd': 'scottd@shotbreak.io',
  'stevek': 'stevek@shotbreak.io'
};

exports.verify = async function (authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[verify-token] No Bearer token');
    return { ok: false, isOwner: false, user: null };
  }
  const token = authHeader.replace('Bearer ', '').trim();

  // 1. Owner HMAC token (from verify-owner endpoint, using env OWNER_PW_*)
  if (token.startsWith('owner:')) {
    try {
      const { verifyOwnerToken } = require('../verify-owner');
      const verified = verifyOwnerToken(token);
      if (verified) {
        const mappedEmail = OWNER_NAME_TO_EMAIL[verified.name] || (verified.name + '@shotbreak.io');
        if (OWNER_EMAILS.includes(mappedEmail)) {
          return {
            ok: true,
            isOwner: true,
            user: { uid: 'owner_' + verified.name, email: mappedEmail, name: verified.name, token }
          };
        }
      }
    } catch (e) {
      console.warn('[verify-token] owner token verify error', e.message);
    }
    return { ok: false, isOwner: false, user: null };
  }

  // 2. Firebase ID token - verify via Identity Toolkit lookup, then check email for owners
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    console.error('[verify-token] FIREBASE_API_KEY not set');
    return { ok: false, isOwner: false, user: null };
  }

  try {
    const r = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token })
      }
    );
    const d = await r.json();
    if (!r.ok || !d.users || !d.users[0]) {
      console.warn('[verify-token] Firebase lookup failed');
      return { ok: false, isOwner: false, user: null };
    }
    const u = d.users[0];
    const email = (u.email || '').toLowerCase().trim();
    const isOwner = OWNER_EMAILS.includes(email);
    return {
      ok: true,
      isOwner,
      user: {
        uid: u.localId,
        email: u.email,
        name: u.displayName || email.split('@')[0],
        token
      }
    };
  } catch (e) {
    console.error('[verify-token] Firebase verify error', e.message);
    return { ok: false, isOwner: false, user: null };
  }
};

exports.verifyToken = exports.verify; // compat for older callers expecting verifyToken name

const { getAuthHeader } = require('./http');

exports.requireAuth = async function requireAuth(eventOrHeader) {
  const header = typeof eventOrHeader === 'string'
    ? eventOrHeader
    : getAuthHeader(eventOrHeader);
  const result = await exports.verify(header);
  if (!result.ok) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  return {
    ok: true,
    isOwner: !!result.isOwner,
    uid: result.user && result.user.uid,
    user: result.user,
  };
};
