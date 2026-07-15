/* Shotbreak — client-side reference image hosting (Firebase Storage).
   Character refs, location plates, and prev-clip end frames must be real
   HTTPS URLs before video providers can consume them; data: URLs are either
   dropped by the resolver or bloat submit payloads. Uses the compat SDK
   already loaded for auth (add firebase-storage-compat.js to the page). */
(function () {
  'use strict';

  function ready() {
    return !!(window.firebase && firebase.apps && firebase.apps.length && typeof firebase.storage === 'function');
  }

  function currentUid() {
    try { return firebase.auth().currentUser ? firebase.auth().currentUser.uid : null; } catch (e) { return null; }
  }

  function isDataUrl(u) { return typeof u === 'string' && u.slice(0, 5) === 'data:'; }
  function isHostedUrl(u) { return typeof u === 'string' && u.trim().indexOf('https://') === 0; }

  function extFromType(type) {
    var t = String(type || '').toLowerCase();
    if (t.indexOf('png') >= 0) return 'png';
    if (t.indexOf('webp') >= 0) return 'webp';
    if (t.indexOf('gif') >= 0) return 'gif';
    return 'jpg';
  }

  async function toBlob(src) {
    if (src instanceof Blob) return src;
    if (!isDataUrl(src)) throw new Error('Expected a data: URL or Blob');
    var res = await fetch(src);
    return res.blob();
  }

  function friendlyError(e) {
    var code = String((e && e.code) || '');
    if (code === 'storage/unauthorized') return new Error('Upload rejected — check Firebase Storage rules allow signed-in writes');
    if (code === 'storage/unknown' || code === 'storage/project-not-found' || code === 'storage/bucket-not-found') {
      return new Error('Firebase Storage is not enabled for this project — enable it in the Firebase console');
    }
    if (code === 'storage/retry-limit-exceeded') return new Error('Upload timed out — check your connection and retry');
    return e instanceof Error ? e : new Error(String((e && e.message) || e || 'Upload failed'));
  }

  /* Upload a data: URL (or Blob) under users/{uid}/<path>-<ts>.<ext> and
     return a permanent https download URL (token URLs are provider-fetchable). */
  async function uploadDataUrl(src, path) {
    if (!ready()) throw new Error('Image hosting unavailable — Firebase Storage SDK not loaded');
    var uid = currentUid();
    if (!uid) throw new Error('Sign in to upload reference images');
    var blob = await toBlob(src);
    if (blob.size > 10 * 1024 * 1024) throw new Error('Image too large (max 10MB)');
    var safePath = String(path || 'refs/ref').replace(/[^a-zA-Z0-9/_.-]/g, '_').replace(/\.+\//g, '/');
    var full = 'users/' + uid + '/' + safePath + '-' + Date.now() + '.' + extFromType(blob.type);
    try {
      var snap = await firebase.storage().ref().child(full).put(blob, {
        contentType: blob.type || 'image/jpeg',
        cacheControl: 'public,max-age=31536000'
      });
      return await snap.ref.getDownloadURL();
    } catch (e) {
      throw friendlyError(e);
    }
  }

  /* Count refs saved as data: URLs (legacy demo-echo uploads) that never
     reach providers — used to warn users to re-upload. */
  function countStaleRefs(state) {
    var n = 0;
    var chars = (state && state.characters) || {};
    Object.keys(chars).forEach(function (k) { if (isDataUrl(chars[k] && chars[k].refUrl)) n++; });
    ((state && state.locationBible) || []).forEach(function (l) { if (isDataUrl(l && l.plateUrl)) n++; });
    return n;
  }

  window.SBStorage = {
    ready: ready,
    uploadDataUrl: uploadDataUrl,
    isDataUrl: isDataUrl,
    isHostedUrl: isHostedUrl,
    countStaleRefs: countStaleRefs
  };
})();
