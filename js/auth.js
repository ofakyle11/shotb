// js/auth.js
// ═══════════════════════════════════════════════════════════════════════════
// CINAMATE — Client Auth / Token Helpers (Single Source of Truth)
// ═══════════════════════════════════════════════════════════════════════════
//
// This file centralizes all client-side token and auth helpers.
//
// Usage:
//   <script src="js/auth.js"></script>
//   const token = await window.getToken();
//   const headers = await window.hdrs();
//
// Supports both:
//   - Firebase Auth idTokens (all users; owners get isOwner if email matches authorized list)
//   - Owner tokens from /verify-owner (HMAC, name+pw from env) for convenience in shells
//
// Only the two authorized owners (mz465 / kz465) get special privileges. Client bypasses removed.

(function () {
  'use strict';

  const OWNER_TOKEN_KEY = 'SB_OWNER_TOKEN';
  const OWNER_NAME_KEY  = 'SB_OWNER_NAME';
  const OWNER_EXPIRES_KEY = 'SB_OWNER_EXPIRES';

  // ── Owner session: cookie only, never localStorage ──────────────────────
  //
  // This used to rehydrate a signed 12-hour owner token out of localStorage
  // into window.SB_OWNER_TOKEN. That handed a replayable owner credential to
  // page scripts, which meant any single injected script anywhere in the
  // gated app could read it and act as that owner from anywhere — the exact
  // outcome the HttpOnly session cookie exists to prevent. /verify-owner no
  // longer returns the token at all; the session lives in the HttpOnly
  // cin_owner cookie, and same-origin requests carry it automatically.
  //
  // So there is nothing to rehydrate. What is left is a purge: any browser
  // that signed in before this change still has a valid token sitting in
  // localStorage, and it stays exploitable until it is removed.
  function rehydrateOwnerToken() {
    clearOwnerToken();
  }

  // The owner short is a display label, not a credential — the server sets it
  // as the readable cin_who cookie beside the HttpOnly session.
  function cookieOwnerName() {
    try {
      const m = /(?:^|;\s*)cin_who=([^;]+)/.exec(document.cookie || '');
      if (!m) return null;
      const n = decodeURIComponent(m[1]).trim().toLowerCase();
      return /^[a-z]{2}\d{3}$/.test(n) ? n : null;
    } catch (e) { return null; }
  }

  function clearOwnerToken() {
    try {
      localStorage.removeItem(OWNER_TOKEN_KEY);
      localStorage.removeItem(OWNER_NAME_KEY);
      localStorage.removeItem(OWNER_EXPIRES_KEY);
    } catch (e) {}
    window.SB_OWNER_TOKEN = null;
    window.SB_OWNER_NAME = null;
    window.SB_OWNER_EXPIRES = null;
  }

  // Call rehydration immediately when the script loads
  rehydrateOwnerToken();

  // Kept so older call sites do not throw. There is no client-held owner
  // token left to extend, and stretching a session to 30 days from the client
  // was never something the client got to decide — the server sets the
  // cookie's lifetime and re-issues it at sign-in.
  function touchOwnerToken() { /* no client-side session extension */ }

  // ── Core getToken helper ───────────────────────────────────────────────
  async function getToken() {
    // The owner session is a cookie. Same-origin fetches send it on their own,
    // so owner-authenticated calls need no Authorization header at all — use
    // fetch(..., { credentials: 'same-origin' }). Only Firebase, which is a
    // separate identity system with its own short-lived tokens, returns one.
    if (typeof firebase !== 'undefined' &&
        firebase.auth &&
        firebase.auth().currentUser) {
      try {
        return await firebase.auth().currentUser.getIdToken();
      } catch (e) {
        console.warn('[SB Auth] Failed to get Firebase ID token:', e);
        return null;
      }
    }

    return null;
  }

  // ── Convenience headers helper ──────────────────────────────────────────
  // Owner calls authenticate by cookie, so a missing Firebase token is not an
  // error any more — it is the normal case for an owner. Returning plain
  // headers lets those calls proceed; the server decides, as it always did.
  async function hdrs() {
    const h = { 'Content-Type': 'application/json' };
    const t = await getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  // ── Logout (clears both Firebase and owner token state) ─────────────────
  async function logout() {
    try {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        await firebase.auth().signOut();
      }
    } catch (e) {
      console.warn('[SB Auth] Firebase signOut error:', e);
    }

    clearOwnerToken();

    // Optional: allow other parts of the app to react
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('sb:logout'));
    }
  }

  // ── Expose on window (for backward compatibility) ───────────────────────
  window.getToken = getToken;
  window.hdrs = hdrs;
  window.sbLogout = logout;           // New recommended name
  window.clearOwnerToken = clearOwnerToken;
  window.touchOwnerToken = touchOwnerToken; // retained no-op for old call sites
  window.cinOwnerName = cookieOwnerName;    // display label, not a credential

  // Also expose the raw storage keys in case someone needs them
  window.SB_AUTH_KEYS = {
    OWNER_TOKEN: OWNER_TOKEN_KEY,
    OWNER_NAME: OWNER_NAME_KEY,
    OWNER_EXPIRES: OWNER_EXPIRES_KEY
  };

  console.log('[SB Auth] Client auth helpers loaded (js/auth.js)');
})();