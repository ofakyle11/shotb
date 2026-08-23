/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Screening Room engine (CScreen)
   Review-and-approval the way post houses run it: timecoded notes against
   a cut, threaded by session, each note open or addressed. The clever bit
   is what we DON'T do — no video hosting. Every owner plays the same
   exported cut file locally; only the notes (tiny) travel, riding the
   studio cloud with the rest of the production. Notes convert straight
   into Editor markers. Pure logic, no DOM.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function uid() { return 's' + Math.random().toString(36).slice(2, 9); }

  function blank() { return { v: 1, sessions: [], active: null }; }

  function newSession(store, title, author, when) {
    var s = { id: uid(), title: title || 'Cut review', createdBy: author || '',
              createdAt: when || '', fps: 24, notes: [] };
    store.sessions.push(s);
    store.active = s.id;
    return s;
  }
  function session(store, id) {
    return store.sessions.filter(function (s) { return s.id === (id || store.active); })[0] || null;
  }
  function removeSession(store, id) {
    var n = store.sessions.length;
    store.sessions = store.sessions.filter(function (s) { return s.id !== id; });
    if (store.active === id) store.active = store.sessions.length ? store.sessions[0].id : null;
    return n !== store.sessions.length;
  }

  function addNote(sess, sec, text, author, when) {
    var note = { id: uid(), sec: Math.max(0, Math.round((+sec || 0) * 10) / 10),
                 text: String(text || '').slice(0, 500), author: author || '',
                 at: when || '', status: 'open' };
    sess.notes.push(note);
    sortNotes(sess);
    return note;
  }
  function setStatus(sess, id, status) {
    var n = sess.notes.filter(function (x) { return x.id === id; })[0];
    if (!n || ['open', 'done'].indexOf(status) < 0) return null;
    n.status = status;
    return n;
  }
  function removeNote(sess, id) {
    var n = sess.notes.length;
    sess.notes = sess.notes.filter(function (x) { return x.id !== id; });
    return n !== sess.notes.length;
  }
  function sortNotes(sess) {
    sess.notes.sort(function (a, b) { return a.sec - b.sec; });
    return sess.notes;
  }

  /* ── timecode ────────────────────────────────────────────────────── */
  function fmtTc(sec, fps) {
    fps = fps || 24;
    var s = Math.max(0, +sec || 0);
    var f = Math.round((s - Math.floor(s)) * fps);
    if (f >= fps) { f = 0; s += 1; }
    s = Math.floor(s);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) + ':' + pad(f);
  }
  function parseTc(str, fps) {
    fps = fps || 24;
    var m = /^(\d{1,2}):(\d{2}):(\d{2})(?::(\d{1,2}))?$/.exec(String(str || '').trim());
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? (+m[4]) / fps : 0);
    var m2 = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
    if (m2) return (+m2[1]) * 60 + (+m2[2]);
    var n = parseFloat(str);
    return isFinite(n) ? n : 0;
  }

  /* notes → Editor ruler markers */
  function toMarkers(sess) {
    return sortNotes(sess).filter(function (n) { return n.status === 'open'; })
      .map(function (n) {
        return { sec: n.sec, text: fmtTc(n.sec, sess.fps) + ' ' + (n.author ? n.author + ': ' : '') + n.text };
      });
  }

  function progress(sess) {
    var open = sess.notes.filter(function (n) { return n.status === 'open'; }).length;
    return { total: sess.notes.length, open: open, done: sess.notes.length - open,
             locked: sess.notes.length > 0 && open === 0 };
  }

  function exportText(sess) {
    var out = 'REVIEW NOTES — ' + sess.title + (sess.createdAt ? ' · ' + sess.createdAt : '') + '\n' +
              '────────────────────────────────────────\n';
    sortNotes(sess).forEach(function (n) {
      out += fmtTc(n.sec, sess.fps) + '  [' + n.status.toUpperCase() + ']  ' +
             (n.author ? n.author + ' — ' : '') + n.text + '\n';
    });
    return out;
  }

  root.CScreen = {
    blank: blank, newSession: newSession, session: session, removeSession: removeSession,
    addNote: addNote, setStatus: setStatus, removeNote: removeNote, sortNotes: sortNotes,
    fmtTc: fmtTc, parseTc: parseTc, toMarkers: toMarkers, progress: progress, exportText: exportText
  };
})(typeof window !== 'undefined' ? window : globalThis);
