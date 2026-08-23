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
//       POST {op:'push', name, archive}→ { ok, savedAt }
//       POST {op:'delete', name}       → { ok }
// ═══════════════════════════════════════════════════════════════════════════

const { createHmac, timingSafeEqual } = require('crypto');

const NAMES = ['mz465', 'kz465', 'hz465', 'rz465', 'dz465'];
const STORE = 'cinamate-projects';
const INDEX_KEY = '_index';
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024; // localStorage-sized projects, not media
const FORMAT = 'cinamate/1';

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

async function readIndex() {
  const r = await blob('GET', INDEX_KEY);
  if (!r.ok) return { productions: {} };
  try {
    const j = JSON.parse(r.text);
    return j && j.productions ? j : { productions: {} };
  } catch (e) { return { productions: {} }; }
}
async function writeIndex(idx) {
  await blob('PUT', INDEX_KEY, JSON.stringify(idx));
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, 80);
  if (!n || n === INDEX_KEY) return null;
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
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return respond(400, { error: 'Invalid JSON body' }); }
  }
  const op = body.op || q.op;

  try {
    if (op === 'list') {
      const idx = await readIndex();
      const productions = Object.keys(idx.productions).sort().map((n) => {
        const p = idx.productions[n] || {};
        return { name: n, savedAt: p.savedAt || '', savedBy: p.savedBy || '', bytes: p.bytes || 0 };
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
        if (!/^SB_[A-Za-z0-9]+_v\d+$/.test(k)) delete parsed.stores[k]; // never store foreign keys
      }
      const payload = JSON.stringify(parsed);
      if (payload.length > MAX_ARCHIVE_BYTES) {
        return respond(413, { error: 'Production too large for the cloud (4 MB limit) — export a file instead' });
      }
      const savedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const w = await blob('PUT', 'p:' + name,
        JSON.stringify({ savedAt, savedBy: owner, archive: payload }));
      if (!w.ok) return respond(502, { error: 'Cloud store rejected the save (' + w.status + ')' });
      const idx = await readIndex();
      idx.productions[name] = { savedAt, savedBy: owner, bytes: payload.length };
      await writeIndex(idx);
      return respond(200, { ok: true, savedAt, savedBy: owner });
    }

    if (op === 'delete') {
      const name = cleanName(body.name);
      if (!name) return respond(400, { error: 'name required' });
      await blob('DELETE', 'p:' + name);
      const idx = await readIndex();
      delete idx.productions[name];
      await writeIndex(idx);
      return respond(200, { ok: true });
    }

    return respond(400, { error: 'Unknown op' });
  } catch (e) {
    return respond(502, { error: 'Cloud storage unreachable — try again' });
  }
};
