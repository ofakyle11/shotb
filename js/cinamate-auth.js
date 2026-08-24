/* =========================================================================
 * CINAMATE — js/auth.js
 * Client-side access gate. Attaches a single global: window.CinamateAuth.
 *
 * This file is PUBLIC — it is served to anonymous visitors. It therefore holds
 * no credential material of any kind. It once carried SHA-256 digests of the
 * five access codes, but the salt shipped in the same file, so all five names
 * were recoverable in a single pass by anyone who read it. Access control is
 * the server-side gate; the only job left here is remembering who is signed in
 * so pages can label the UI.
 * ========================================================================= */
(function () {
  'use strict';

  const SESSION_KEY = 'cinamate.session';
  function normalize(code) {
    return String(code == null ? '' : code).trim().toUpperCase();
  }

  /* -----------------------------------------------------------------------
   * Public API
   * --------------------------------------------------------------------- */


  // grant(code): store the session record. Caller verifies first;
  // grant does not re-verify.
  function grant(code) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ operator: normalize(code), t: Date.now() })
    );
  }

  // cookieOperator(): owner short for UI labels. The session token itself is
  // HttpOnly (unreadable here by design) — identity comes from the readable
  // cin_who cookie the sign-in service sets beside it, with a fallback to the
  // legacy script-set cin_owner cookie until those age out. The server gate
  // already validated the real token to deliver this page at all.
  function cookieOperator() {
    try {
      const who = /(?:^|;\s*)cin_who=([^;]+)/.exec(document.cookie || '');
      if (who) {
        const name = decodeURIComponent(who[1]).trim();
        if (/^[a-z]{2}\d{3}$/i.test(name)) return name.toUpperCase();
      }
      const m = /(?:^|;\s*)cin_owner=([^;]+)/.exec(document.cookie || '');
      if (!m) return null;
      const parts = decodeURIComponent(m[1]).split(':');
      if (parts.length !== 4 || parts[0] !== 'owner') return null;
      const exp = parseInt(parts[2], 10);
      if (!exp || Date.now() > exp) return null;
      return String(parts[1]).toUpperCase();
    } catch (err) {
      return null;
    }
  }

  // requireSession(): parsed session object, or redirect to the sign-in page
  // and return null when absent/malformed. A valid owner cookie counts as a
  // session and seeds one (e.g. a fresh tab straight to the dashboard).
  function requireSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) throw new Error('no session');
      const session = JSON.parse(raw);
      if (!session || typeof session.operator !== 'string' || session.operator === '') {
        throw new Error('malformed session');
      }
      return session;
    } catch (err) {
      const fromCookie = cookieOperator();
      if (fromCookie) {
        const session = { operator: fromCookie, t: Date.now() };
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e2) { /* no-op */ }
        return session;
      }
      window.location.replace('login.html?to=' +
        encodeURIComponent(window.location.pathname || '/dashboard.html'));
      return null;
    }
  }

  // operator(): session's operator string or null. Pure read, never redirects.
  function operator() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return cookieOperator();
      const session = JSON.parse(raw);
      if (!session || typeof session.operator !== 'string' || session.operator === '') {
        return cookieOperator();
      }
      return session.operator;
    } catch (err) {
      return null;
    }
  }

  // signOut(): clear session, both cookies (the HttpOnly one server-side),
  // and the service worker's page cache, then return to the front page.
  function signOut() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (err) { /* storage unavailable — still redirect */ }
    try {
      document.cookie = 'cin_owner=; Path=/; Max-Age=0; Secure; SameSite=Lax';
      document.cookie = 'cin_who=; Path=/; Max-Age=0; Secure; SameSite=Lax';
    } catch (err) { /* no-op */ }
    try {
      fetch('/.netlify/functions/verify-owner', {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'logout' })
      }).catch(function () { /* offline — cookie dies at expiry */ });
    } catch (err) { /* no-op */ }
    const done = function () { window.location.replace('index.html'); };
    try {
      // Wipe cached gated pages so the next person at this browser starts cold.
      if (window.caches && caches.keys) {
        caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }).then(done, done);
        setTimeout(done, 800); // never hang on a stuck cache API
        return;
      }
    } catch (err) { /* fall through */ }
    done();
  }

  window.CinamateAuth = {
    grant: grant,
    requireSession: requireSession,
    operator: operator,
    signOut: signOut
  };
})();
