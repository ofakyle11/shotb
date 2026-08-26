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
      var val = (typeof node[k] === 'object' && node[k] !== null)
        ? scrub(node[k], k, depth + 1)
        : cleanField(k, node[k]);                       // every scalar, not a chosen few

      /* Keys are content too. Nested maps in this app are routinely keyed by
         things a person typed — a character name, a location, a department —
         and several modules render Object.keys() straight into markup. This
         used to re-use `k` verbatim, so an archive could carry its payload in
         the key and walk past a sanitiser that only ever looked at values.
         The key is cleaned rather than dropped so the entry itself survives
         with a harmless name; a collision keeps whichever arrived first. */
      var safeKey = k.replace(/[<>"']/g, '');
      /* The CLEANED key has to face the same deny-list as the raw one.
         Stripping markup characters can manufacture a dangerous name:
         "__pro<to__" is not on the list above, and removing the "<" turns it
         into "__proto__" — assigning to which runs the setter and changes the
         object's prototype. Checking only the raw key meant this sanitiser
         built the exact thing the deny-list exists to prevent. */
      if (safeKey === '__proto__' || safeKey === 'constructor' || safeKey === 'prototype') {
        delete node[k];
        return;
      }
      if (safeKey !== k) {
        delete node[k];
        if (safeKey && !Object.prototype.hasOwnProperty.call(node, safeKey)) {
          /* defineProperty, not assignment: assignment would invoke an
             inherited setter, which is half of what we are guarding against. */
          Object.defineProperty(node, safeKey,
            { value: val, writable: true, enumerable: true, configurable: true });
        }
      } else {
        node[k] = val;
      }
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
    /* `blobs` is optional — archives written before the vault carried media do
       not have it. But a `blobs` that is present and is not a list is a broken
       file, and reading past it would silently restore a production minus its
       photographs while reporting success. */
    if (a.blobs != null && Object.prototype.toString.call(a.blobs) !== '[object Array]') {
      throw new Error('That archive’s media section is unreadable — restoring it would drop every photo');
    }
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

  /* ══ media: the bytes the vault used to leave behind ══════════════════════
     Three modules put binary production data in IndexedDB. The vault only ever
     snapshotted localStorage, so the photo REFERENCES travelled in every
     archive and every cloud push and the BYTES never did — and a project switch
     wiped localStorage and left the blobs where they lay, orphaned and growing.

     This engine stays sync and pure: it never opens a database. Everything that
     touches IndexedDB arrives as an injected adapter

         { readAll()          -> Promise<[record]>      every record, every db
           putAll(records)    -> Promise<{written, failed:[{id,why}]}>
           deleteMany(refs)   -> Promise<{deleted}> }

     where a record is the flat, portable envelope below. The DOM side of that
     adapter lives in projects/index.html; node tests hand in an in-memory one.

     WHERE THE BYTES LIVE, and why. An archive carries real bytes: it leaves the
     device, so it must be self-contained. A project SLOT carries a manifest —
     ids and sizes, no data. Slots live inside CIN_Projects_v1 in localStorage,
     and a five-photo project is more than a megabyte; writing that into the one
     record that indexes every project on the machine would blow the quota and
     take all of them with it. The bytes do not need to move on a switch anyway:
     IndexedDB is not cleared, every store is keyed by id, and the manifest is
     what lets deleteSlot purge exactly one project's records and lets a switch
     report honestly on bytes that are genuinely gone.                        */

  /* A LIST, not a name. `ref` says where the localStorage side of a project
     records which ids it owns, which is how a store whose records carry no
     project stamp is still attributable to one production. */
  var BLOB_DBS = [
    { db: 'cinamate_wardrobe', store: 'photos', module: 'wardrobe',
      keyPath: 'id', dataField: 'dataUrl', projectField: 'project',
      keep: ['lookId', 'date'], label: 'continuity photo',
      ref: { key: 'SB_Wardrobe_v1', list: 'looks', ids: 'photoIds' } },
    { db: 'cinamate_scout', store: 'photos', module: 'locations',
      keyPath: null, dataField: null, projectField: null,
      keep: [], label: 'scout photo',
      ref: { key: 'SB_ScoutBook_v1', list: 'locations', ids: 'photos' } },
    { db: 'cinamate_cut', store: 'media', module: 'editor',
      keyPath: null, dataField: null, projectField: null,
      keep: ['name', 'kind'], label: 'cutting-room source',
      ref: { key: 'SB_Cut_v1', list: 'bin', ids: 'id', flag: 'idb' } }
  ];

  /* Deliberate, stated caps. A JPEG data URL out of the scout book is 100-300
     KB; a cutting-room source can be gigabytes. The cloud takes the former.
     chunks x chunkBytes IS the per-production ceiling, so the ceiling holds by
     construction rather than by an accounting step that can be skipped. */
  var BLOB_LIMITS = {
    recordBytes: 900 * 1024,          // one record — 3x a full-size scout JPEG
    chunkBytes: 1024 * 1024,          // one request — well inside any function limit
    chunks: 48,                       // per production
    totalBytes: 48 * 1024 * 1024      // = chunks x chunkBytes
  };

  function kbOf(n) {
    n = Number(n) || 0;
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function specFor(db, store) {
    for (var i = 0; i < BLOB_DBS.length; i++) {
      if (BLOB_DBS[i].db === db && BLOB_DBS[i].store === store) return BLOB_DBS[i];
    }
    return null;
  }
  function blobKey(r) { return String(r.db) + '/' + String(r.store) + '/' + String(r.id); }

  /* Which ids one project's localStorage snapshot claims, per store. */
  function refsOf(stores, spec) {
    var out = {};
    if (!spec || !spec.ref) return out;
    var r = spec.ref, raw = stores ? stores[r.key] : null, st = raw;
    if (typeof raw === 'string') { try { st = JSON.parse(raw); } catch (e) { return out; } }
    if (!st || typeof st !== 'object') return out;
    var list = st[r.list];
    if (Object.prototype.toString.call(list) !== '[object Array]') return out;
    list.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      if (r.flag && !row[r.flag]) return;
      var v = row[r.ids];
      if (Object.prototype.toString.call(v) === '[object Array]') {
        v.forEach(function (id) { if (id != null && id !== '') out[String(id)] = true; });
      } else if (v != null && v !== '') out[String(v)] = true;
    });
    return out;
  }
  function referencedIds(stores) {
    var out = {};
    BLOB_DBS.forEach(function (spec) { out[spec.db + '/' + spec.store] = refsOf(stores, spec); });
    return out;
  }

  function normalizeBlob(r) {
    var spec = specFor(r.db, r.store);
    if (!spec) return null;
    var data = r.data == null ? '' : String(r.data);
    var out = { db: spec.db, store: spec.store, id: String(r.id),
                project: r.project == null ? '' : String(r.project),
                data: data, bytes: Number(r.bytes) || data.length };
    (spec.keep || []).forEach(function (k) { if (r[k] != null) out[k] = String(r[k]); });
    return out;
  }
  /* The slot shape: what a project owns, without the bytes. */
  function manifestOf(blobs) {
    return (blobs || []).map(function (r) {
      return { db: String(r.db), store: String(r.store), id: String(r.id),
               bytes: Number(r.bytes || (r.data || '').length) || 0 };
    });
  }
  function blobInventory(list) {
    var bytes = 0;
    (list || []).forEach(function (r) { bytes += Number(r.bytes || (r.data || '').length) || 0; });
    return { count: (list || []).length, bytes: bytes, label: kbOf(bytes) };
  }

  /* records + one project's localStorage snapshot -> that project's media.
     A stamped record (wardrobe) is claimed by its stamp; an unstamped one
     (scout, cutting room) is claimed by whichever project's snapshot names it,
     which is derivable and needs no migration of live owner data. */
  function blobsFor(records, stores, project) {
    var proj = String(project == null ? '' : project);
    var refs = referencedIds(stores || {});
    var out = [], seen = {};
    (records || []).forEach(function (r) {
      if (!r || r.id == null || r.id === '') return;
      var spec = specFor(r.db, r.store);
      if (!spec) return;
      var owner = (spec.projectField && r.project != null) ? String(r.project) : '';
      /* Either claim is enough. The stamp catches a record this project made
         and has since stopped pointing at; the reference catches a record that
         carries no stamp at all (scout, cutting room) and one whose stamp has
         gone stale — a project rename leaves every wardrobe photo stamped with
         the old title, and reading only the stamp would strand all of them. */
      var mine = (owner && owner === proj) ||
        !!(refs[spec.db + '/' + spec.store] || {})[String(r.id)];
      if (!mine) return;
      var k = blobKey(r);
      if (seen[k]) return;
      seen[k] = true;
      out.push(r);
    });
    return out;
  }

  /* Referenced by the restored production, present nowhere. This is the report
     that replaces a silently removed <img>. */
  function missingBlobs(stores, available) {
    var have = {};
    (available || []).forEach(function (r) { if (r && r.id != null) have[blobKey(r)] = true; });
    var refs = referencedIds(stores || {});
    var out = [];
    BLOB_DBS.forEach(function (spec) {
      var k = spec.db + '/' + spec.store;
      Object.keys(refs[k] || {}).forEach(function (id) {
        if (!have[k + '/' + id]) {
          out.push({ db: spec.db, store: spec.store, id: id, module: spec.module, label: spec.label });
        }
      });
    });
    return out;
  }

  /* ── incoming media is untrusted, exactly like an incoming store ──
     Note what is NOT done here: an id is not cleaned, it is refused. An id is a
     REFERENCE — stripping a character out of it to make it attribute-safe would
     quietly break the link from the look or the location that points at it, and
     the archive would restore looking complete with a photo that can never be
     found again. */
  var BLOB_DATA_RE = new RegExp('^data:(?:image\\/(?:png|jpe?g|webp|gif|avif)|' +
    'video\\/(?:mp4|webm|quicktime)|audio\\/(?:mpeg|mp4|wav|webm|ogg));base64,[A-Za-z0-9+/]*={0,2}$');
  var BLOB_ID_RE = /^[A-Za-z0-9 ._:@#()+-]{1,200}$/;

  function sanitizeBlobs(list, limits) {
    var lim = limits || BLOB_LIMITS;
    var ok = [], dropped = [];
    if (Object.prototype.toString.call(list) !== '[object Array]') return { blobs: ok, dropped: dropped };
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') { dropped.push({ id: '', why: 'not a media record' }); continue; }
      var id = String(r.id == null ? '' : r.id);
      var spec = specFor(r.db, r.store);
      if (!spec) {
        dropped.push({ id: id.slice(0, 60), why: 'names a store this platform does not have' });
        continue;
      }
      if (!BLOB_ID_RE.test(id)) { dropped.push({ id: id.slice(0, 60), why: 'unusable record id' }); continue; }
      var data = String(r.data == null ? '' : r.data);
      if (!BLOB_DATA_RE.test(data)) {
        dropped.push({ id: id, why: 'is not an image, audio or video data URL' });
        continue;
      }
      if (data.length > lim.recordBytes) {
        dropped.push({ id: id, why: 'is ' + kbOf(data.length) + ', over the ' + kbOf(lim.recordBytes) + ' per-record limit' });
        continue;
      }
      var clean = { db: spec.db, store: spec.store, id: id, data: data,
                    project: String(r.project == null ? '' : r.project).replace(/[<>"']/g, '') };
      (spec.keep || []).forEach(function (k) {
        if (r[k] != null) clean[k] = String(r[k]).replace(/[<>"']/g, '');
      });
      ok.push(normalizeBlob(clean));
    }
    return { blobs: ok, dropped: dropped };
  }

  /* ── chunking for the studio cloud ──
     One request per chunk, sized so a retry is cheap and no single request can
     approach a function's body limit. A record that cannot fit in one chunk is
     REFUSED, never split and never dropped: a truncated archive that reports
     success is the failure this whole order exists to remove. */
  function planBlobUpload(blobs, limits) {
    var lim = limits || BLOB_LIMITS;
    var list = blobs || [];
    var refused = [], chunks = [], cur = [], curBytes = 0, total = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var n = Number(r.bytes || (r.data || '').length) || 0;
      total += n;
      if (n > lim.recordBytes) {
        refused.push({ id: String(r.id), bytes: n, why: 'is ' + kbOf(n) + ' on its own' });
        continue;
      }
      if (cur.length && curBytes + n > lim.chunkBytes) { chunks.push(cur); cur = []; curBytes = 0; }
      cur.push(r); curBytes += n;
    }
    if (cur.length) chunks.push(cur);
    var plan = { ok: true, error: '', chunks: chunks, count: list.length - refused.length,
                 bytes: total, refused: refused, limits: lim };
    if (refused.length) {
      plan.ok = false;
      plan.error = refused.length + ' file(s) are too large for the studio cloud — ' +
        refused.slice(0, 3).map(function (x) { return '"' + x.id + '" ' + x.why; }).join('; ') +
        (refused.length > 3 ? '; and ' + (refused.length - 3) + ' more' : '') +
        '. The cloud carries stills and short takes, not source masters (limit ' +
        kbOf(lim.recordBytes) + ' each). Nothing was sent — export a .cinamate backup instead, which has no size limit.';
      return plan;
    }
    if (chunks.length > lim.chunks || total > lim.totalBytes) {
      plan.ok = false;
      plan.error = 'This production carries ' + kbOf(total) + ' of photos and media, in ' + chunks.length +
        ' part(s). The studio cloud holds ' + kbOf(lim.totalBytes) + ' per production, in at most ' +
        lim.chunks + ' parts. Nothing was sent — export a .cinamate backup instead (no size limit), ' +
        'or purge orphaned media first.';
    }
    return plan;
  }

  function blobReport(r) {
    var bits = [];
    if (r.wrote) bits.push(r.wrote + ' media file(s) restored');
    if (r.dropped && r.dropped.length) bits.push(r.dropped.length + ' unreadable and left out');
    if (r.failed && r.failed.length) bits.push(r.failed.length + ' could not be written to this browser');
    if (r.missing && r.missing.length) {
      bits.push(r.missing.length + ' referenced file(s) have no bytes on this device — ' +
        'that copy was made without them');
    }
    return bits.length ? bits.join('; ') : 'no media in this production';
  }

  /* ── promise-returning siblings ──
     Same names, same argument order, plus the adapter. The sync originals are
     untouched and still storage-only; anything that must carry bytes calls the
     sibling. */
  function needAdapter(a) {
    if (!a || typeof a.readAll !== 'function' || typeof a.putAll !== 'function' ||
        typeof a.deleteMany !== 'function') {
      throw new Error('The vault needs a media adapter: {readAll, putAll, deleteMany}');
    }
    return a;
  }
  function P(v) { return Promise.resolve(v); }
  function guard(fn) { try { return fn(); } catch (e) { return Promise.reject(e); } }
  function wroteCount(res, fallback) {
    return (res && typeof res.written === 'number') ? res.written : fallback;
  }

  function snapshotBlobs(store, adapter, project) {
    return guard(function () {
      var ad = needAdapter(adapter);
      var stores = snapshot(store);
      var proj = project == null ? meta(store).active : project;
      return P(ad.readAll()).then(function (recs) {
        return blobsFor(recs, stores, proj).map(normalizeBlob);
      });
    });
  }

  function archiveAsync(store, name, when, adapter) {
    return guard(function () {
      var ad = needAdapter(adapter);
      var stores = snapshot(store);
      var proj = meta(store).active;
      return P(ad.readAll()).then(function (recs) {
        var mine = blobsFor(recs, stores, proj).map(normalizeBlob);
        /* An entry with no bytes is not a file, it is a hole. The adapter
           returns one when a record was too large to read into memory or its
           stored shape was not readable at all. It goes in the missing list,
           never into `blobs` — an archive must not carry an entry that looks
           like a photograph and restores to nothing. */
        var carried = mine.filter(function (r) { return !!r.data; });
        return JSON.stringify({
          format: FORMAT,
          name: name || 'Untitled Project',
          savedAt: when || '',
          stores: stores,
          blobs: carried,
          /* Recorded at pack time, so a restore can tell "this backup never had
             them" apart from "this restore lost them". */
          blobsMissing: missingBlobs(stores, carried)
        });
      });
    });
  }

  function restoreAsync(store, archiveObj, adapter) {
    return guard(function () {
      var ad = needAdapter(adapter);
      var a = typeof archiveObj === 'string' ? parseArchive(archiveObj) : archiveObj;
      var clean = sanitizeBlobs(a.blobs);
      var keys = restore(store, a);           // throws on an empty archive, before any media is written
      return P(clean.blobs.length ? ad.putAll(clean.blobs) : { written: 0, failed: [] })
        .then(function (res) {
          return P(ad.readAll()).then(function (all) {
            var stores = snapshot(store);
            var rep = {
              keys: keys,
              wrote: wroteCount(res, clean.blobs.length),
              failed: (res && res.failed) || [],
              dropped: clean.dropped,
              missing: missingBlobs(stores, all),
              packedWithout: (a.blobsMissing || []).length
            };
            rep.complete = !rep.missing.length && !rep.dropped.length && !rep.failed.length;
            rep.note = blobReport(rep);
            return rep;
          });
        });
    });
  }

  function saveActiveAsync(store, when, adapter) {
    return guard(function () {
      var ad = needAdapter(adapter);
      var stores = snapshot(store);
      var active = meta(store).active;
      return P(ad.readAll()).then(function (recs) {
        var mine = blobsFor(recs, stores, active);
        var m = saveActive(store, when);
        m.slots[m.active].blobs = manifestOf(mine);
        saveMeta(store, m);
        return m;
      });
    });
  }

  function switchToAsync(store, name, when, adapter) {
    return guard(function () {
      var ad = needAdapter(adapter);
      var m0 = meta(store);
      var outgoing = m0.active;
      if (name === outgoing) {
        return P({ meta: m0, wrote: 0, dropped: [], missing: [], kept: 0, note: '' });
      }
      var live = snapshot(store);
      return P(ad.readAll()).then(function (recs) {
        /* Recorded from the LIVE workspace before it is overwritten — after the
           switch the outgoing project's references are gone from localStorage
           and an unstamped record could never be attributed again. */
        var leaving = blobsFor(recs, live, outgoing);
        var have = {};
        recs.forEach(function (r) { if (r && specFor(r.db, r.store)) have[blobKey(r)] = true; });
        /* A slot normally carries a manifest, not bytes. If one does carry
           bytes — an imported archive stashed whole — write back whatever this
           browser no longer holds. */
        var back = ((m0.slots[name] || {}).blobs || []).filter(function (r) {
          return r && r.data && !have[blobKey(r)];
        });
        var clean = sanitizeBlobs(back);
        return P(clean.blobs.length ? ad.putAll(clean.blobs) : { written: 0, failed: [] })
          .then(function (res) {
            switchTo(store, name, when);
            var m = meta(store);
            if (m.slots[outgoing]) m.slots[outgoing].blobs = manifestOf(leaving);
            if (m.slots[name] && !m.slots[name].blobs) m.slots[name].blobs = [];
            saveMeta(store, m);
            var after = recs.concat(clean.blobs);
            var rep = {
              meta: m, wrote: wroteCount(res, clean.blobs.length), dropped: clean.dropped,
              missing: missingBlobs(snapshot(store), after),
              kept: leaving.length, keptBytes: blobInventory(leaving).bytes
            };
            rep.note = blobReport(rep);
            return rep;
          });
      });
    });
  }

  function newProjectAsync(store, name, when, adapter) {
    return guard(function () {
      var ad = needAdapter(adapter);
      var m0 = meta(store);
      var outgoing = m0.active;
      var live = snapshot(store);
      return P(ad.readAll()).then(function (recs) {
        var leaving = blobsFor(recs, live, outgoing);
        newProject(store, name, when);        // throws on a duplicate name — nothing has moved yet
        var m = meta(store);
        if (m.slots[outgoing]) m.slots[outgoing].blobs = manifestOf(leaving);
        m.slots[name].blobs = [];
        saveMeta(store, m);
        return m;
      });
    });
  }

  function deleteSlotAsync(store, name, adapter) {
    return guard(function () {
      var ad = needAdapter(adapter);
      var m0 = meta(store);
      if (name === m0.active) throw new Error('Switch to another project before deleting the active one');
      if (!Object.prototype.hasOwnProperty.call(m0.slots, name)) {
        throw new Error('There is no project named "' + name + '" on this machine');
      }
      return P(ad.readAll()).then(function (recs) {
        var doomed = blobsFor(recs, (m0.slots[name] || {}).stores || {}, name);
        /* A record another production still points at is not this slot's to
           delete. Deleting the project must not reach into anyone else's. */
        var keep = {};
        blobsFor(recs, snapshot(store), m0.active).forEach(function (r) { keep[blobKey(r)] = true; });
        Object.keys(m0.slots).forEach(function (other) {
          if (other === name || other === m0.active) return;
          blobsFor(recs, (m0.slots[other] || {}).stores || {}, other)
            .forEach(function (r) { keep[blobKey(r)] = true; });
        });
        var purge = doomed.filter(function (r) { return !keep[blobKey(r)]; });
        var m = deleteSlot(store, name);
        return P(purge.length ? ad.deleteMany(manifestOf(purge)) : { deleted: 0 })
          .then(function (res) {
            return {
              meta: m,
              purged: (res && typeof res.deleted === 'number') ? res.deleted : purge.length,
              purgedBytes: blobInventory(purge).bytes,
              shared: doomed.length - purge.length
            };
          });
      });
    });
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
    inventory: inventory,

    /* media — data, pure helpers, and the promise-returning siblings */
    BLOB_DBS: BLOB_DBS,
    BLOB_LIMITS: BLOB_LIMITS,
    specFor: specFor,
    blobKey: blobKey,
    referencedIds: referencedIds,
    blobsFor: blobsFor,
    manifestOf: manifestOf,
    blobInventory: blobInventory,
    missingBlobs: missingBlobs,
    sanitizeBlobs: sanitizeBlobs,
    planBlobUpload: planBlobUpload,
    blobReport: blobReport,
    snapshotBlobs: snapshotBlobs,
    archiveAsync: archiveAsync,
    restoreAsync: restoreAsync,
    saveActiveAsync: saveActiveAsync,
    switchToAsync: switchToAsync,
    newProjectAsync: newProjectAsync,
    deleteSlotAsync: deleteSlotAsync
  };
})(typeof window !== 'undefined' ? window : globalThis);
