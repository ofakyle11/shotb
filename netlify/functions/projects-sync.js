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
// Ops:  GET  ?op=list                  → { productions: [{name, savedAt, savedBy, bytes}] }
//       GET  ?op=pull&name=X           → { name, savedAt, savedBy, archive }
//       POST {op:'push', name, archive, ifVer?} → { ok, savedAt, ver }  (409 if ver moved)
//       POST {op:'delete', name}       → { ok, recoverable, deletedBy }
//       GET  ?op=versions&name=X       → { versions: [...], deleted: {...}|null }
//       POST {op:'restore', name, slot?}→ { ok, restoredFrom }
// ═══════════════════════════════════════════════════════════════════════════

const { createHmac, timingSafeEqual } = require('crypto');

const NAMES = ['mz465', 'kz465', 'hz465', 'rz465', 'dz465'];
const STORE = 'cinamate-projects';
const INDEX_KEY = '_index';
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024; // localStorage-sized projects, not media
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
  const expires = parseInt(parts[2], 10);
  if (!expires || Date.now() > expires) return null;
  const expect = createHmac('sha256', secret)
    .update('owner:' + parts[1] + ':' + expires).digest('hex');
  return safeEqual(parts[3], expect) ? name : null;
}

function cookieToken(header) {
  const m = /(?:^|;\s*)cin_owner=([^;]+)/.exec(String(header || ''));
  try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
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
  const n = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')   // control chars never belong in a title
    .trim().slice(0, 80);
  if (!n || n === INDEX_KEY) return null;
  if (/^(p:|prev:|v:|tomb:|_)/.test(n)) return null;  // never let a title impersonate a reserved key
  if (n === '__proto__' || n === 'constructor' || n === 'prototype') return null;
  return n;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  const secret = process.env.OWNER_TOKEN_SECRET;
  if (!secret || !process.env.CIN_API_TOKEN || !process.env.CIN_SITE_ID) {
    return respond(500, { error: 'Studio cloud not configured on server' });
  }
  const headers = event.headers || {};
  const owner = tokenOwner(cookieToken(headers.cookie || headers.Cookie), secret);
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
                 bytes: p.bytes || 0, ver: typeof p.ver === 'number' ? p.ver : 0 };
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
      return respond(200, { name, savedAt: env2.savedAt || '', savedBy: env2.savedBy || '', archive: env2.archive });
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
      const payload = JSON.stringify(parsed);
      if (payload.length > MAX_ARCHIVE_BYTES) {
        return respond(413, { error: 'Production too large for the cloud (4 MB limit) — export a file instead' });
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
        JSON.stringify({ savedAt, savedBy: owner, ver, archive: payload }));
      if (!w.ok) return respond(502, { error: 'Cloud store rejected the save (' + w.status + ')' });
      const idx = await readIndex();
      if (!idx.trusted) {
        return respond(200, { ok: true, savedAt, savedBy: owner, ver,
          warning: 'Saved, but the catalog could not be updated — it will re-list on the next successful save.' });
      }
      idx.productions[name] = { savedAt, savedBy: owner, bytes: payload.length, ver };
      await writeIndex(idx);
      return respond(200, { ok: true, savedAt, savedBy: owner, ver });
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
