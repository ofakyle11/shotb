#!/usr/bin/env node
/* Node tests for festivals/lib-fest.js (CFest) — run: node scripts/test_festivals.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'festivals/lib-fest.js'), 'utf8'));
const F = globalThis.CFest;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

/* ── directory honesty ── */
t('14 curated majors', F.MAJORS.length === 14);
const names = F.MAJORS.map(f => f.name);
['Sundance', 'Cannes', 'Venice', 'Berlinale', 'TIFF', 'SXSW', 'Telluride', 'Tribeca',
 'Locarno', 'Rotterdam', 'Hot Docs', 'Fantastic Fest', 'AFI Fest', 'Slamdance']
  .forEach(n => t('directory carries ' + n, names.indexOf(n) >= 0));
t('every entry has all fields', F.MAJORS.every(f =>
  f.name && f.city && f.seasonWindow && f.premiereNote && f.feeHint &&
  F.TIERS.indexOf(f.tier) >= 0));
t('every entry uses approximate language', F.MAJORS.every(f =>
  /roughly|typically|varied/i.test(f.seasonWindow + ' ' + f.feeHint)));
t('no hardcoded festival URLs in directory', F.MAJORS.every(f =>
  !/https?:/i.test(JSON.stringify(f))));
t('banner says verify before planning', /verify/i.test(F.BANNER) && /drift/i.test(F.BANNER));
t('search link encodes name, no invented URL', (() => {
  const u = F.searchLink('Hot Docs');
  return u.indexOf('https://www.google.com/search?q=') === 0 && u.indexOf('Hot%20Docs') > 0;
})());
const grouped = F.byTier(F.MAJORS);
t('tier grouping is complete', F.TIERS.reduce((a, k) => a + grouped[k].length, 0) === 14);
t('A-list tier holds the big five', grouped['A-list'].length === 5);
t('Hot Docs is docs tier, Fantastic Fest is genre', (() => {
  const by = {}; F.MAJORS.forEach(f => { by[f.name] = f.tier; });
  return by['Hot Docs'] === 'docs' && by['Fantastic Fest'] === 'genre';
})());

/* ── premiere strategy ── */
const un = F.strategy('unpremiered');
t('unpremiered keeps all tiers', un.tiers.join() === 'A-list,major,genre,docs');
t('unpremiered warns not to burn the premiere', /never burn/i.test(un.note));
const us = F.strategy('us-premiered');
t('us-premiered drops A-list', us.tiers.indexOf('A-list') < 0 && us.tiers.indexOf('major') >= 0);
t('us-premiered mentions international premiere path', /international premiere/i.test(us.note));
const wp = F.strategy('world-premiered');
t('world-premiered drops A-list, keeps rest', wp.tiers.join() === 'major,genre,docs');
t('world-premiered pivots to markets/buyers', /market|buyer/i.test(wp.note));
t('unknown status falls back to unpremiered', F.strategy('???').status === 'unpremiered');

/* ── submissions tracker ── */
const s1 = F.newSub({ festival: 'Sundance', category: 'Narrative Feature', deadline: '2026-09-20', fee: '85', submittedOn: '2026-08-01' });
const s2 = F.newSub({ festival: 'SXSW', category: 'Narrative Feature', deadline: '2026-10-15', fee: 70 });
const s3 = F.newSub({ festival: 'Slamdance', deadline: '2026-07-01', fee: 45, submittedOn: '2026-06-20' });
const s4 = F.newSub({ festival: 'Tribeca', deadline: '2026-12-01', fee: 60, result: 'withdrawn' });
const s5 = F.newSub({ festival: 'Mystery Fest', fee: 'not a number', result: 'bogus' });
t('newSub defaults result to pending', s2.result === 'pending' && s5.result === 'pending');
t('newSub coerces fee to number', s1.fee === 85 && s5.fee === 0);
t('newSub ids are unique', s1.id !== s2.id && s2.id !== s3.id);
const subs = [s2, s1, s3, s4, s5];
const fees = F.feesTotal(subs);
t('fees split paid vs planned', fees.paid === 85 + 45 && fees.planned === 70 + 60);
t('fees total adds up', fees.total === fees.paid + fees.planned);
t('feesTotal safe on empty', F.feesTotal([]).total === 0 && F.feesTotal(null).total === 0);
const up = F.upcoming(subs, '2026-08-23');
t('upcoming excludes withdrawn and no-deadline', up.length === 3 &&
  up.every(s => s.result === 'pending' && s.deadline));
t('upcoming sorted by deadline', up.map(s => s.festival).join() === 'Slamdance,Sundance,SXSW');
t('past deadlines flagged', up[0].past === true && up[1].past === false && up[2].past === false);
t('upcoming does not mutate input order', subs[0].festival === 'SXSW');
t('setResult updates in place', F.setResult(subs, s2.id, 'accepted') === s2 && s2.result === 'accepted');
t('setResult rejects bogus result', F.setResult(subs, s2.id, 'maybe') === null && s2.result === 'accepted');
const counts = F.resultCounts(subs);
t('resultCounts tallies', counts.accepted === 1 && counts.withdrawn === 1 && counts.pending === 3);

/* ── THE STORE: one shape, and a migration that loses nothing ──
   SB_Festivals_v1 had two writers with incompatible top-level types — the
   Tools register wrote a bare ARRAY, this module's page wrote an OBJECT — so
   whichever page was opened second destroyed the other's data. Both legacy
   shapes must survive the upgrade, in both directions. */
t('blank store is the object shape', (() => {
  const b = F.blank();
  return b.v === F.STORE_VERSION && b.premiereStatus === 'unpremiered' &&
    Array.isArray(b.subs) && Array.isArray(b.buyers);
})());
t('KEY is the store key, unchanged', F.KEY === 'SB_Festivals_v1');
t('migrate(null) is an empty store', F.migrate(null).subs.length === 0 && F.migrate(undefined).buyers.length === 0);

/* direction 1 — an owner who only ever used Tools › Festivals */
const LEGACY_ROWS = [
  { id: 't1', name: 'Sundance', tier: 'A-list', deadline: '2026-09-20', fee: '85',
    submitted: '2026-08-01', status: 'In consideration', premiere: 'World', notes: 'shorts programmer likes it' },
  { id: 't2', name: 'Fantastic Fest', deadline: '2026-06-01', fee: 40, submitted: '',
    status: 'Rejected', premiere: 'None', notes: '' },
  { id: 't3', name: 'Hot Docs', fee: 60, status: 'Premiered' }
];
const fromArray = F.migrate(LEGACY_ROWS);
t('legacy ARRAY migrates row for row', fromArray.subs.length === 3);
t('legacy name→festival, submitted→submittedOn, premiere→premiereReq', (() => {
  const s = fromArray.subs[0];
  return s.festival === 'Sundance' && s.submittedOn === '2026-08-01' &&
    s.premiereReq === 'World' && s.tier === 'A-list' && s.notes === 'shorts programmer likes it';
})());
t('legacy fee string becomes a number', fromArray.subs[0].fee === 85);
t('legacy row ids are kept, not reminted', fromArray.subs.map(s => s.id).join() === 't1,t2,t3');
t('legacy status maps to a result', fromArray.subs[0].result === 'pending' &&
  fromArray.subs[1].result === 'rejected' && fromArray.subs[2].result === 'accepted');
t('the exact legacy word is preserved in stage', fromArray.subs[0].stage === 'In consideration' &&
  fromArray.subs[2].stage === 'Premiered');
t('migrated rows read correctly through the tracker', (() => {
  const fees = F.feesTotal(fromArray.subs);
  const counts = F.resultCounts(fromArray.subs);
  return fees.paid === 85 && fees.planned === 100 && counts.rejected === 1 && counts.accepted === 1;
})());
t('LEGACY_STAGES covers every Tools status option',
  ['Planned', 'Submitted', 'In consideration', 'Accepted', 'Rejected', 'Premiered']
    .every(s => F.RESULTS.indexOf(F.LEGACY_STAGES[s]) >= 0));

/* direction 2 — an owner who only ever used the Strategist page */
const LEGACY_OBJ = {
  premiereStatus: 'us-premiered',
  subs: [{ id: 'o1', festival: 'SXSW', category: 'Narrative', deadline: '2026-10-15', fee: 70, result: 'accepted' }],
  buyers: [{ id: 'b1', name: 'A. Kim', company: 'Meridian Films', lastContact: '2026-08-20' }]
};
const fromObj = F.migrate(LEGACY_OBJ);
t('legacy OBJECT keeps subs, buyers and premiere status', fromObj.subs.length === 1 &&
  fromObj.buyers.length === 1 && fromObj.premiereStatus === 'us-premiered');
t('object-shape buyer ids survive', fromObj.buyers[0].id === 'b1' && fromObj.buyers[0].company === 'Meridian Films');
t('object-shape sub is untouched', fromObj.subs[0].festival === 'SXSW' && fromObj.subs[0].result === 'accepted');
t('bogus premiereStatus falls back', F.migrate({ premiereStatus: 'zap' }).premiereStatus === 'unpremiered' &&
  F.PREMIERE_STATUSES.length === 3);
t('migrate is idempotent', JSON.stringify(F.migrate(fromArray).subs) === JSON.stringify(fromArray.subs));
t('migrate survives junk rows', F.migrate([null, 7, 'x', { name: 'Real' }]).subs.length === 1);
t('duplicate ids are separated, not merged away',
  F.migrate([{ id: 'dup', name: 'A' }, { id: 'dup', name: 'B' }]).subs.length === 2);
t('normSub defaults a bare row', (() => {
  const s = F.normSub({});
  return s.result === 'pending' && s.fee === 0 && s.festival === '' && !!s.id;
})());
t('normBuyer keeps an existing id', F.normBuyer({ id: 'keepme', name: 'X' }).id === 'keepme');

/* The Tools register owns its own row array and REPLACES it on delete, so the
   store has to be re-pointed at the register's array on every write — the
   whole point being that neither writer can clobber the other. */
t('setSubs re-points the store at a caller-owned array', (() => {
  const store = F.migrate(LEGACY_OBJ);
  const rows = store.subs.slice();                       // what a Register holds
  rows.push(F.newSub({ festival: 'Locarno', fee: '55' }));
  F.setSubs(store, rows);
  const kept = store.subs.length === 2 && store.buyers.length === 1 &&
    store.premiereStatus === 'us-premiered';
  F.setSubs(store, store.subs.filter(s => s.festival !== 'SXSW'));  // a delete
  return kept && store.subs.length === 1 && store.subs[0].festival === 'Locarno';
})());
t('setSubs normalises what a text input typed', F.setSubs(F.blank(),
  [{ name: 'Venice', fee: '120', submitted: '2026-06-01' }]).subs[0].fee === 120);

/* load()/save() round-trip through whatever localStorage is there */
t('load without localStorage is a blank store', F.load().subs.length === 0);
globalThis.localStorage = (() => {
  let v = null;
  return { getItem: () => v, setItem: (k, x) => { v = x; }, removeItem: () => { v = null; } };
})();
globalThis.localStorage.setItem('SB_Festivals_v1', JSON.stringify(LEGACY_ROWS));
const loaded = F.load();
t('load migrates a legacy ARRAY off the wire', loaded.subs.length === 3 && loaded.subs[0].festival === 'Sundance');
loaded.subs.push(F.newSub({ festival: 'Tribeca', fee: 60 }));
F.save(loaded);
t('save writes the object shape, and it reloads whole', (() => {
  const back = F.load();
  return back.subs.length === 4 && back.v === F.STORE_VERSION &&
    back.subs[3].festival === 'Tribeca' && back.subs[0].stage === 'In consideration';
})());
delete globalThis.localStorage;

/* ── buyer CRM ── */
const b1 = F.newBuyer({ name: 'A. Kim', company: 'Meridian Films', territory: 'North America', focus: 'genre', lastContact: '2026-08-20' });
const b2 = F.newBuyer({ name: 'L. Costa', company: 'Sul Media', territory: 'LatAm', lastContact: '2026-05-01' });
const b3 = F.newBuyer({ name: 'No Contact Yet' });
t('newBuyer carries fields', b1.company === 'Meridian Films' && b1.territory === 'North America' && b3.notes === '');
t('shiftISO moves 30 days back', F.shiftISO('2026-08-23', -30) === '2026-07-24');
t('shiftISO rejects garbage', F.shiftISO('yesterday', -30) === '');
const stale = F.staleBuyers([b1, b2, b3], '2026-08-23', 30);
t('staleBuyers finds old + never-contacted', stale.length === 2 &&
  stale.indexOf(b2) >= 0 && stale.indexOf(b3) >= 0);
t('recent buyer not stale', stale.indexOf(b1) < 0);
t('buyer search link is a google search', (() => {
  const u = F.buyerSearchLink(b1);
  return u.indexOf('https://www.google.com/search?q=') === 0 && u.indexOf('Meridian%20Films') > 0;
})());

/* ── distribution tie-in ── */
t('screenersOut counts SB_Dist_v1 screeners', (() => {
  const sc = F.screenersOut({ screeners: [{ watched: true }, { watched: false }, { watched: true }] });
  return sc.out === 3 && sc.watched === 2;
})());
t('screenersOut safe with no store', F.screenersOut(null).out === 0 && F.screenersOut({}).out === 0);

console.log(`test_festivals: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
