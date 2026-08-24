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
  /* Configuration that belongs to THIS MACHINE, not to the production. The
     local-GPU record holds the bridge address and its API key, and the TMDB
     record holds a personal API key. Sweeping either into a snapshot published
     it to every other owner through the shared studio cloud, and into any
     .cinamate file the owner passed around. Neither should be swapped when
     switching projects either — the bridge and your API keys do not change
     because the film did. Anything holding a credential belongs here. */
  var LOCAL_ONLY = /^SB_(LocalGPU|TMDB)_v\d+$/i;
  function isPortable(k) { return KEY_RE.test(k) && !LOCAL_ONLY.test(k); }

  function allKeys(store) {
    var out = [];
    if (typeof store.length === 'number' && store.key) {
      for (var i = 0; i < store.length; i++) out.push(store.key(i));
    } else {
      out = Object.keys(store._data || store);
    }
    return out.filter(isPortable);
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
     A production can arrive from another owner (studio cloud) or from a file
     someone was sent. Modules interpolate stored values straight into HTML, so
     a hostile value anywhere in that archive can run as script in the reader's
     session.

     This once worked from a list of field names known to be dangerous. That
     was the wrong way round and it leaked: 'dn', 'srcId', 'sec', 'rot',
     'durationSec' and 'website' are all rendered raw somewhere in the app and
     none of them matched the list. A name-based deny-list can only ever be as
     complete as the last audit of it.

     So the default is now to neutralise EVERY string, and the short list is of
     fields deliberately kept verbatim — the prose a production is actually made
     of. Mangling a screenplay would destroy real work, and prose is rendered as
     text through esc(), never as markup.                                */
  var PROSE_FIELD = new RegExp('^(scripttext|script|text|notes?|desc|description|' +
    'prompt|synopsis|logline|treatment|dialogue|action|comments?)$', 'i');
  /* Suffix match: an exact list always misses one (videoUrl, activeClipUrl,
     bitmapUrl…). Anything ending in a media/URL word is treated as a URL. */
  var URLISH_FIELD = new RegExp('(^|[a-z0-9_])(url|uri|src|img|image|thumb|photo|' +
    'plate|poster|frame|href|link|website|site|page)$', 'i');
  /* A scheme can be hostile without containing a single markup character, so
     stripping <>"' would not touch javascript:alert(1) in an href. */
  var BAD_SCHEME = /^[\s\x00-\x1f]*(javascript|vbscript|data|file)[\s\x00-\x1f]*:/i;

  function cleanField(name, v) {
    if (typeof v !== 'string') return v;
    if (PROSE_FIELD.test(name)) return v;              // kept exactly as written
    if (URLISH_FIELD.test(name)) {
      // Only shapes the app itself produces; anything else becomes empty.
      return /^(https?:\/\/|blob:|data:image\/(png|jpe?g|webp|gif);base64,|data:video\/(mp4|webm);base64,|\/)/i.test(v)
        && !/["'<>]/.test(v) ? v : '';
    }
    if (BAD_SCHEME.test(v)) return '';
    return v.replace(/[<>"']/g, '');
  }
  /* Nesting deep enough to exhaust the call stack is not a production, it is a
     way to make the sanitiser throw. Anything past this depth is dropped. */
  var MAX_DEPTH = 100;

  function scrub(node, key, depth) {
    depth = depth || 0;
    if (depth > MAX_DEPTH) return null;                 // discard, never pass through
    if (node === null || typeof node !== 'object') return cleanField(key || '', node);
    if (Object.prototype.toString.call(node) === '[object Array]') {
      for (var i = 0; i < node.length; i++) node[i] = scrub(node[i], key, depth + 1);
      return node;
    }
    Object.keys(node).forEach(function (k) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') { delete node[k]; return; }
      node[k] = (typeof node[k] === 'object' && node[k] !== null)
        ? scrub(node[k], k, depth + 1)
        : cleanField(k, node[k]);                       // every scalar, not a chosen few
    });
    return node;
  }

  /* Returns the sanitised text, or throws. It must never hand back the input.
     This previously caught its own failure and returned the ORIGINAL string,
     so anything that made the sanitiser throw — deep nesting was enough —
     travelled through completely unsanitised. A safety check that fails open
     is worse than none, because it is trusted. */
  function sanitizeStoreValue(raw) {
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      /* Plain text has no structure to abuse and is stored as-is. But a value
         that LOOKS like JSON and still refuses to parse is not ordinary data —
         nesting deep enough to defeat the parser is the usual reason — and
         handing it back unexamined is exactly the fail-open path this function
         exists to avoid. */
      if (/^\s*[[{]/.test(String(raw))) {
        throw new Error('A stored value in that archive could not be read safely');
      }
      return raw;
    }
    if (parsed === null || typeof parsed !== 'object') return raw;
    return JSON.stringify(scrub(parsed, '', 0));
  }

  function writeStores(store, stores, opts) {
    var foreign = !opts || opts.trusted !== true;   // default: treat as untrusted
    /* Sanitise everything BEFORE touching storage. Doing it key-by-key while
       writing meant a failure part-way left the workspace already cleared and
       only half rewritten — the sanitiser turning into a shredder. */
    var ready = {};
    var names = Object.keys(stores || {}).filter(isPortable);
    for (var i = 0; i < names.length; i++) {
      var k = names[i];
      var v = String(stores[k]);
      ready[k] = foreign ? sanitizeStoreValue(v) : v;   // throws → nothing has changed yet
    }
    allKeys(store).forEach(function (key) { store.removeItem(key); });
    var n = 0;
    Object.keys(ready).forEach(function (key) { store.setItem(key, ready[key]); n++; });
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
    /* An archive carrying no portable stores is not a production. Restoring one
       clears the workspace and writes nothing back, so a single empty file — or
       one whose keys were all foreign and got dropped — silently erased
       everything the operator had. Refuse rather than obey. */
    var portable = Object.keys(a.stores || {}).filter(isPortable);
    if (!portable.length) {
      throw new Error('That archive contains no production data — nothing was changed');
    }
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
    var target = m.slots[name];
    /* Persist the outgoing project's snapshot BEFORE overwriting live storage.
       The old order cleared the workspace first and saved the record after, so
       a failure in between (a full quota, a closed tab) left the meta pointing
       at a project whose contents had already been thrown away. */
    m.slots[m.active] = { savedAt: when || '', stores: snapshot(store) };
    m.active = name;
    if (!m.slots[name]) m.slots[name] = { savedAt: when || '', stores: {} };
    saveMeta(store, m);
    writeStores(store, target ? target.stores : {}, { trusted: true });  // your own slot — never mangle it
    return m;
  }

  /* stash live, then start an empty workspace under `name` */
  function newProject(store, name, when) {
    var m = meta(store);
    if (!name) throw new Error('A project needs a name');
    /* Reusing an existing name emptied that project's workspace instead of
       creating a new one. Switch to it if that is what was meant. */
    if (Object.prototype.hasOwnProperty.call(m.slots, name)) {
      throw new Error('A project named "' + name + '" already exists — open it instead of starting over');
    }
    m.slots[m.active] = { savedAt: when || '', stores: snapshot(store) };
    /* Record the stash BEFORE clearing live storage: if the write below fails
       (a full quota is the usual cause) the meta already holds the work, so
       nothing is stranded between two states. */
    m.active = name;
    m.slots[name] = { savedAt: when || '', stores: {} };
    saveMeta(store, m);
    writeStores(store, {}, { trusted: true });
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
    /* Renaming onto an existing project used to overwrite it outright — one
       keystroke and another film was gone with nothing kept. */
    if (Object.prototype.hasOwnProperty.call(m.slots, name)) {
      throw new Error('A project named "' + name + '" already exists — pick another name');
    }
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

  /* Sanitise a parsed object that arrived from outside this browser. Exposed
     so any page importing a file can reuse the exact rules the vault applies,
     instead of inventing a weaker second copy. */
  function scrubImported(obj) {
    /* Deliberately not wrapped in a try/catch that returns the input. A caller
       that cannot sanitise must refuse the data, not pass the original through
       believing it was cleaned. */
    return scrub(obj, '', 0);
  }

  root.CVault = {
    FORMAT: FORMAT,
    META_KEY: META_KEY,
    scrubImported: scrubImported,
    isPortable: isPortable,
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
