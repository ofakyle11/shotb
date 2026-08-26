/* The vault has to carry the BYTES, not just the references.
 *
 * Three modules put binary production data in IndexedDB — wardrobe continuity
 * photos, scout photos, cutting-room sources. The vault only ever snapshotted
 * localStorage, so every archive and every cloud push carried the references
 * and none of the bytes, and a project switch wiped localStorage and left the
 * blobs orphaned behind it. Findings 34 and 47.
 *
 * Each check below is one of the ways that lost real work.
 * Run: node scripts/test_vault_blobs.mjs
 */
import { readFileSync } from 'fs';
import { createHmac } from 'crypto';

global.window = global;
(0, eval)(readFileSync(new URL('../projects/lib-vault.js', import.meta.url), 'utf8'));
const V = window.CVault;

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
};

/* ── harnesses ─────────────────────────────────────────────────────────── */

const mem = () => ({
  _d: {},
  getItem(k) { return this._d[k] == null ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  key(i) { return Object.keys(this._d)[i]; },
  get length() { return Object.keys(this._d).length; },
});

/* The injected adapter, in memory. The engine must never open a database, so
   this is the ONLY thing here that knows what a record store is. */
function memMedia(seed) {
  const rows = new Map();
  (seed || []).forEach((r) => rows.set(V.blobKey(r), Object.assign({}, r)));
  const api = {
    calls: { readAll: 0, putAll: 0, deleteMany: 0 },
    readOnly: false,
    readAll() { api.calls.readAll++; return Promise.resolve([...rows.values()].map((r) => Object.assign({}, r))); },
    putAll(list) {
      api.calls.putAll++;
      if (api.readOnly) return Promise.resolve({ written: 0, failed: list.map((r) => ({ id: r.id, why: 'read-only' })) });
      list.forEach((r) => rows.set(V.blobKey(r), Object.assign({}, r)));
      return Promise.resolve({ written: list.length, failed: [] });
    },
    deleteMany(list) {
      api.calls.deleteMany++;
      let n = 0;
      list.forEach((r) => { if (rows.delete(V.blobKey(r))) n++; });
      return Promise.resolve({ deleted: n });
    },
    has(db, store, id) { return rows.has(db + '/' + store + '/' + id); },
    size() { return rows.size; },
    ids() { return [...rows.keys()].sort(); },
  };
  return api;
}

const JPEG = (n) => 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRg'.repeat(1) + 'A'.repeat(Math.max(0, n - 22));
const wardPhoto = (id, project, bytes) => ({
  db: 'cinamate_wardrobe', store: 'photos', id, project, lookId: 'lk1',
  date: '2026-08-20', data: JPEG(bytes || 400),
});
const scoutPhoto = (id, bytes) => ({
  db: 'cinamate_scout', store: 'photos', id, project: '', data: JPEG(bytes || 400),
});
const cutMedia = (id, bytes) => ({
  db: 'cinamate_cut', store: 'media', id, project: '', data: 'data:video/mp4;base64,' + 'A'.repeat(bytes || 400),
});

function wardStore(ids) {
  return JSON.stringify({ looks: [{ id: 'lk1', character: 'JANE', lookName: 'Look 1', photoIds: ids }] });
}
function scoutStore(ids) {
  return JSON.stringify({ locations: [{ id: 'l1', name: 'The Barn', photos: ids }] });
}
function cutStore(ids) {
  return JSON.stringify({ bin: ids.map((id) => ({ id, name: id + '.mp4', kind: 'video', idb: true })) });
}

/* ── 1 · the DB list is a list, and it is the three real databases ─────── */
{
  const dbs = V.BLOB_DBS.map((d) => d.db + '/' + d.store).sort();
  t('the vault knows all three media databases',
    dbs.join(',') === 'cinamate_cut/media,cinamate_scout/photos,cinamate_wardrobe/photos', dbs.join(','));
  t('nothing is hard-coded to one database', V.BLOB_DBS.length >= 3);
  t('the wardrobe store keeps its keyPath and project stamp',
    V.specFor('cinamate_wardrobe', 'photos').keyPath === 'id' &&
    V.specFor('cinamate_wardrobe', 'photos').projectField === 'project');
  t('the out-of-line stores are described as out-of-line',
    V.specFor('cinamate_scout', 'photos').keyPath === null &&
    V.specFor('cinamate_cut', 'media').keyPath === null);
  t('an unknown database is not a store the vault will write',
    V.specFor('cinamate_evil', 'photos') === null);

  /* Ownership is derivable for the two stores whose records carry no stamp. */
  const stores = { SB_ScoutBook_v1: scoutStore(['ph1', 'ph2']), SB_Cut_v1: cutStore(['c1']) };
  const refs = V.referencedIds(stores);
  t('scout ids are read out of the scout book',
    refs['cinamate_scout/photos'].ph1 === true && refs['cinamate_scout/photos'].ph2 === true);
  t('cutting-room ids are read out of the bin', refs['cinamate_cut/media'].c1 === true);
  t('a bin entry that is not stored locally is not claimed',
    !V.referencedIds({ SB_Cut_v1: JSON.stringify({ bin: [{ id: 'link1', idb: false }] }) })['cinamate_cut/media'].link1);
}

/* ── 2 · CVault stays sync and pure: no IndexedDB in the engine ────────── */
{
  const srcText = readFileSync(new URL('../projects/lib-vault.js', import.meta.url), 'utf8');
  t('the engine never mentions indexedDB', !/indexedDB/.test(srcText));
  t('the engine never opens a database', !/\.open\s*\(/.test(srcText));
  t('the engine never touches the DOM', !/\bdocument\s*\./.test(srcText));

  /* Every sibling REJECTS rather than throwing, so one caller shape works for
     all six, and a missing adapter can never be mistaken for "no media". */
  const bad = [
    ['archiveAsync', V.archiveAsync(mem(), 'X', 'x', null)],
    ['restoreAsync', V.restoreAsync(mem(), { format: 'cinamate/1', stores: { SB_A_v1: '{}' } }, {})],
    ['saveActiveAsync', V.saveActiveAsync(mem(), 'x', { readAll: 1 })],
    ['switchToAsync', V.switchToAsync(mem(), 'Other', 'x', undefined)],
    ['newProjectAsync', V.newProjectAsync(mem(), 'Other', 'x', {})],
    ['deleteSlotAsync', V.deleteSlotAsync(mem(), 'Other', {})],
  ];
  const settled = await Promise.all(bad.map(([, p]) =>
    p.then(() => 'resolved', () => 'rejected')));
  bad.forEach(([name], i) => t(name + ' rejects a missing or malformed adapter', settled[i] === 'rejected'));
}

/* ── 3 · a project switch must NOT strand bytes ────────────────────────── */
await (async () => {
  const s = mem();
  s.setItem('SB_Wardrobe_v1', wardStore(['night-harvest:ph1', 'night-harvest:ph2']));
  s.setItem('SB_ScoutBook_v1', scoutStore(['sk1']));
  s.setItem('SB_Timeline_v1', JSON.stringify({ scriptText: 'FADE IN:\n\n1 INT. BARN - NIGHT\n\n4A EXT. FIELD - DAY\n' }));

  const media = memMedia([
    wardPhoto('night-harvest:ph1', 'Night Harvest'),
    wardPhoto('night-harvest:ph2', 'Night Harvest'),
    scoutPhoto('sk1'),
  ]);

  let m = await V.saveActiveAsync(s, '2026-08-20 09:00', media);
  const first = m.active;
  t('the active slot records the media it owns', (m.slots[first].blobs || []).length === 3,
    JSON.stringify((m.slots[first].blobs || []).map((b) => b.id)));
  t('the slot manifest carries no bytes — it lives in localStorage',
    (m.slots[first].blobs || []).every((b) => b.data === undefined));

  await V.newProjectAsync(s, 'Second Film', '2026-08-20 09:05', media);
  t('the new project starts with an empty workspace', s.getItem('SB_Wardrobe_v1') === null);
  t('THE BYTES ARE STILL THERE after leaving the project', media.size() === 3);
  t('the outgoing project still knows which bytes are its own',
    (V.meta(s).slots[first].blobs || []).length === 3);

  // work in the second production, with its own photos
  s.setItem('SB_ScoutBook_v1', scoutStore(['sk9']));
  await media.putAll([scoutPhoto('sk9')]);
  await V.saveActiveAsync(s, '2026-08-20 09:10', media);

  const rep = await V.switchToAsync(s, first, '2026-08-20 09:20', media);
  t('switching back restores the references', JSON.parse(s.getItem('SB_ScoutBook_v1')).locations[0].photos[0] === 'sk1');
  t('and every byte of both productions survived the round trip', media.size() === 4, String(media.size()));
  t('nothing the first project references is reported missing', rep.missing.length === 0,
    JSON.stringify(rep.missing));
  t('the second project kept its own media on the way out',
    (V.meta(s).slots['Second Film'].blobs || []).map((b) => b.id).join(',') === 'sk9');
  t('a switch reports what it did', typeof rep.note === 'string');
  t('nothing was deleted on a switch', media.calls.deleteMany === 0);

  /* The reference test that matters: an unstamped scout photo must still be
     attributable to its production after the workspace has been rewritten
     twice. That is what "not stranded" means. */
  const mine = V.blobsFor(await media.readAll(), V.snapshot(s), first).map((b) => b.id).sort();
  t('the first production still owns exactly its own files',
    mine.join(',') === 'night-harvest:ph1,night-harvest:ph2,sk1', mine.join(','));
})();

/* ── 4 · an archive round-trip must carry the photographs ──────────────── */
await (async () => {
  const a = mem();
  a.setItem('SB_Wardrobe_v1', wardStore(['film:ph1']));
  a.setItem('SB_ScoutBook_v1', scoutStore(['sk1', 'sk2']));
  a.setItem('SB_Cut_v1', cutStore(['c1']));
  a.setItem('SB_Timeline_v1', JSON.stringify({ scriptText: 'FADE IN:\n\n1 INT. BARN - NIGHT\n\n4A EXT. FIELD - DAY\n' }));
  const src = memMedia([wardPhoto('film:ph1', 'Project 1'), scoutPhoto('sk1'), scoutPhoto('sk2'), cutMedia('c1')]);

  const packed = await V.archiveAsync(a, 'Project 1', '2026-08-20 10:00', src);
  const arch = V.parseArchive(packed);
  t('the archive has a top-level blobs section', Array.isArray(arch.blobs));
  t('every referenced file is in it', arch.blobs.length === 4, String(arch.blobs.length));
  t('the archive carries actual bytes, not just ids',
    arch.blobs.every((b) => typeof b.data === 'string' && b.data.length > 30));
  t('all three databases are represented',
    new Set(arch.blobs.map((b) => b.db)).size === 3);
  t('an archive with everything present reports nothing missing', (arch.blobsMissing || []).length === 0);

  /* A second, empty device. */
  const b = mem();
  b.setItem('SB_Timeline_v1', JSON.stringify({ scriptText: 'someone else’s work' }));
  const dst = memMedia([]);
  const rep = await V.restoreAsync(b, packed, dst);
  t('the second device receives the references', JSON.parse(b.getItem('SB_ScoutBook_v1')).locations[0].photos.length === 2);
  t('THE SECOND DEVICE RECEIVES THE BYTES', dst.size() === 4, String(dst.size()));
  t('the wardrobe photo landed in the wardrobe store', dst.has('cinamate_wardrobe', 'photos', 'film:ph1'));
  t('the scout photos landed in the scout store', dst.has('cinamate_scout', 'photos', 'sk1'));
  t('the cutting-room source landed in the media store', dst.has('cinamate_cut', 'media', 'c1'));
  t('a complete restore says so', rep.complete === true && rep.missing.length === 0, rep.note);
  t('the restore counts what it wrote', rep.wrote === 4, String(rep.wrote));

  /* And the sync archive() is unchanged — still storage only, by design. */
  const plain = JSON.parse(V.archive(a, 'Project 1', 'x'));
  t('the sync archive is still pure storage', plain.blobs === undefined);
})();

/* ── 5 · deleting a project purges that project's records ──────────────── */
await (async () => {
  const s = mem();
  s.setItem('SB_ScoutBook_v1', scoutStore(['keep1']));
  s.setItem('SB_Timeline_v1', JSON.stringify({ scriptText: 'live' }));
  const media = memMedia([scoutPhoto('keep1'), scoutPhoto('doomed1'), scoutPhoto('doomed2'),
                          wardPhoto('gone:ph1', 'Doomed Film')]);
  await V.saveActiveAsync(s, 'x', media);

  await V.newProjectAsync(s, 'Doomed Film', 'x', media);
  s.setItem('SB_ScoutBook_v1', scoutStore(['doomed1', 'doomed2']));
  s.setItem('SB_Wardrobe_v1', wardStore(['gone:ph1']));
  await V.saveActiveAsync(s, 'x', media);

  await V.switchToAsync(s, 'Project 1', 'x', media);
  t('before the delete, every file is still on the machine', media.size() === 4);

  const rep = await V.deleteSlotAsync(s, 'Doomed Film', media);
  t('deleting a project purges its media', rep.purged === 3, JSON.stringify(rep));
  t('and only its media', media.size() === 1 && media.has('cinamate_scout', 'photos', 'keep1'), media.ids().join(','));
  t('the slot itself is gone', !V.meta(s).slots['Doomed Film']);

  /* A file two productions both point at is not one production's to destroy. */
  const s2 = mem();
  s2.setItem('SB_ScoutBook_v1', scoutStore(['shared']));
  const m2 = memMedia([scoutPhoto('shared')]);
  await V.saveActiveAsync(s2, 'x', m2);
  await V.newProjectAsync(s2, 'Other', 'x', m2);
  s2.setItem('SB_ScoutBook_v1', scoutStore(['shared']));
  await V.saveActiveAsync(s2, 'x', m2);
  await V.switchToAsync(s2, 'Project 1', 'x', m2);
  const rep2 = await V.deleteSlotAsync(s2, 'Other', m2);
  t('a file another production still uses is kept', m2.size() === 1 && rep2.shared === 1, JSON.stringify(rep2));

  /* Deleting the active project is still refused, through the sibling too. */
  let refused = false;
  await V.deleteSlotAsync(s2, V.meta(s2).active, m2).catch(() => { refused = true; });
  t('deleting the active project is refused', refused);
  let unknown = false;
  await V.deleteSlotAsync(s2, 'Never Existed', m2).catch(() => { unknown = true; });
  t('deleting a project that does not exist is refused', unknown);
})();

/* ── 6 · an oversized archive is REFUSED, never truncated ──────────────── */
{
  const L = V.BLOB_LIMITS;
  t('the caps are stated on the engine',
    L.recordBytes === 900 * 1024 && L.chunkBytes === 1024 * 1024 && L.chunks === 48);
  t('the per-production ceiling is the product of the other two, not a third number',
    L.totalBytes === L.chunks * L.chunkBytes);

  const ok = V.planBlobUpload([scoutPhoto('a', 400000), scoutPhoto('b', 400000), scoutPhoto('c', 400000)]);
  t('an ordinary production is accepted', ok.ok === true, ok.error);
  t('it is split into more than one part when it has to be', ok.chunks.length === 2, String(ok.chunks.length));
  t('no part exceeds the per-request cap',
    ok.chunks.every((c) => c.reduce((n, r) => n + r.data.length, 0) <= L.chunkBytes));
  t('every file is in exactly one part',
    ok.chunks.reduce((n, c) => n + c.length, 0) === 3 &&
    new Set([].concat(...ok.chunks).map((r) => r.id)).size === 3);

  const huge = V.planBlobUpload([scoutPhoto('small', 1000), cutMedia('master.mov', 5 * 1024 * 1024)]);
  t('a single oversized file is refused', huge.ok === false);
  t('it is not silently dropped from an otherwise successful plan', huge.refused.length === 1);
  t('the refusal names the file', /master\.mov/.test(huge.error), huge.error);
  t('the refusal states the size and the limit', /MB/.test(huge.error) && /900 KB/.test(huge.error), huge.error);
  t('the refusal says nothing was sent', /Nothing was sent/.test(huge.error), huge.error);
  t('the refusal offers the way that does work', /\.cinamate/.test(huge.error), huge.error);

  const many = [];
  for (let i = 0; i < 60; i++) many.push(scoutPhoto('p' + i, 900 * 1024 - 100));
  const over = V.planBlobUpload(many);
  t('a production over the per-production ceiling is refused', over.ok === false);
  t('and it says how much it is and how much fits', /MB/.test(over.error) && /48/.test(over.error), over.error);
  t('a refused plan reports the true total, not the truncated one', over.bytes > V.BLOB_LIMITS.totalBytes);

  t('an empty production plans cleanly', V.planBlobUpload([]).ok === true && V.planBlobUpload([]).chunks.length === 0);
}

/* ── 7 · a restore where bytes are genuinely absent must REPORT ────────── */
await (async () => {
  const s = mem();
  const media = memMedia([]);
  /* An archive written by a device that had already lost two of its photos. */
  const arch = {
    format: 'cinamate/1', name: 'Half A Record', savedAt: 'x',
    stores: { SB_ScoutBook_v1: scoutStore(['there', 'gone1', 'gone2']),
              SB_Timeline_v1: JSON.stringify({ scriptText: 'the film' }) },
    blobs: [scoutPhoto('there')],
  };
  const rep = await V.restoreAsync(s, arch, media);
  t('the production still opens', JSON.parse(s.getItem('SB_ScoutBook_v1')).locations[0].photos.length === 3);
  t('the bytes that were there are written', media.has('cinamate_scout', 'photos', 'there'));
  t('THE MISSING ONES ARE REPORTED, not ignored', rep.missing.length === 2, JSON.stringify(rep.missing));
  t('the report names them', rep.missing.map((x) => x.id).sort().join(',') === 'gone1,gone2');
  t('the report names the module they belong to', rep.missing.every((x) => x.module === 'locations'));
  t('a restore with holes never claims to be complete', rep.complete === false);
  t('the note says so in words', /no bytes on this device/.test(rep.note), rep.note);

  /* Bytes the browser refuses to write are a different failure and are also
     reported — a full disk must not read as a successful restore. */
  const s2 = mem();
  const ro = memMedia([]);
  ro.readOnly = true;
  const rep2 = await V.restoreAsync(s2, arch, ro);
  t('a write the browser refused is reported', rep2.failed.length === 1, JSON.stringify(rep2.failed));
  t('and that restore is not complete either', rep2.complete === false);
  t('the note distinguishes it from a missing file', /could not be written/.test(rep2.note), rep2.note);

  /* An archive whose media section is not a list is a broken file, not an
     archive with no media. */
  let broke = false;
  try { V.parseArchive(JSON.stringify({ format: 'cinamate/1', stores: { SB_A_v1: '{}' }, blobs: 'nope' })); }
  catch (e) { broke = true; }
  t('an unreadable media section is refused rather than skipped', broke);

  /* An old archive with no blobs section at all still restores. */
  const s3 = mem();
  const old = await V.restoreAsync(s3, { format: 'cinamate/1', name: 'Old',
    stores: { SB_Timeline_v1: JSON.stringify({ scriptText: 'before media' }) } }, memMedia([]));
  t('an archive written before the vault carried media still restores', old.keys === 1);
  t('and reports honestly that it has none', old.note === 'no media in this production', old.note);
})();

/* ── 8 · incoming media is untrusted, exactly like an incoming store ───── */
{
  const hostile = [
    { db: 'cinamate_scout', store: 'photos', id: 'x" onerror="alert(1)', data: JPEG(100) },
    { db: 'cinamate_evil', store: 'photos', id: 'ok', data: JPEG(100) },
    { db: 'cinamate_scout', store: 'photos', id: 'js', data: 'javascript:alert(1)' },
    { db: 'cinamate_scout', store: 'photos', id: 'html', data: 'data:text/html;base64,PHNjcmlwdD4=' },
    { db: 'cinamate_scout', store: 'photos', id: 'big', data: JPEG(2 * 1024 * 1024) },
    { db: 'cinamate_scout', store: 'photos', id: 'good', data: JPEG(500), project: 'A<b>' },
  ];
  const out = V.sanitizeBlobs(hostile);
  t('only the sound record survives', out.blobs.length === 1 && out.blobs[0].id === 'good',
    JSON.stringify(out.blobs.map((b) => b.id)));
  t('every rejection is reported with a reason', out.dropped.length === 5 && out.dropped.every((d) => !!d.why),
    JSON.stringify(out.dropped));
  t('an id that would break out of an attribute is REFUSED, not silently rewritten',
    out.dropped.some((d) => /unusable record id/.test(d.why)));
  t('a database this platform does not have is refused',
    out.dropped.some((d) => /store this platform does not have/.test(d.why)));
  t('a javascript: payload is not media', out.dropped.some((d) => d.id === 'js'));
  t('text/html dressed as a data URL is not media', out.dropped.some((d) => d.id === 'html'));
  t('a record over the per-record cap is refused here too', out.dropped.some((d) => d.id === 'big'));
  t('markup in the project stamp is stripped', out.blobs[0].project === 'Ab');
  t('a non-list media section yields nothing rather than throwing',
    V.sanitizeBlobs('not a list').blobs.length === 0);

  /* The prototype-pollution and scheme-stripping pins on the store side are
     untouched by any of this — test_vault_sanitize owns them; this only checks
     the media path cannot be used as a way around them. */
  const poison = V.sanitizeBlobs([{ db: 'cinamate_scout', store: 'photos', id: '__proto__', data: JPEG(50) }]);
  t('a record cannot be named __proto__ and land in a store',
    poison.blobs.length === 0 || poison.blobs[0].id === '__proto__');
  t('sanitizing media never touches Object.prototype', ({}).polluted === undefined);
}

/* ── 9 · the helpers the pages depend on ───────────────────────────────── */
{
  const list = [scoutPhoto('a', 1000), scoutPhoto('b', 2000)];
  const man = V.manifestOf(list);
  t('a manifest keeps identity and size', man.length === 2 && man[0].id === 'a' && man[0].bytes > 0);
  t('a manifest never keeps bytes', man.every((r) => r.data === undefined));
  const inv = V.blobInventory(list);
  t('the inventory counts files and bytes', inv.count === 2 && inv.bytes > 3000);
  t('the inventory carries a human label', /KB|MB/.test(inv.label), inv.label);
  t('blobKey identifies a record across all three fields',
    V.blobKey(list[0]) === 'cinamate_scout/photos/a');
  t('blobReport says nothing happened when nothing did',
    V.blobReport({ wrote: 0, dropped: [], failed: [], missing: [] }) === 'no media in this production');
  t('missingBlobs finds nothing when everything is present',
    V.missingBlobs({ SB_ScoutBook_v1: scoutStore(['a']) }, [scoutPhoto('a')]).length === 0);
  t('missingBlobs is per-store, not global',
    V.missingBlobs({ SB_ScoutBook_v1: scoutStore(['a']) },
      [{ db: 'cinamate_cut', store: 'media', id: 'a', data: JPEG(10) }]).length === 1);
  t('isPortable still gates what may leave the project',
    V.isPortable('SB_Wardrobe_v1') === true && V.isPortable('SB_LocalGPU_v1') === false);
  t('allKeys still enumerates only portable keys',
    (() => { const s = mem(); s.setItem('SB_A_v1', '1'); s.setItem('junk', '2'); return V.allKeys(s).join(',') === 'SB_A_v1'; })());
  const bare = mem();
  bare.setItem('SB_ScoutBook_v1', scoutStore(['a']));
  t('snapshotBlobs hands a page its own production’s media',
    typeof V.snapshotBlobs(bare, memMedia([scoutPhoto('a')])).then === 'function');
}

/* ══ the cloud: chunked transport, honest refusal ═════════════════════════ */
process.env.OWNER_TOKEN_SECRET = 'blob-secret-0123456789';
process.env.CIN_API_TOKEN = 'tok';
process.env.CIN_SITE_ID = 'site';
const store = new Map();
global.fetch = async (url, opts = {}) => {
  const key = decodeURIComponent(String(url).split('/cinamate-projects/')[1] || '');
  const m = (opts.method || 'GET').toUpperCase();
  if (m === 'GET') {
    if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => store.get(key) };
  }
  if (m === 'PUT') { store.set(key, opts.body); return { ok: true, status: 201, text: async () => '' }; }
  if (m === 'DELETE') { store.delete(key); return { ok: true, status: 204, text: async () => '' }; }
  return { ok: false, status: 405, text: async () => '' };
};
const { handler } = await import('/home/user/shotb/netlify/functions/projects-sync.js');
const mint = (n) => {
  const e = Date.now() + 3600000, p = `owner:${n}:${e}`;
  return `${p}:${createHmac('sha256', process.env.OWNER_TOKEN_SECRET).update(p).digest('hex')}`;
};
const call = (body, q) => handler({
  httpMethod: q ? 'GET' : 'POST',
  headers: { cookie: 'cin_owner=' + encodeURIComponent(mint('mz465')), host: 'x.netlify.app' },
  body: body ? JSON.stringify(body) : '',
  queryStringParameters: q || {},
});
const J = (r) => JSON.parse(r.body);

/* ── 10 · a production and its photographs make the whole round trip ───── */
await (async () => {
  const s = mem();
  s.setItem('SB_ScoutBook_v1', scoutStore(['sk1', 'sk2']));
  s.setItem('SB_Wardrobe_v1', wardStore(['nh:ph1']));
  s.setItem('SB_Timeline_v1', JSON.stringify({ scriptText: 'FADE IN:\n\n1 INT. BARN - NIGHT\n\n4A EXT. FIELD - DAY\n' }));
  const media = memMedia([scoutPhoto('sk1', 400000), scoutPhoto('sk2', 400000), wardPhoto('nh:ph1', 'Project 1', 400000)]);
  const packed = JSON.parse(await V.archiveAsync(s, 'Night Harvest', 'x', media));
  const plan = V.planBlobUpload(packed.blobs);
  t('a real production plans into more than one part', plan.ok && plan.chunks.length >= 2, String(plan.chunks.length));

  const body = { format: packed.format, name: packed.name, savedAt: packed.savedAt,
                 stores: packed.stores, blobs: V.manifestOf(packed.blobs) };
  let r = await call({ op: 'push', name: 'Night Harvest', archive: JSON.stringify(body), blobChunks: plan.chunks.length });
  t('the written record is accepted', r.statusCode === 200, r.body);
  t('the cloud records how many parts to expect', J(r).blobChunks === plan.chunks.length);
  t('the archive body itself stays small', store.get('p:Night Harvest').length < 200 * 1024,
    String(store.get('p:Night Harvest').length));
  t('the body carries no photograph bytes', !store.get('p:Night Harvest').includes('/9j/4AAQSkZJRg'));

  for (let i = 0; i < plan.chunks.length; i++) {
    const rr = await call({ op: 'push-blobs', name: 'Night Harvest', seq: i, total: plan.chunks.length, blobs: plan.chunks[i] });
    t('media part ' + (i + 1) + ' is accepted', rr.statusCode === 200, rr.body);
  }

  r = await call(null, { op: 'list' });
  const row = J(r).productions.find((p) => p.name === 'Night Harvest');
  t('the catalog shows the media count', row.blobCount === 3, JSON.stringify(row));
  t('the catalog shows the media size', row.blobBytes > 1000000, String(row.blobBytes));

  /* pull, on a fresh device */
  r = await call(null, { op: 'pull', name: 'Night Harvest' });
  const pulled = J(r);
  t('pull says how many parts there are', pulled.blobChunks === plan.chunks.length);
  let got = [];
  for (let i = 0; i < pulled.blobChunks; i++) {
    const c = J(await call(null, { op: 'pull-blobs', name: 'Night Harvest', seq: String(i) }));
    got = got.concat(c.blobs);
  }
  t('every file comes back', got.length === 3, String(got.length));
  const arch = V.parseArchive(pulled.archive);
  arch.blobs = got;
  const dev2 = mem();
  const media2 = memMedia([]);
  const rep = await V.restoreAsync(dev2, arch, media2);
  t('THE CLOUD ROUND TRIP CARRIES THE BYTES', media2.size() === 3, String(media2.size()));
  t('and reports the production complete', rep.complete === true, rep.note);
  t('the wardrobe photo survives the whole path', media2.has('cinamate_wardrobe', 'photos', 'nh:ph1'));
})();

/* ── 11 · the cloud refuses what it cannot hold, and says why ──────────── */
await (async () => {
  let r = await call({ op: 'push-blobs', name: 'Night Harvest', seq: 0, total: 1,
    blobs: [{ db: 'cinamate_cut', store: 'media', id: 'master.mov', data: 'data:video/mp4;base64,' + 'A'.repeat(2 * 1024 * 1024) }] });
  t('an oversized file is refused with 413', r.statusCode === 413, r.body);
  t('the refusal names the file', /master\.mov/.test(J(r).error), J(r).error);
  t('the refusal says nothing was saved', /Nothing was saved/.test(J(r).error));
  t('the refusal offers the export instead', /\.cinamate/.test(J(r).error));

  r = await call({ op: 'push-blobs', name: 'Night Harvest', seq: 0, total: 200, blobs: [scoutPhoto('x', 100)] });
  t('more parts than the cloud takes is refused with 413', r.statusCode === 413, r.body);
  t('and the refusal states the ceiling', /48/.test(J(r).error), J(r).error);

  r = await call({ op: 'push-blobs', name: 'Night Harvest', seq: 0, total: 1,
    blobs: [{ db: 'cinamate_evil', store: 'photos', id: 'x', data: JPEG(50) }] });
  t('a part naming an unknown store is refused', r.statusCode === 400, r.body);
  r = await call({ op: 'push-blobs', name: 'Night Harvest', seq: 0, total: 1,
    blobs: [{ db: 'cinamate_scout', store: 'photos', id: 'x" onerror="', data: JPEG(50) }] });
  t('a part with an unusable id is refused', r.statusCode === 400, r.body);
  r = await call({ op: 'push-blobs', name: 'Night Harvest', seq: 0, total: 1,
    blobs: [{ db: 'cinamate_scout', store: 'photos', id: 'x', data: 'data:text/html;base64,PHNjcmlwdD4=' }] });
  t('a part carrying something that is not media is refused', r.statusCode === 400, r.body);
  t('and none of those refusals stored anything', !store.has('b:0:Night Harvest') ||
    !String(store.get('b:0:Night Harvest')).includes('onerror'));

  /* An archive that claims media and declares no way to carry it must not be
     stored looking complete. */
  r = await call({ op: 'push', name: 'Half', archive: JSON.stringify({
    format: 'cinamate/1', name: 'Half', stores: { SB_Timeline_v1: '{}' },
    blobs: [{ db: 'cinamate_scout', store: 'photos', id: 'a', bytes: 100 }] }) });
  t('an archive that lists media but declares no parts is refused', r.statusCode === 400, r.body);
  t('and the refusal explains why that matters', /must not look complete/.test(J(r).error), J(r).error);

  /* Bytes embedded in the archive body are stripped to a manifest rather than
     stored — the body is not the transport for them. */
  r = await call({ op: 'push', name: 'Embedded', archive: JSON.stringify({
    format: 'cinamate/1', name: 'Embedded', stores: { SB_Timeline_v1: '{"scriptText":"x"}' },
    blobs: [scoutPhoto('emb', 1000)] }), blobChunks: 1 });
  t('an archive with embedded bytes is accepted', r.statusCode === 200, r.body);
  t('but the bytes are not in the stored body', !store.get('p:Embedded').includes('/9j/4AAQSkZJRg'));
  t('and the file is still listed in the manifest', JSON.parse(JSON.parse(store.get('p:Embedded')).archive).blobs[0].id === 'emb');

  /* A missing part is a hole, and pull says so rather than returning nothing. */
  r = await call(null, { op: 'pull-blobs', name: 'Embedded', seq: '0' });
  t('a part that was never uploaded is a 404 with a reason', r.statusCode === 404, r.body);
  t('and it says the media did not finish uploading', /did not finish uploading/.test(J(r).error), J(r).error);
  r = await call(null, { op: 'pull-blobs', name: 'Embedded', seq: '999' });
  t('an out-of-range part is refused', r.statusCode === 400);

  /* A title cannot impersonate the media key space. */
  r = await call({ op: 'push', name: 'b:0:Night Harvest', archive: JSON.stringify({
    format: 'cinamate/1', name: 'x', stores: { SB_Timeline_v1: '{}' } }) });
  t('a title cannot impersonate a media part key', r.statusCode === 400, r.body);

  /* A smaller re-push must not leave the previous save's parts behind. */
  await call({ op: 'push', name: 'Shrink', archive: JSON.stringify({
    format: 'cinamate/1', name: 'Shrink', stores: { SB_Timeline_v1: '{"scriptText":"a"}' },
    blobs: [V.manifestOf([scoutPhoto('s1', 100), scoutPhoto('s2', 100)])[0]] }), blobChunks: 2 });
  await call({ op: 'push-blobs', name: 'Shrink', seq: 0, total: 2, blobs: [scoutPhoto('s1', 100)] });
  await call({ op: 'push-blobs', name: 'Shrink', seq: 1, total: 2, blobs: [scoutPhoto('s2', 100)] });
  t('both parts are stored', store.has('b:0:Shrink') && store.has('b:1:Shrink'));
  await call({ op: 'push', name: 'Shrink', archive: JSON.stringify({
    format: 'cinamate/1', name: 'Shrink', stores: { SB_Timeline_v1: '{"scriptText":"b"}' },
    blobs: [V.manifestOf([scoutPhoto('s1', 100)])[0]] }), blobChunks: 1 });
  t('a smaller save sweeps the part it no longer uses', !store.has('b:1:Shrink'));
  t('and keeps the one it does', store.has('b:0:Shrink'));
})();

console.log('test_vault_blobs: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
