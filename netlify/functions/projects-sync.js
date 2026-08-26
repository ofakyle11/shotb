// ═══════════════════════════════════════════════════════════════════════════
// CINAMATE — studio cloud (shared productions)
// Owners push whole productions (vault archives) to the site's Netlify Blobs
// store and pull them from any machine. Auth is the same HMAC-signed owner
// token the gate trusts, read from the cin_owner cookie — anonymous callers
// get nothing.
//
// ENV: OWNER_TOKEN_SECRET   (same secret verify-owner signs with)
//      CIN_API_TOKEN        (Netlify API token — server-side only)
//      CIN_SITE_ID          (this site's id, for the blobs endpoint)
//
// Ops:  GET  ?op=list                  → { productions: [{name, savedAt, savedBy, bytes, blobCount}] }
//       GET  ?op=pull&name=X           → { name, savedAt, savedBy, archive, blobChunks }
//       GET  ?op=pull-blobs&name=X&seq=n → { seq, total, blobs: [...] }
//       POST {op:'push', name, archive, blobChunks?, ifVer?} → { ok, savedAt, ver }  (409 if ver moved)
//       POST {op:'push-blobs', name, seq, total, blobs} → { ok, seq, count, bytes }
//       POST {op:'delete', name}       → { ok, recoverable, deletedBy }
//       GET  ?op=versions&name=X       → { versions: [...], deleted: {...}|null }
//       POST {op:'restore', name, slot?}→ { ok, restoredFrom, mediaVersioned:false }
//
// The archive body carries the localStorage half of a production plus a
// manifest of its media; the bytes travel as separate bounded chunks. See the
// block above MAX_BLOB_RECORD_BYTES for the caps and why they are what they are.
// ═══════════════════════════════════════════════════════════════════════════

const { createHmac, timingSafeEqual } = require('crypto');

const NAMES = ['mz465', 'kz465', 'hz465', 'rz465', 'dz465'];
const STORE = 'cinamate-projects';
const INDEX_KEY = '_index';
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024; // the localStorage half of a project

/* ── media, and why it is chunked ────────────────────────────────────────────
   A production's photographs live in IndexedDB, not localStorage, and they are
   the department's continuity record — they have to travel with the project or
   the archive is a lie. But a single scout JPEG data URL is 100-300 KB, so a
   real production is tens of megabytes and no sane request limit survives it in
   one body.

   So the archive body carries a MANIFEST (ids and sizes) and the bytes go up
   separately, one bounded request per chunk:

     MAX_BLOB_RECORD_BYTES  900 KB   one record. 3x a full-size scout JPEG, and
                                     far below any source master — the cloud
                                     carries stills and short takes on purpose.
     MAX_CHUNK_BYTES        1 MB     one request. Small enough to sit well
                                     inside a function body limit even after
                                     base64 and JSON overhead, and cheap to
                                     retry when a phone drops a connection.
     MAX_BLOB_CHUNKS        48       per production.

   48 x 1 MB IS the 48 MB per-production ceiling: it holds by construction, not
   by a running total that a caller could sidestep. Anything over any of these
   is REFUSED with a message naming the file and offering the .cinamate export,
   which has no limit. A truncated archive that reports success is the exact
   failure this transport exists to remove.                                   */
const MAX_BLOB_RECORD_BYTES = 900 * 1024;
const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_BLOB_CHUNKS = 48;
/* Mirrors BLOB_DBS in projects/lib-vault.js. The client filters too, but the
   client is not the security boundary: these records are written straight into
   another owner's browser storage, so the store an archive may name is an
   allow-list here as well. */
const BLOB_STORES = new Set(['cinamate_wardrobe/photos', 'cinamate_scout/photos', 'cinamate_cut/media']);
const BLOB_DATA_RE = /^data:(?:image\/(?:png|jpe?g|webp|gif|avif)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|mp4|wav|webm|ogg));base64,[A-Za-z0-9+/]*={0,2}$/;
const BLOB_ID_RE = /^[A-Za-z0-9 ._:@#()+-]{1,200}$/;
const blobKey = (name, n) => 'b:' + n + ':' + name;
const kbOf = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

/* A manifest entry: what the archive body records about a file it does not
   itself carry. Bytes are stripped here rather than trusted from the caller. */
function manifestEntry(r) {
  if (!r || typeof r !== 'object') return null;
  const ref = String(r.db) + '/' + String(r.store);
  if (!BLOB_STORES.has(ref)) return null;
  const id = String(r.id == null ? '' : r.id);
  if (!BLOB_ID_RE.test(id)) return null;
  return { db: String(r.db), store: String(r.store), id,
           bytes: Number(r.bytes) || (typeof r.data === 'string' ? r.data.length : 0) };
}
/* How many superseded copies of a production to keep. A single "previous" slot
   was worthless in practice: background auto-sync pushes every few minutes, so
   two quiet cycles pushed the only recoverable copy off the end and a mistake
   made ten minutes ago was already unrecoverable. A ring gives a real window. */
const VERSION_KEEP = 8;
const verKey = (name, n) => 'v:' + n + ':' + name;
const FORMAT = 'cinamate/1';
/* Records that belong to one machine, never to a production — the bridge
   address and its API key, and a personal TMDB key. Mirrors LOCAL_ONLY in
   projects/lib-vault.js; both sides check, because either alone is one
   client bug away from publishing a credential to all five owners. */
const LOCAL_ONLY = /^SB_(LocalGPU|TMDB)_v\d+$/i;

function respond(statusCode, body) {
  return { statusCode, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  return A.length === B.length && timingSafeEqual(A, B);
}

function tokenOwner(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split(':');
  if (parts.length !== 4 || parts[0] !== 'owner') return null;
  const name = String(parts[1]).toLowerCase();
  if (NAMES.indexOf(name) < 0) return null;
  // Signed over the literal field, not a reparsed integer — see gate.js.
  if (!/^\d+$/.test(parts[2])) return null;
  const expires = parseInt(parts[2], 10);
  if (!expires || Date.now() > expires) return null;
  const expect = createHmac('sha256', secret)
    .update('owner:' + parts[1] + ':' + parts[2]).digest('hex');
  return safeEqual(parts[3], expect) ? name : null;
}

/* Every cin_owner the header carries, not just the first. A browser will send
   two cookies of the same name — one set for a narrower path, or set for this
   domain by a subdomain — and it sends the more specific one first. Reading
   the first and stopping meant a planted cookie could stand in front of the
   real session and hide it, signing the owner out of their own studio. Read
   them all and accept whichever verifies: a forged value still cannot verify,
   and a genuine one can no longer be pushed out of the way. The cap keeps an
   enormous header from being turned into work.
   (A __Host-cin_owner cookie could not be set by a subdomain at all, which
   would stop this at the source, but renaming the cookie signs out every live
   session, so that is a separate decision.) */
function cookieTokens(header) {
  const out = [];
  const re = /(?:^|;\s*)cin_owner=([^;]*)/g;
  let m;
  while ((m = re.exec(String(header || ''))) !== null && out.length < 12) {
    if (!m[1]) continue;
    try { out.push(decodeURIComponent(m[1])); } catch (e) { /* not ours */ }
  }
  return out;
}

function ownerFromCookies(header, secret) {
  const seen = cookieTokens(header);
  for (let i = 0; i < seen.length; i++) {
    const who = tokenOwner(seen[i], secret);
    if (who) return who;
  }
  return null;
}

function blobUrl(key) {
  return 'https://api.netlify.com/api/v1/blobs/' +
    process.env.CIN_SITE_ID + '/' + STORE + (key ? '/' + encodeURIComponent(key) : '');
}
async function blob(method, key, body) {
  const res = await fetch(blobUrl(key), {
    method,
    redirect: 'follow',
    headers: {
      Authorization: 'Bearer ' + process.env.CIN_API_TOKEN,
      ...(body != null ? { 'Content-Type': 'application/json' } : {})
    },
    body: body != null ? body : undefined
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

/* Returns {productions, trusted}. `trusted` is false when the catalog could
   not be read (transport error, unparseable body) as opposed to genuinely
   being empty. Writers MUST refuse to persist an untrusted index: doing so
   would replace the catalog of every owner's productions with whatever one
   request happened to know about. A 404 is a real empty catalog and trusted. */
async function readIndex() {
  const r = await blob('GET', INDEX_KEY);
  if (!r.ok) {
    if (r.status === 404) return { productions: {}, trusted: true };
    return { productions: {}, trusted: false };
  }
  try {
    const j = JSON.parse(r.text);
    if (j && j.productions) return { productions: j.productions, trusted: true };
    return { productions: {}, trusted: true };
  } catch (e) { return { productions: {}, trusted: false }; }
}
async function writeIndex(idx) {
  if (idx && idx.trusted === false) return false;   // never overwrite a catalog we failed to read
  await blob('PUT', INDEX_KEY, JSON.stringify({ productions: idx.productions }));
  return true;
}

function cleanName(name) {
  let n = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')   // control chars never belong in a title
    /* Invisible characters. Two productions whose titles differ only by a
       zero-width space render identically in the Projects list, and in a
       namespace where every owner's delete and restore act on everyone's
       copy, "which of these two identical rows did I just delete" is not a
       question anybody should have to answer. */
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')                    // a non-breaking space reads as a space
    .trim().slice(0, 80)
    /* slice() counts UTF-16 units, so an 80th character that is half of an
       emoji leaves a lone surrogate behind. encodeURIComponent THROWS on one,
       and the blob key is built with it — so every cloud operation for that
       production becomes a 502, its auto-backup dies, and the message blames
       the network. */
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, '')
    .replace(/(^|[^\ud800-\udbff])([\udc00-\udfff])/g, '$1')
    .trim();
  if (!n || n === INDEX_KEY) return null;
  if (/^(p:|prev:|v:|b:|tomb:|_)/.test(n)) return null;  // never let a title impersonate a reserved key
  if (n === '__proto__' || n === 'constructor' || n === 'prototype') return null;
  /* Proof rather than assumption: if it cannot be encoded it cannot be a blob
     key, and finding that out here beats finding it out at the fetch. */
  try { encodeURIComponent(n); } catch (e) { return null; }
  return n;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  const secret = process.env.OWNER_TOKEN_SECRET;
  if (!secret || !process.env.CIN_API_TOKEN || !process.env.CIN_SITE_ID) {
    return respond(500, { error: 'Studio cloud not configured on server' });
  }
  const headers = event.headers || {};
  const owner = ownerFromCookies(headers.cookie || headers.Cookie, secret);
  if (!owner) return respond(401, { error: 'Sign in to use the studio cloud' });

  const q = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST') {
    /* SameSite=Lax already keeps the cookie off cross-site POSTs; this is the
       belt to that suspenders. A same-origin request either sends our own
       Origin or (some clients) none at all — anything else is not ours. */
    const origin = headers.origin || headers.Origin || '';
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { host = 'invalid'; }
      const self = headers.host || headers.Host || '';
      if (host !== self) return respond(403, { error: 'Cross-site request refused' });
    }
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return respond(400, { error: 'Invalid JSON body' }); }
  }
  const op = body.op || q.op;

  try {
    if (op === 'list') {
      const idx = await readIndex();
      if (!idx.trusted) return respond(502, { error: 'Could not read the studio cloud catalog — try again' });
      const productions = Object.keys(idx.productions).sort().map((n) => {
        const p = idx.productions[n] || {};
        return { name: n, savedAt: p.savedAt || '', savedBy: p.savedBy || '',
                 bytes: p.bytes || 0, ver: typeof p.ver === 'number' ? p.ver : 0,
                 blobCount: p.blobCount || 0, blobBytes: p.blobBytes || 0,
                 blobChunks: p.blobChunks || 0 };
      });
      return respond(200, { productions });
    }

    if (op === 'pull') {
      const name = cleanName(q.name || body.name);
      if (!name) return respond(400, { error: 'name required' });
      const r = await blob('GET', 'p:' + name);
      if (!r.ok) return respond(404, { error: 'No cloud production named "' + name + '"' });
      let env2;
      try { env2 = JSON.parse(r.text); } catch (e) { return respond(500, { error: 'Stored production unreadable' }); }
      return respond(200, { name, savedAt: env2.savedAt || '', savedBy: env2.savedBy || '',
        archive: env2.archive,
        blobChunks: Number(env2.blobChunks) || 0,
        blobCount: Number(env2.blobCount) || 0,
        blobBytes: Number(env2.blobBytes) || 0 });
    }

    /* One chunk of the media that goes with a production. Kept out of the
       archive body so neither ever approaches a request limit. */
    if (op === 'pull-blobs') {
      const name = cleanName(q.name || body.name);
      if (!name) return respond(400, { error: 'name required' });
      const seq = Number(q.seq != null ? q.seq : body.seq);
      if (!Number.isInteger(seq) || seq < 0 || seq >= MAX_BLOB_CHUNKS) {
        return respond(400, { error: 'seq must be a whole number from 0 to ' + (MAX_BLOB_CHUNKS - 1) });
      }
      const r = await blob('GET', blobKey(name, seq));
      if (!r.ok) {
        /* An absent chunk is a hole in the production, not an empty one. Say
           so: the caller has to be able to tell "no media" from "the media did
           not all arrive". */
        return respond(404, { error: 'Part ' + (seq + 1) + ' of "' + name + '" is not in the studio cloud — ' +
          'that production did not finish uploading its media' });
      }
      let chunk;
      try { chunk = JSON.parse(r.text); } catch (e) { return respond(500, { error: 'Stored media part unreadable' }); }
      return respond(200, { name, seq, total: chunk.total, blobs: chunk.blobs || [] });
    }

    if (op === 'push-blobs') {
      const name = cleanName(body.name);
      if (!name) return respond(400, { error: 'name required' });
      const seq = Number(body.seq), total = Number(body.total);
      if (!Number.isInteger(total) || total < 1 || total > MAX_BLOB_CHUNKS) {
        return respond(413, { error: 'This production needs ' + (Number.isInteger(total) ? total : '?') +
          ' media parts; the studio cloud takes at most ' + MAX_BLOB_CHUNKS +
          ' (' + kbOf(MAX_BLOB_CHUNKS * MAX_CHUNK_BYTES) + ' per production). ' +
          'Nothing was saved — export a .cinamate backup instead, which has no size limit.' });
      }
      if (!Number.isInteger(seq) || seq < 0 || seq >= total) {
        return respond(400, { error: 'seq must be a whole number from 0 to ' + (total - 1) });
      }
      const list = Array.isArray(body.blobs) ? body.blobs : null;
      if (!list || !list.length) return respond(400, { error: 'That media part carried no files' });
      const clean = [];
      let bytes = 0;
      for (const r of list) {
        const ref = r && typeof r === 'object' ? String(r.db) + '/' + String(r.store) : '';
        if (!BLOB_STORES.has(ref)) {
          return respond(400, { error: 'A file in that part names a store this platform does not have — nothing was saved' });
        }
        const id = String(r.id == null ? '' : r.id);
        if (!BLOB_ID_RE.test(id)) {
          return respond(400, { error: 'A file in that part has an unusable id — nothing was saved' });
        }
        const data = String(r.data == null ? '' : r.data);
        if (!BLOB_DATA_RE.test(data)) {
          return respond(400, { error: '"' + id + '" is not an image, audio or video file — nothing was saved' });
        }
        if (data.length > MAX_BLOB_RECORD_BYTES) {
          return respond(413, { error: '"' + id + '" is ' + kbOf(data.length) + ' on its own. The studio cloud ' +
            'carries stills and short takes, not source masters (limit ' + kbOf(MAX_BLOB_RECORD_BYTES) +
            ' each). Nothing was saved — export a .cinamate backup instead, which has no size limit.' });
        }
        bytes += data.length;
        clean.push({ db: String(r.db), store: String(r.store), id, data,
                     project: String(r.project == null ? '' : r.project).slice(0, 200),
                     bytes: data.length });
      }
      const payload = JSON.stringify({ seq, total, savedBy: owner, blobs: clean });
      if (payload.length > MAX_CHUNK_BYTES) {
        return respond(413, { error: 'That media part is ' + kbOf(payload.length) + '; the studio cloud takes ' +
          kbOf(MAX_CHUNK_BYTES) + ' per part. Nothing was saved — export a .cinamate backup instead.' });
      }
      const w = await blob('PUT', blobKey(name, seq), payload);
      if (!w.ok) return respond(502, { error: 'Cloud store rejected media part ' + (seq + 1) + ' (' + w.status + ')' });
      return respond(200, { ok: true, name, seq, total, count: clean.length, bytes });
    }

    if (op === 'push') {
      const name = cleanName(body.name);
      if (!name) return respond(400, { error: 'name required' });
      const archive = body.archive;
      let parsed;
      try { parsed = typeof archive === 'string' ? JSON.parse(archive) : archive; }
      catch (e) { return respond(400, { error: 'archive is not valid JSON' }); }
      if (!parsed || parsed.format !== FORMAT || !parsed.stores || typeof parsed.stores !== 'object') {
        return respond(400, { error: 'Not a Cinamate project archive' });
      }
      for (const k of Object.keys(parsed.stores)) {
        if (!/^SB_[A-Za-z0-9]+_v\d+$/.test(k)) { delete parsed.stores[k]; continue; } // never store foreign keys
        /* Machine-local records, not production data. SB_LocalGPU holds this
           workstation's bridge address and its API key; SB_TMDB holds a
           personal API key. The client already leaves them out of a snapshot,
           but the client is not the security boundary — anything that can
           reach this endpoint can name its own stores, and this blob store is
           read by all five owners. Refused here as well. */
        if (LOCAL_ONLY.test(k)) delete parsed.stores[k];
      }
      /* An archive with nothing in it is not a save, it is an erase: the
         reader's vault clears the workspace before writing what arrived. A
         push that filtered down to zero stores means the caller sent junk, so
         say so rather than storing an empty production over a real one. */
      if (!Object.keys(parsed.stores).length) {
        return respond(400, { error: 'That archive contains no production data — refusing to save an empty project over "' + name + '"' });
      }

      /* The archive body carries the media MANIFEST, never the bytes: those go
         up through push-blobs, one bounded request each. Stripping here rather
         than trusting the caller means a client that forgets cannot push a
         30 MB body and cannot leave a half-embedded, half-referenced archive in
         the shared store. */
      let manifest = [];
      if (parsed.blobs != null) {
        if (!Array.isArray(parsed.blobs)) {
          return respond(400, { error: 'That archive’s media section is unreadable — nothing was saved' });
        }
        manifest = parsed.blobs.map(manifestEntry).filter(Boolean);
      }
      parsed.blobs = manifest;
      const blobCount = manifest.length;
      const blobBytes = manifest.reduce((a, r) => a + (Number(r.bytes) || 0), 0);
      const declared = Number(body.blobChunks);
      const blobChunks = Number.isInteger(declared) && declared >= 0 ? declared : 0;
      if (blobChunks > MAX_BLOB_CHUNKS) {
        return respond(413, { error: 'This production needs ' + blobChunks + ' media parts; the studio cloud ' +
          'takes at most ' + MAX_BLOB_CHUNKS + ' (' + kbOf(MAX_BLOB_CHUNKS * MAX_CHUNK_BYTES) +
          ' per production). Nothing was saved — export a .cinamate backup instead, which has no size limit.' });
      }
      if (blobCount && !blobChunks) {
        return respond(400, { error: 'That archive lists ' + blobCount + ' media file(s) but declares no parts to ' +
          'carry them. Nothing was saved — a production that arrives without its photographs must not look complete.' });
      }

      const payload = JSON.stringify(parsed);
      if (payload.length > MAX_ARCHIVE_BYTES) {
        return respond(413, { error: 'The written record of this production is ' + kbOf(payload.length) +
          '; the studio cloud takes ' + kbOf(MAX_ARCHIVE_BYTES) + ' (photos and media travel separately and do ' +
          'not count towards it). Nothing was saved — export a .cinamate backup instead, which has no size limit.' });
      }
      const savedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const idxBefore = await readIndex();
      const known = idxBefore.trusted ? idxBefore.productions[name] : null;

      /* Optimistic concurrency: a caller may declare which version it believes
         it is replacing. If the cloud has moved on since, refuse rather than
         bury the newer save — a stale tab must not silently win.

         This compares the version counter, not savedAt. Timestamps here have
         minute granularity, so two saves inside the same minute look identical
         and the check would pass exactly when a collision is most likely. */
      const knownVer = (known && typeof known.ver === 'number') ? known.ver : 0;
      if (body.ifVer != null && Number(body.ifVer) !== knownVer) {
        return respond(409, {
          error: 'This production changed in the cloud since you loaded it',
          savedAt: known && known.savedAt, savedBy: known && known.savedBy, ver: knownVer,
        });
      }

      /* Keep the copy being replaced, in a rotating ring so routine autosaves
         cannot push a genuine mistake out of reach. */
      const prior = await blob('GET', 'p:' + name);
      if (prior.ok && prior.text) {
        const nextVer = ((known && typeof known.ver === 'number') ? known.ver : 0) + 1;
        await blob('PUT', verKey(name, nextVer % VERSION_KEEP), prior.text);
      }
      const ver = ((known && typeof known.ver === 'number') ? known.ver : 0) + 1;
      const w = await blob('PUT', 'p:' + name,
        JSON.stringify({ savedAt, savedBy: owner, ver, archive: payload, blobChunks, blobCount, blobBytes }));
      if (!w.ok) return respond(502, { error: 'Cloud store rejected the save (' + w.status + ')' });
      /* Media parts left over from a larger previous save are not this
         production any more. Left in place they would be handed back on the
         next pull as if they belonged. Only the range the previous save
         actually claimed is swept — a blind sweep of all 48 would put 48
         requests on the wire behind every push. */
      const hadChunks = Math.min(MAX_BLOB_CHUNKS,
        Math.max(0, Number(known && known.blobChunks) || 0));
      for (let n = blobChunks; n < hadChunks; n++) await blob('DELETE', blobKey(name, n));
      const idx = await readIndex();
      if (!idx.trusted) {
        return respond(200, { ok: true, savedAt, savedBy: owner, ver, blobChunks, blobCount,
          warning: 'Saved, but the catalog could not be updated — it will re-list on the next successful save.' });
      }
      idx.productions[name] = { savedAt, savedBy: owner, bytes: payload.length, ver,
        blobCount, blobBytes, blobChunks };
      await writeIndex(idx);
      return respond(200, { ok: true, savedAt, savedBy: owner, ver, blobChunks, blobCount, blobBytes });
    }

    if (op === 'delete') {
      const name = cleanName(body.name);
      if (!name) return respond(400, { error: 'name required' });
      /* Soft delete: the bytes move into the version ring rather than
         evaporating, so a wrong click does not destroy a production. */
      const idxNow = await readIndex();
      const meta = idxNow.trusted ? idxNow.productions[name] : null;
      const cur = await blob('GET', 'p:' + name);
      let keptVer = null;
      if (cur.ok && cur.text) {
        keptVer = ((meta && typeof meta.ver === 'number') ? meta.ver : 0) + 1;
        await blob('PUT', verKey(name, keptVer % VERSION_KEEP), cur.text);
        /* Remember what was deleted and by whom — a production that vanishes
           from the catalog with no trace is indistinguishable from one that
           was never there, and nobody can tell whose mistake to undo. */
        await blob('PUT', 'tomb:' + name, JSON.stringify({
          deletedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          deletedBy: owner, ver: keptVer,
          savedAt: meta && meta.savedAt, savedBy: meta && meta.savedBy,
        }));
      }
      await blob('DELETE', 'p:' + name);
      if (idxNow.trusted) {
        delete idxNow.productions[name];
        await writeIndex(idxNow);
      }
      return respond(200, { ok: true, recoverable: cur.ok, deletedBy: owner });
    }

    if (op === 'versions') {
      const name = cleanName(q.name || body.name);
      if (!name) return respond(400, { error: 'name required' });
      /* Nothing else enumerates the ring, so a deleted production was
         unrecoverable in practice: you cannot restore what you cannot see. */
      const out = [];
      for (let n = 0; n < VERSION_KEEP; n++) {
        const r = await blob('GET', verKey(name, n));
        if (!r.ok || !r.text) continue;
        try {
          const v = JSON.parse(r.text);
          out.push({ slot: n, savedAt: v.savedAt || '', savedBy: v.savedBy || '',
                     ver: v.ver || null, bytes: (v.archive || '').length });
        } catch (e) { /* unreadable slot — skip */ }
      }
      let tomb = null;
      const tr = await blob('GET', 'tomb:' + name);
      if (tr.ok && tr.text) { try { tomb = JSON.parse(tr.text); } catch (e) { /* ignore */ } }
      out.sort((a2, b2) => String(b2.savedAt).localeCompare(String(a2.savedAt)));
      return respond(200, { name, versions: out, deleted: tomb });
    }

    if (op === 'restore') {
      const name = cleanName(body.name);
      if (!name) return respond(400, { error: 'name required' });
      const slot = Number.isInteger(body.slot) ? body.slot : null;

      let prev = null;
      if (slot !== null) {
        const r = await blob('GET', verKey(name, slot));
        if (r.ok && r.text) prev = r.text;
      } else {
        /* No slot named: take the most recent copy in the ring. */
        let best = null;
        for (let n = 0; n < VERSION_KEEP; n++) {
          const r = await blob('GET', verKey(name, n));
          if (!r.ok || !r.text) continue;
          try {
            const v = JSON.parse(r.text);
            if (!best || String(v.savedAt || '') > String(best.savedAt || '')) best = { ...v, _raw: r.text };
          } catch (e) { /* skip */ }
        }
        if (best) prev = best._raw;
      }
      if (!prev) return respond(404, { error: 'No earlier copy of "' + name + '" is on file' });

      /* Restoring is itself destructive — it replaces whatever is live now.
         Keep that too, or "undo" becomes a second way to lose work. */
      const idxNow = await readIndex();
      const meta0 = idxNow.trusted ? idxNow.productions[name] : null;
      const live = await blob('GET', 'p:' + name);
      if (live.ok && live.text) {
        const n2 = ((meta0 && typeof meta0.ver === 'number') ? meta0.ver : 0) + 1;
        await blob('PUT', verKey(name, n2 % VERSION_KEEP), live.text);
      }

      const w = await blob('PUT', 'p:' + name, prev);
      if (!w.ok) return respond(502, { error: 'Cloud store rejected the restore (' + w.status + ')' });
      let meta = {};
      try { meta = JSON.parse(prev) || {}; } catch (e) { /* keep defaults */ }
      const savedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const idx = await readIndex();
      if (idx.trusted) {
        /* Attribute the restore to whoever performed it, and keep the original
           author beside it — the old code stamped the restorer's name onto
           someone else's work, which is a lie the catalog then repeated. */
        idx.productions[name] = {
          savedAt, savedBy: owner,
          restoredFrom: { savedAt: meta.savedAt || '', savedBy: meta.savedBy || '' },
          bytes: (meta.archive || '').length,
          ver: ((meta0 && typeof meta0.ver === 'number') ? meta0.ver : 0) + 2,
        };
        await writeIndex(idx);
      }
      await blob('DELETE', 'tomb:' + name);
      return respond(200, { ok: true, savedAt, savedBy: owner,
        restoredFrom: { savedAt: meta.savedAt || '', savedBy: meta.savedBy || '' } });
    }

    return respond(400, { error: 'Unknown op' });
  } catch (e) {
    return respond(502, { error: 'Cloud storage unreachable — try again' });
  }
};
