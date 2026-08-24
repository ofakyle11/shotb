/* CINAMATE — active-project lock badge.
 *
 * The Projects vault keeps one production live across the whole site;
 * this badge pins its name into every module's topbar and, if another
 * tab switches projects, locks this page behind a reload prompt so two
 * productions can never bleed into each other. Original code.
 */
(function () {
  'use strict';
  var META = 'CIN_Projects_v1';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function activeName() {
    try {
      var m = JSON.parse(localStorage.getItem(META) || 'null');
      return (m && m.active) || 'Project 1';
    } catch (e) { return 'Project 1'; }
  }
  var startActive = activeName();

  function mount() {
    var tb = document.querySelector('.topbar');
    if (!tb || document.getElementById('cinProjBadge')) return;
    var a = document.createElement('a');
    a.id = 'cinProjBadge';
    a.href = '/projects/';
    a.title = 'Active project — every module reads and writes this production. Click to switch, back up or start another.';
    a.style.cssText = 'margin-left:10px;font-size:10px;font-weight:700;letter-spacing:.04em;color:#7FA8CC;text-decoration:none;border:1px solid rgba(139,163,184,.28);border-radius:6px;padding:3px 9px;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis;align-self:center';
    a.textContent = '▣ ' + startActive;
    var spacer = tb.querySelector('.tb-spacer');
    tb.insertBefore(a, spacer || null);
  }

  function overlay(newName) {
    if (document.getElementById('cinProjSwitch')) return;
    var d = document.createElement('div');
    d.id = 'cinProjSwitch';
    d.style.cssText = 'position:fixed;inset:0;background:rgba(6,14,26,.94);z-index:99999;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px';
    d.innerHTML = '<div><div style="font:700 20px Cinzel,serif;color:#E8EEF2;margin-bottom:10px">Project switched</div>' +
      '<div style="font:13px Inter,sans-serif;color:#A0B4C8;max-width:440px;line-height:1.65">This browser is now working on <b style="color:#7FA8CC">' + esc(newName) + '</b>. ' +
      'This page was opened under a different production — reload it so nothing crosses between projects.</div>' +
      '<button id="cinProjReload" style="margin-top:16px;background:#5B8DB8;border:none;color:#0A1628;font-weight:700;border-radius:8px;padding:10px 22px;cursor:pointer;font-size:13px">Reload this page</button></div>';
    document.body.appendChild(d);
    document.getElementById('cinProjReload').onclick = function () { location.reload(); };
  }

  window.addEventListener('storage', function (ev) {
    if (ev.key !== META) return;
    var n = activeName();
    if (n !== startActive) {
      var b = document.getElementById('cinProjBadge');
      if (b) b.textContent = '▣ ' + n;
      overlay(n);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* ── studio cloud auto-sync ─────────────────────────────────────────
     Quietly backs the active production up to the studio cloud after real
     work: every 4 minutes of activity (and when the tab hides) the SB_*
     stores are hashed; if they changed since the last push AND the cloud
     copy isn't someone else's newer save, the production is pushed with
     this owner's name on it. Overwrite protection: another owner's newer
     cloud save turns the badge amber instead of being clobbered. */
  var SYNC_MS = 4 * 60 * 1000;
  var lastPushedHash = null;
  var lastSafe = false;

  function cookieOwner() {
    try {
      /* identity only — the real session token is HttpOnly and never read here */
      var who = /(?:^|;\s*)cin_who=([^;]+)/.exec(document.cookie || '');
      if (who) {
        var n = decodeURIComponent(who[1]).trim().toLowerCase();
        if (/^[a-z]{2}\d{3}$/.test(n)) return n;
      }
      var m = /(?:^|;\s*)cin_owner=([^;]+)/.exec(document.cookie || '');
      if (m) {
        var parts = decodeURIComponent(m[1]).split(':');
        if (parts.length === 4 && parts[0] === 'owner' && +parts[2] > Date.now()) {
          return parts[1].toLowerCase();
        }
      }
      var raw = sessionStorage.getItem('cinamate.session');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && typeof s.operator === 'string' && /^[a-z]{2}\d{3}$/i.test(s.operator)) {
          return s.operator.toLowerCase();
        }
      }
      return null;
    } catch (e) { return null; }
  }
  function snapshotString() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      /* SB_LocalGPU_v1 holds this machine's bridge address and API key;
         SB_TMDB_v1 holds a personal API key. The studio cloud is shared by
         every owner, so neither may ever go up. */
      if (/^SB_[A-Za-z0-9]+_v\d+$/.test(k) && !/^SB_(LocalGPU|TMDB)_v\d+$/i.test(k)) keys.push(k);
    }
    keys.sort();
    var out = {};
    keys.forEach(function (k) { out[k] = localStorage.getItem(k); });
    return JSON.stringify(out);
  }
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36) + ':' + s.length;
  }
  function markBadge(state, title) {
    var b = document.getElementById('cinProjBadge');
    if (!b) return;
    b.style.borderColor = state === 'ok' ? 'rgba(155,203,155,.5)'
      : state === 'warn' ? 'rgba(201,168,108,.7)' : 'rgba(139,163,184,.28)';
    if (title) b.title = title;
  }
  /* What the cloud held the last time this tab looked. Used to notice that
     someone else has saved since, which the previous version could not do:
     it only consulted the guard before its FIRST push and trusted itself
     unconditionally thereafter, so a tab left open all day would quietly
     overwrite every colleague who saved in the meantime. */
  var lastSeenSavedAt = null;
  var lastSeenVer = null;

  function autoSync(viaBeacon) {
    var me = cookieOwner();
    if (!me) return;
    var stores = snapshotString();
    if (stores === '{}') return;                     // empty workspace — nothing to save
    var h = hashStr(stores);
    if (h === lastPushedHash) return;                // no changes since last push
    var name = activeName();
    var archive = JSON.stringify({ format: 'cinamate/1', name: name,
      savedAt: 'auto', stores: JSON.parse(stores) });
    if (archive.length > 3800000) return;            // near the cloud cap — manual push territory
    /* Declaring the version we believe we are replacing lets the server refuse
       a push from a tab whose picture of the cloud is out of date, instead of
       burying whatever arrived in the meantime. */
    function pushBody() {
      var b = { op: 'push', name: name, archive: archive };
      if (lastSeenVer !== null) b.ifVer = lastSeenVer;
      return JSON.stringify(b);
    }
    var body = pushBody();

    /* A beacon cannot read a response, so it can never check anything. It is
       only safe when a check performed moments ago is still good — meaning we
       have pushed this production before and nobody has saved over it since.
       Otherwise the page is closing and the right thing is to skip: the work
       is still on this device, and losing a colleague's day is worse than
       losing four minutes of autosave. */
    if (viaBeacon) {
      if (navigator.sendBeacon && lastSafe && lastPushedHash !== null) {
        navigator.sendBeacon('/.netlify/functions/projects-sync', body);
        lastPushedHash = h;
      }
      return;
    }

    /* Every push re-checks — not just the first. */
    fetch('/.netlify/functions/projects-sync?op=list', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) { lastSafe = false; return; }
        var mine = (j.productions || []).filter(function (p) { return p.name === name; })[0];
        var savedBy = mine && mine.savedBy;
        var savedAt = mine && mine.savedAt;
        lastSeenVer = mine && typeof mine.ver === 'number' ? mine.ver : null;
        body = pushBody();

        /* Hold back if the cloud copy belongs to someone else and we have not
           already taken ownership of it, OR if it moved under us since we last
           looked — that second case is a colleague saving while this tab sat
           open, which the old guard was blind to. */
        var foreignAndUntouched = savedBy && savedBy !== me && lastPushedHash === null;
        var movedSinceWeLooked = lastSeenSavedAt !== null && savedAt && savedAt !== lastSeenSavedAt &&
                                 savedBy && savedBy !== me;
        if (foreignAndUntouched || movedSinceWeLooked) {
          lastSafe = false;
          lastSeenSavedAt = savedAt || lastSeenSavedAt;
          markBadge('warn', 'Cloud copy of "' + name + '" was saved by ' +
            String(savedBy).toUpperCase() + (savedAt ? ' at ' + savedAt : '') +
            ' — open Projects to pull it or push over it deliberately. Auto-sync is holding back.');
          return;
        }

        lastSafe = true;
        return fetch('/.netlify/functions/projects-sync', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: body
        }).then(function (r2) {
          if (r2.status === 409) {
            lastSafe = false;
            lastSeenVer = null;             // re-read the cloud on the next pass
            markBadge('warn', '"' + name + '" changed in the studio cloud while this tab was open — ' +
              'open Projects to pull it before saving over it. Auto-sync is holding back.');
            return null;
          }
          return r2.ok ? r2.json().catch(function () { return {}; }) : null;
        })
          .then(function (saved) {
            if (!saved) return;
            lastPushedHash = h;
            lastSeenSavedAt = saved.savedAt || lastSeenSavedAt;
            if (typeof saved.ver === 'number') lastSeenVer = saved.ver;
            markBadge('ok', 'Active project — auto-saved to the studio cloud ' +
              new Date().toTimeString().slice(0, 5) + '. Click to manage.');
          });
      })
      .catch(function () { /* offline — next tick retries */ });
  }
  setInterval(function () { autoSync(false); }, SYNC_MS);
  setTimeout(function () { autoSync(false); }, 25000);   // first pass shortly after load
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') autoSync(true);
  });
})();
