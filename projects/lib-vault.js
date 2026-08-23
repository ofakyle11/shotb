/* CINAMATE Projects — vault engine (pure, storage-agnostic).
 *
 * Everything the platform saves lives under SB_* keys in localStorage.
 * The vault snapshots those keys into named project slots, switches
 * between them, and packs/unpacks whole projects as portable
 * `.cinamate` archive files. All original code, written for Cinamate.
 *
 * Functions take a storage-like object ({getItem,setItem,removeItem} +
 * key enumeration via `allKeys`) so the engine is node-testable.
 */
(function (root) {
  'use strict';
  var FORMAT = 'cinamate/1';
  var META_KEY = 'CIN_Projects_v1';
  var KEY_RE = /^SB_[A-Za-z0-9]+_v\d+$/;

  function allKeys(store) {
    var out = [];
    if (typeof store.length === 'number' && store.key) {
      for (var i = 0; i < store.length; i++) out.push(store.key(i));
    } else {
      out = Object.keys(store._data || store);
    }
    return out.filter(function (k) { return KEY_RE.test(k); });
  }

  /* live SB_* keys → {key: rawJsonString} */
  function snapshot(store) {
    var out = {};
    allKeys(store).forEach(function (k) {
      var v = store.getItem(k);
      if (v != null) out[k] = v;
    });
    return out;
  }

  /* ── incoming-archive sanitiser ───────────────────────────────────
     A production can arrive from another owner (studio cloud) or from a
     file someone was sent. Modules interpolate identifier-shaped fields —
     record ids, account codes, image and video URLs — straight into HTML
     attributes, so a hostile value in one of those would run as script in
     the reader's session. Prose fields (script text, notes, descriptions)
     are left exactly as written: they are rendered as text, and mangling
     them would corrupt real work.                                      */
  var UNSAFE_FIELD = /^(id|uid|key|acct|account|num|no|code|slug|ref|src|url|img|image|thumb|photo|plate|poster|frame|href|link|status|type|kind|unit|tier|scope)$/i;
  var URLISH_FIELD = /^(src|url|img|image|thumb|photo|plate|poster|frame|href|link|refurl|plateurl)$/i;
  function cleanField(name, v) {
    if (typeof v !== 'string') return v;
    if (URLISH_FIELD.test(name)) {
      // Only shapes the app itself produces; anything else becomes empty.
      return /^(https?:\/\/|blob:|data:image\/(png|jpe?g|webp|gif);base64,|data:video\/(mp4|webm);base64,|\/)/i.test(v)
        && !/["'<>]/.test(v) ? v : '';
    }
    return v.replace(/[<>"']/g, '');
  }
  function scrub(node, key) {
    if (node === null || typeof node !== 'object') return cleanField(key || '', node);
    if (Object.prototype.toString.call(node) === '[object Array]') {
      for (var i = 0; i < node.length; i++) node[i] = scrub(node[i], key);
      return node;
    }
    Object.keys(node).forEach(function (k) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') { delete node[k]; return; }
      node[k] = (typeof node[k] === 'object' && node[k] !== null)
        ? scrub(node[k], k)
        : (UNSAFE_FIELD.test(k) ? cleanField(k, node[k]) : node[k]);
    });
    return node;
  }
  function sanitizeStoreValue(raw) {
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return raw; }  // not JSON — stored as-is
    if (parsed === null || typeof parsed !== 'object') return raw;
    try { return JSON.stringify(scrub(parsed, '')); } catch (e) { return raw; }
  }

  function writeStores(store, stores, opts) {
    // clear existing project keys first so stale modules don't survive
    allKeys(store).forEach(function (k) { store.removeItem(k); });
    var foreign = !opts || opts.trusted !== true;   // default: treat as untrusted
    var n = 0;
    Object.keys(stores || {}).forEach(function (k) {
      if (!KEY_RE.test(k)) return; // never restore non-project keys
      var v = String(stores[k]);
      store.setItem(k, foreign ? sanitizeStoreValue(v) : v);
      n++;
    });
    return n;
  }

  /* ── archive files ──────────────────────────────────────────────── */
  function archive(store, name, when) {
    return JSON.stringify({
      format: FORMAT,
      name: name || 'Untitled Project',
      savedAt: when || '',
      stores: snapshot(store)
    });
  }

  function parseArchive(text) {
    var a;
    try { a = JSON.parse(text); } catch (e) { throw new Error('Not a valid archive file'); }
    if (!a || a.format !== FORMAT) throw new Error('Not a Cinamate project archive (format missing)');
    if (!a.stores || typeof a.stores !== 'object') throw new Error('Archive has no project data');
    return a;
  }

  function restore(store, archiveObj) {
    var a = typeof archiveObj === 'string' ? parseArchive(archiveObj) : archiveObj;
    return writeStores(store, a.stores);
  }

  /* ── project slots ──────────────────────────────────────────────── */
  function meta(store) {
    var m = null;
    try { m = JSON.parse(store.getItem(META_KEY) || 'null'); } catch (e) {}
    if (!m || typeof m !== 'object') m = { active: 'Project 1', slots: {} };
    if (!m.active) m.active = 'Project 1';
    if (!m.slots) m.slots = {};
    return m;
  }
  function saveMeta(store, m) { store.setItem(META_KEY, JSON.stringify(m)); }

  /* update the active project's slot from the live workspace */
  function saveActive(store, when) {
    var m = meta(store);
    m.slots[m.active] = { savedAt: when || '', stores: snapshot(store) };
    saveMeta(store, m);
    return m;
  }

  /* stash live → active slot, then load `name` into the live workspace */
  function switchTo(store, name, when) {
    var m = meta(store);
    if (name === m.active) return m;
    m.slots[m.active] = { savedAt: when || '', stores: snapshot(store) };
    var target = m.slots[name];
    writeStores(store, target ? target.stores : {}, { trusted: true });  // your own slot — never mangle it
    m.active = name;
    if (!m.slots[name]) m.slots[name] = { savedAt: when || '', stores: {} };
    saveMeta(store, m);
    return m;
  }

  /* stash live, then start an empty workspace under `name` */
  function newProject(store, name, when) {
    var m = meta(store);
    m.slots[m.active] = { savedAt: when || '', stores: snapshot(store) };
    writeStores(store, {}, { trusted: true });
    m.active = name;
    m.slots[name] = { savedAt: when || '', stores: {} };
    saveMeta(store, m);
    return m;
  }

  function deleteSlot(store, name) {
    var m = meta(store);
    if (name === m.active) throw new Error('Switch to another project before deleting the active one');
    delete m.slots[name];
    saveMeta(store, m);
    return m;
  }

  function renameActive(store, name) {
    var m = meta(store);
    if (!name || name === m.active) return m;
    if (m.slots[m.active]) { m.slots[name] = m.slots[m.active]; delete m.slots[m.active]; }
    m.active = name;
    saveMeta(store, m);
    return m;
  }

  /* rough size + per-module inventory for the UI */
  function inventory(stores) {
    var bytes = 0;
    var mods = [];
    Object.keys(stores || {}).forEach(function (k) {
      var v = String(stores[k] || '');
      bytes += k.length + v.length;
      mods.push({ key: k, bytes: v.length });
    });
    mods.sort(function (a, b) { return b.bytes - a.bytes; });
    return { bytes: bytes, count: mods.length, modules: mods };
  }

  root.CVault = {
    FORMAT: FORMAT,
    META_KEY: META_KEY,
    allKeys: allKeys,
    snapshot: snapshot,
    archive: archive,
    parseArchive: parseArchive,
    restore: restore,
    meta: meta,
    saveActive: saveActive,
    switchTo: switchTo,
    newProject: newProject,
    deleteSlot: deleteSlot,
    renameActive: renameActive,
    inventory: inventory
  };
})(typeof window !== 'undefined' ? window : globalThis);
