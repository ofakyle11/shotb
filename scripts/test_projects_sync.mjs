#!/usr/bin/env node
/* Node tests for netlify/functions/projects-sync.js — run: node scripts/test_projects_sync.mjs */
import { createHmac } from 'crypto';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SECRET = 'sync-secret';
process.env.OWNER_TOKEN_SECRET = SECRET;
process.env.CIN_API_TOKEN = 'nfp_test';
process.env.CIN_SITE_ID = 'site123';

/* mock the blobs REST API with an in-memory store */
const blobs = new Map();
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  t('blob calls carry the api token', opts.headers.Authorization === 'Bearer nfp_test');
  const m = u.pathname.match(/^\/api\/v1\/blobs\/site123\/cinamate-projects(?:\/(.+))?$/);
  if (!m) return { ok: false, status: 404, text: async () => 'bad path' };
  const key = m[1] ? decodeURIComponent(m[1]) : null;
  const method = opts.method || 'GET';
  if (method === 'PUT') { blobs.set(key, String(opts.body)); return { ok: true, status: 201, text: async () => '' }; }
  if (method === 'DELETE') { blobs.delete(key); return { ok: true, status: 204, text: async () => '' }; }
  if (key) {
    return blobs.has(key)
      ? { ok: true, status: 200, text: async () => blobs.get(key) }
      : { ok: false, status: 404, text: async () => 'not found' };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ blobs: [] }) };
};

const { handler } = require_(join(ROOT, 'netlify/functions/projects-sync.js'));

function mint(name, expires) {
  const payload = `owner:${name}:${expires}`;
  return payload + ':' + createHmac('sha256', SECRET).update(payload).digest('hex');
}
const good = mint('kz465', Date.now() + 3600000);
function ev(method, query, body, cookie) {
  return { httpMethod: method, queryStringParameters: query || {},
    body: body ? JSON.stringify(body) : null,
    headers: cookie === undefined ? { cookie: 'cin_owner=' + encodeURIComponent(good) } : (cookie ? { cookie } : {}) };
}
const j = (r) => JSON.parse(r.body);

/* auth */
let r = await handler(ev('GET', { op: 'list' }, null, null));
t('anon → 401', r.statusCode === 401);
r = await handler(ev('GET', { op: 'list' }, null, 'cin_owner=' + mint('kz465', Date.now() - 5)));
t('expired token → 401', r.statusCode === 401);

/* empty list */
r = await handler(ev('GET', { op: 'list' }));
t('empty cloud lists nothing', r.statusCode === 200 && j(r).productions.length === 0);

/* push validation */
r = await handler(ev('POST', null, { op: 'push', name: 'X', archive: '{"nope":1}' }));
t('non-archive rejected', r.statusCode === 400);
r = await handler(ev('POST', null, { op: 'push', archive: '{}' }));
t('missing name rejected', r.statusCode === 400);

const archive = JSON.stringify({ format: 'cinamate/1', name: 'Night Harvest', savedAt: 'x',
  stores: { SB_Timeline_v1: '{"title":"Night Harvest"}', EVIL_key: 'nope' } });
r = await handler(ev('POST', null, { op: 'push', name: 'Night Harvest', archive }));
t('push ok with savedBy', r.statusCode === 200 && j(r).savedBy === 'kz465');
t('foreign keys stripped from stored archive', !blobs.get('p:Night Harvest').includes('EVIL_key'));
t('SB keys kept', blobs.get('p:Night Harvest').includes('SB_Timeline_v1'));

/* list reflects index */
r = await handler(ev('GET', { op: 'list' }));
let L = j(r).productions;
t('list shows pushed production with meta', L.length === 1 && L[0].name === 'Night Harvest' && L[0].savedBy === 'kz465' && L[0].bytes > 0);

/* pull round-trip */
r = await handler(ev('GET', { op: 'pull', name: 'Night Harvest' }));
t('pull returns archive', r.statusCode === 200 && JSON.parse(j(r).archive).stores.SB_Timeline_v1.includes('Night Harvest'));
r = await handler(ev('GET', { op: 'pull', name: 'Ghost' }));
t('pull missing → 404', r.statusCode === 404);

/* size cap */
const big = JSON.stringify({ format: 'cinamate/1', name: 'Big', savedAt: '',
  stores: { SB_Big_v1: 'x'.repeat(4 * 1024 * 1024 + 10) } });
r = await handler(ev('POST', null, { op: 'push', name: 'Big', archive: big }));
t('oversize push → 413', r.statusCode === 413);

/* delete */
r = await handler(ev('POST', null, { op: 'delete', name: 'Night Harvest' }));
t('delete ok', r.statusCode === 200);
r = await handler(ev('GET', { op: 'list' }));
t('list empty after delete', j(r).productions.length === 0);
t('blob really gone', !blobs.has('p:Night Harvest'));

/* ── media survival: the two bugs that destroyed photographs ──────────
   Neither had a test, which is why both shipped. The first was found by an
   adversarial reviewer executing the real handler; the second by reading the
   delete branch and noticing what it does NOT do. */
{
  const B64 = 'data:image/png;base64,iVBORw0KGgo=';
  const mkArchive = (blobs_) => JSON.stringify({
    format: 'cinamate/1', name: 'Dust Bowl', savedAt: 'x',
    stores: { SB_Timeline_v1: '{"title":"Dust Bowl"}' }, blobs: blobs_ });
  const manifest = [{ db: 'cinamate_scout', store: 'photos', id: 'ph1', bytes: 30 }];

  /* A deliberate save that carries one photograph. */
  r = await handler(ev('POST', null, { op: 'push', name: 'Dust Bowl',
    archive: mkArchive(manifest), blobChunks: 1 }));
  t('media push accepted', r.statusCode === 200 && j(r).blobChunks === 1);
  r = await handler(ev('POST', null, { op: 'push-blobs', name: 'Dust Bowl', seq: 0, total: 1,
    blobs: [{ db: 'cinamate_scout', store: 'photos', id: 'ph1', data: B64 }] }));
  t('media chunk stored', r.statusCode === 200 && blobs.has('b:0:Dust Bowl'));

  /* THE BUG: the background auto-sync pushes text only — no `blobs`, no
     `blobChunks` — and the server read that silence as "this production has no
     media", sweeping every chunk four minutes after the save. */
  r = await handler(ev('POST', null, { op: 'push', name: 'Dust Bowl',
    archive: JSON.stringify({ format: 'cinamate/1', name: 'Dust Bowl', savedAt: 'auto',
      stores: { SB_Timeline_v1: '{"title":"Dust Bowl v2"}' } }) }));
  t('media-silent push succeeds', r.statusCode === 200);
  t('media-silent push does NOT delete the chunks', blobs.has('b:0:Dust Bowl'));
  t('media-silent push carries the chunk count forward', j(r).blobChunks === 1);
  t('media-silent push carries the manifest forward',
    JSON.parse(JSON.parse(blobs.get('p:Dust Bowl')).archive).blobs.length === 1);
  t('media-silent push still saved the new text',
    blobs.get('p:Dust Bowl').includes('Dust Bowl v2'));

  /* An EXPLICIT zero is a real statement and must still clear the old parts —
     otherwise removing every photo from a production would leave them uploaded
     forever. This is the half the fix must not break. */
  r = await handler(ev('POST', null, { op: 'push', name: 'Dust Bowl',
    archive: mkArchive([]), blobChunks: 0 }));
  t('an explicit blobChunks:0 still sweeps', r.statusCode === 200 && !blobs.has('b:0:Dust Bowl'));

  /* THE SECOND BUG: delete removed the record and the catalog entry but left
     the chunks at their own keys, so pull-blobs still served the photographs of
     a production its owner believed was gone. */
  r = await handler(ev('POST', null, { op: 'push', name: 'Reservoir',
    archive: JSON.stringify({ format: 'cinamate/1', name: 'Reservoir', savedAt: 'x',
      stores: { SB_Timeline_v1: '{}' }, blobs: manifest }), blobChunks: 1 }));
  await handler(ev('POST', null, { op: 'push-blobs', name: 'Reservoir', seq: 0, total: 1,
    blobs: [{ db: 'cinamate_scout', store: 'photos', id: 'ph1', data: B64 }] }));
  t('second production has media', blobs.has('b:0:Reservoir'));
  r = await handler(ev('POST', null, { op: 'delete', name: 'Reservoir' }));
  t('delete sweeps the media chunks', !blobs.has('b:0:Reservoir'));
  t('delete reports what it removed', j(r).mediaDeleted === 1);
  t('delete keeps the text recoverable', j(r).recoverable === true);

  /* And a restore must not then advertise photographs that deletion removed. */
  r = await handler(ev('POST', null, { op: 'restore', name: 'Reservoir' }));
  t('restore succeeds after a media sweep', r.statusCode === 200);
  t('restore admits the media was swept', j(r).mediaSweptOnDelete === true);
  t('restore does not claim media it cannot produce', j(r).blobCount === 0);
}

r = await handler(ev('GET', { op: 'zap' }));
t('unknown op → 400', r.statusCode === 400);

console.log(`test_projects_sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
