/* The studio cloud is shared by five owners and is the only copy of a
 * production that lives off any one machine. A review found several ways to
 * lose work permanently through it; each is reproduced here.
 *
 * Run: node scripts/test_cloud_safety.mjs
 */
process.env.OWNER_TOKEN_SECRET = 'test-secret-0123456789';
process.env.CIN_API_TOKEN = 'tok';
process.env.CIN_SITE_ID = 'site';

const { createHmac } = await import('crypto');
const mint = (n) => {
  const e = Date.now() + 3600000, p = `owner:${n}:${e}`;
  return `${p}:${createHmac('sha256', process.env.OWNER_TOKEN_SECRET).update(p).digest('hex')}`;
};

/* In-memory stand-in for Netlify Blobs. */
const store = new Map();
let indexReadFails = false;
global.fetch = async (url, opts = {}) => {
  const key = decodeURIComponent(String(url).split('/cinamate-projects/')[1] || '');
  const m = (opts.method || 'GET').toUpperCase();
  if (m === 'GET') {
    if (key === '_index' && indexReadFails) return { ok: false, status: 500, text: async () => 'boom' };
    if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => store.get(key) };
  }
  if (m === 'PUT') { store.set(key, opts.body); return { ok: true, status: 201, text: async () => '' }; }
  if (m === 'DELETE') { store.delete(key); return { ok: true, status: 204, text: async () => '' }; }
  return { ok: false, status: 405, text: async () => '' };
};

const { handler } = await import('/home/user/shotb/netlify/functions/projects-sync.js');

const call = (who, body, q) => handler({
  httpMethod: q ? 'GET' : 'POST',
  headers: { cookie: 'cin_owner=' + encodeURIComponent(mint(who)), host: 'x.netlify.app' },
  body: body ? JSON.stringify(body) : '',
  queryStringParameters: q || {},
});
const archiveOf = (marker) => JSON.stringify({
  format: 'cinamate/1', name: 'Film', stores: { SB_Timeline_v1: JSON.stringify({ scriptText: marker }) },
});
const bodyOf = (r) => JSON.parse(r.body);
const liveMarker = async () => {
  const r = await call('hz465', null, { op: 'pull', name: 'Film' });
  return JSON.parse(JSON.parse(bodyOf(r).archive).stores.SB_Timeline_v1).scriptText;
};

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.log('  x ' + name)); };

/* 1. routine autosaves must not push a real mistake out of reach */
await call('hz465', { op: 'push', name: 'Film', archive: archiveOf('THE GOOD DRAFT') });
for (let i = 0; i < 6; i++) {
  await call('hz465', { op: 'push', name: 'Film', archive: archiveOf('autosave ' + i) });
}
let vers = bodyOf(await call('hz465', null, { op: 'versions', name: 'Film' }));
t('the ring keeps several superseded copies', vers.versions.length >= 5);
const stillThere = await Promise.all(vers.versions.map(async (v) => {
  const r = await call('hz465', null, { op: 'versions', name: 'Film' });
  return r.statusCode === 200;
}));
t('every kept version is enumerable', stillThere.every(Boolean));

/* 2. a deleted production must be discoverable and recoverable */
const del = bodyOf(await call('rz465', { op: 'delete', name: 'Film' }));
t('delete reports it is recoverable', del.recoverable === true);
t('delete records who did it', del.deletedBy === 'rz465');
vers = bodyOf(await call('hz465', null, { op: 'versions', name: 'Film' }));
t('a deleted production is still discoverable', vers.versions.length > 0);
t('the deletion is attributed', vers.deleted && vers.deleted.deletedBy === 'rz465');
const restored = bodyOf(await call('hz465', { op: 'restore', name: 'Film' }));
t('a deleted production can be restored', restored.ok === true);
t('restore is attributed to whoever ran it', restored.savedBy === 'hz465');
t('restore names the copy it came from', !!restored.restoredFrom);

/* 3. restore must not itself destroy the copy it replaces */
await call('hz465', { op: 'push', name: 'Film', archive: archiveOf('CURRENT WORK') });
const before = await liveMarker();
t('live copy is the newest push', before === 'CURRENT WORK');
await call('hz465', { op: 'restore', name: 'Film', slot: 0 });
vers = bodyOf(await call('hz465', null, { op: 'versions', name: 'Film' }));
const rawSlots = await Promise.all([...store.keys()]
  .filter((k) => k.startsWith('v:'))
  .map(async (k) => JSON.parse(store.get(k))));
const keptCurrent = rawSlots.some((v) => String(v.archive).includes('CURRENT WORK'));
t('restoring keeps what it replaced', keptCurrent);

/* 4. a stale tab must not silently bury a newer save */
await call('hz465', { op: 'push', name: 'Film', archive: archiveOf('v1') });
const known = bodyOf(await call('hz465', null, { op: 'list' })).productions.find((p) => p.name === 'Film');
await call('rz465', { op: 'push', name: 'Film', archive: archiveOf('colleague work') });
const stale = await call('hz465', {
  op: 'push', name: 'Film', archive: archiveOf('stale tab'), ifVer: known.ver,
});
t('a stale write is refused with 409', stale.statusCode === 409);
t('the refusal reports the current version', bodyOf(stale).ver !== known.ver);
t("the colleague's work survives", (await liveMarker()) === 'colleague work');

/* 5. an unreadable catalog must never be overwritten with a partial one */
await call('hz465', { op: 'push', name: 'Other', archive: archiveOf('other') });
const catalogBefore = Object.keys(JSON.parse(store.get('_index')).productions).sort();
indexReadFails = true;
await call('hz465', { op: 'push', name: 'Third', archive: archiveOf('third') });
indexReadFails = false;
const catalogAfter = Object.keys(JSON.parse(store.get('_index')).productions).sort();
t('a failed catalog read does not wipe the catalog',
  catalogBefore.every((n) => catalogAfter.includes(n)));

/* 6. titles cannot impersonate the new key spaces */
for (const bad of ['v:0:Film', 'tomb:Film', 'p:Film', '_index']) {
  const r = await call('hz465', { op: 'push', name: bad, archive: archiveOf('x') });
  t(`reserved key rejected: ${bad}`, r.statusCode === 400);
}

/* 7. the shared store must never accept a machine's own credentials */
{
  const withKeys = JSON.stringify({
    format: 'cinamate/1', name: 'Keys',
    stores: {
      SB_Timeline_v1: JSON.stringify({ scriptText: 'real work' }),
      SB_LocalGPU_v1: JSON.stringify({ url: 'http://127.0.0.1:3456', apiKey: 'SECRET-BRIDGE-KEY' }),
      SB_TMDB_v1: JSON.stringify({ key: 'SECRET-TMDB-KEY' }),
      NotAnSbKey: 'x',
    },
  });
  await call('hz465', { op: 'push', name: 'Keys', archive: withKeys });
  const stored = store.get('p:Keys') || '';
  t('the bridge API key never reaches the shared store', !stored.includes('SECRET-BRIDGE-KEY'));
  t('a personal TMDB key never reaches the shared store', !stored.includes('SECRET-TMDB-KEY'));
  t('a foreign store key is dropped', !stored.includes('NotAnSbKey'));
  t('the real production data is still saved', stored.includes('real work'));
}

/* 8. an empty archive is an erase, not a save */
{
  const before = await liveMarker();
  const empty = await call('hz465', { op: 'push', name: 'Film', archive:
    JSON.stringify({ format: 'cinamate/1', name: 'Film', stores: {} }) });
  t('an archive with no stores is refused', empty.statusCode === 400);
  const onlyForeign = await call('hz465', { op: 'push', name: 'Film', archive:
    JSON.stringify({ format: 'cinamate/1', name: 'Film', stores: { evil: '1', SB_TMDB_v1: '{}' } }) });
  t('an archive that filters down to nothing is refused', onlyForeign.statusCode === 400);
  t('the live production is untouched by a refused push', (await liveMarker()) === before);
}

/* 9. a title must survive being turned into a storage key */
{
  /* An 80th character that is half an emoji leaves a lone surrogate, and
     encodeURIComponent throws on one — which turned every cloud operation for
     that production into a 502 and killed its auto-backup silently. */
  const longEmoji = 'A'.repeat(79) + '\u{1F3AC}';
  const r = await call('hz465', { op: 'push', name: longEmoji, archive: archiveOf('emoji title') });
  t('a title cut mid-emoji is still usable', r.statusCode === 200, r.statusCode + ' ' + r.body);
  const names = bodyOf(await call('hz465', null, { op: 'list' })).productions.map((p) => p.name);
  t('every stored title can be encoded',
    names.every((n) => { try { encodeURIComponent(n); return true; } catch (e) { return false; } }),
    JSON.stringify(names));

  /* Two rows that render identically are unusable in a namespace where every
     owner's delete acts on everyone's copy. */
  await call('hz465', { op: 'push', name: 'Feature', archive: archiveOf('one') });
  const zw = await call('hz465', { op: 'push', name: 'Feat\u200bure', archive: archiveOf('two') });
  t('a zero-width character does not create a twin row', zw.statusCode === 200);
  const after = bodyOf(await call('hz465', null, { op: 'list' })).productions.map((p) => p.name);
  t('the invisible character was stripped rather than stored',
    after.filter((n) => n.replace(/\u200b/g, '') === 'Feature').length === 1,
    JSON.stringify(after.filter((n) => /Feat/.test(n))));
  t('no stored title contains an invisible character',
    after.every((n) => !/[\u200b-\u200f\u2060-\u2064\ufeff]/.test(n)));

  /* A title that is nothing but invisible characters is not a title. */
  const blank = await call('hz465', { op: 'push', name: '\u200b\u200b\ufeff', archive: archiveOf('x') });
  t('a title of only invisible characters is refused', blank.statusCode === 400);
  const nbsp = await call('hz465', { op: 'push', name: '\u00a0', archive: archiveOf('x') });
  t('a title of only a non-breaking space is refused', nbsp.statusCode === 400);
}

console.log(`test_cloud_safety: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
