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
