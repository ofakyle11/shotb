#!/usr/bin/env node
/* Node tests for locations/lib-scout.js (CScout) — run: node scripts/test_locations.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'locations/lib-scout.js'), 'utf8'));
const S = globalThis.CScout;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

/* ── directory shape + honesty ── */
t('PERMITS covers the six hubs', S.PERMITS.length === 6 &&
  ['Toronto', 'Vancouver', 'Atlanta', 'Los Angeles', 'New York', 'London']
    .every(h => S.PERMITS.some(p => p.hub === h)));
t('permit entries carry every field', S.PERMITS.every(p =>
  p.office && p.required && p.cost && p.leadTime && p.insurance && p.police &&
  typeof p.applyUrl === 'string' && typeof p.verified === 'boolean'));
t('unverified permits never carry an applyUrl', S.PERMITS.every(p => p.verified || p.applyUrl === ''));
t('verified permits carry an official applyUrl', S.PERMITS.every(p => !p.verified || /^https:\/\//.test(p.applyUrl)));
t('permit costs are verified-sourced or tell you to confirm', S.PERMITS.every(p => p.verified ? /verified|confirmed|fetched/i.test(p.cost) : /verify|confirm|unverified/i.test(p.cost)));
t('STAGES covers the same six hubs', S.STAGES.length === 6 &&
  S.STAGES.every(s => Array.isArray(s.facilities) && s.facilities.length >= 3 && s.booking));
t('facility entries carry every field', S.STAGES.every(s => s.facilities.every(f =>
  f.name && f.kind && f.stages && f.notable && typeof f.verified === 'boolean')));
t('unverified facilities never carry a website', S.STAGES.every(s =>
  s.facilities.every(f => f.verified || f.website === null)));

/* ── fuzzy hub matching ── */
t('permitFor exact hub', S.permitFor('Toronto').hub === 'Toronto');
t('permitFor case-insensitive substring', S.permitFor('shooting in downtown toronto, ON').hub === 'Toronto');
t('permitFor alias LA', S.permitFor('LA').hub === 'Los Angeles');
t('permitFor alias NYC', S.permitFor('nyc').hub === 'New York');
t('permitFor unknown city → null', S.permitFor('Winnipeg') === null);
t('permitFor empty → null', S.permitFor('') === null && S.permitFor(null) === null);
t('stagesFor matches London', S.stagesFor('London, UK').hub === 'London');
t('stagesFor alias burnaby → Vancouver', S.stagesFor('Burnaby').hub === 'Vancouver');
t('permitFor partial typed hub', S.permitFor('Vancou').hub === 'Vancouver');

/* ── advisor incentive map ── */
t('ontario → Toronto', S.hubForIncentive('ontario') === 'Toronto');
t('bc → Vancouver', S.hubForIncentive('bc') === 'Vancouver');
t('georgia → Atlanta', S.hubForIncentive('georgia') === 'Atlanta');
t('california → Los Angeles', S.hubForIncentive('california') === 'Los Angeles');
t('newyork → New York', S.hubForIncentive('NEWYORK') === 'New York');
t('ukavec + ukiftc → London', S.hubForIncentive('ukavec') === 'London' && S.hubForIncentive('ukiftc') === 'London');
t('unknown incentive → null', S.hubForIncentive('nowhere') === null && S.hubForIncentive() === null);

/* ── search links ── */
const link = S.searchLink('Pinewood Toronto Studios', 'Toronto');
t('searchLink is a google search', link.indexOf('https://www.google.com/search?q=') === 0);
t('searchLink encodes the query', link.indexOf('Pinewood+Toronto+Studios+Toronto') > 0);

/* ── golden hour ── */
const eq = S.goldenHour(0, '2026-03-20');            // equator, near equinox
t('equator equinox sunrise ≈ 06:00', eq.sunrise >= '05:40' && eq.sunrise <= '06:20');
t('equator equinox sunset ≈ 18:00', eq.sunset >= '17:40' && eq.sunset <= '18:20');
t('AM golden starts at sunrise', eq.goldenAmStart === eq.sunrise);
t('PM golden starts 1h before sunset', (() => {
  const [sh, sm] = eq.sunset.split(':').map(Number);
  const [gh, gm] = eq.goldenPmStart.split(':').map(Number);
  return (sh * 60 + sm) - (gh * 60 + gm) === 60;
})());
t('golden hour carries the solar-time note', /solar time — verify locally/.test(eq.note));
const june = S.goldenHour(45, '2026-06-21');         // mid-lat summer
const dec = S.goldenHour(45, '2026-12-21');          // mid-lat winter
t('summer day longer than winter at 45°N', june.dayLength > 14 && dec.dayLength < 10);
t('summer sunrise earlier than winter', june.sunrise < dec.sunrise);
t('polar night detected', /polar night/.test(S.goldenHour(78, '2026-12-21').polar));
t('midnight sun detected', /midnight sun/.test(S.goldenHour(78, '2026-06-21').polar));
t('polar results still carry the note', /verify locally/.test(S.goldenHour(78, '2026-06-21').note));
t('bad input flagged, no fake times', (() => {
  const bad = S.goldenHour(200, '2026-06-21');
  const bad2 = S.goldenHour(45, 'not-a-date');
  return bad.error && bad.sunrise === null && bad2.error && bad2.sunrise === null;
})());
t('dayOfYear handles leap years', S.dayOfYear('2024-03-01') === 61 && S.dayOfYear('2026-03-01') === 60 &&
  S.dayOfYear('2026-01-01') === 1 && S.dayOfYear('2026-12-31') === 365);

/* ── checklist ── */
const ck = S.locationChecklist();
t('checklist has 10 items', ck.length === 10);
t('checklist items carry id/item/detail', ck.every(c => c.id && c.item && c.detail));
t('checklist covers hospital + COI + power', ['hospital', 'coi', 'power', 'parking', 'loadin',
  'bathrooms', 'neighbors', 'noise', 'cell', 'permits'].every(id => ck.some(c => c.id === id)));

/* ── location records ── */
const loc = S.blankLocation({ name: 'Farmhouse', scenes: '1, 3' });
t('blankLocation defaults', loc.permitStatus === 'none' && loc.releaseStatus === 'none' &&
  Array.isArray(loc.photos) && loc.photos.length === 0 && loc.id.length > 3);
t('blankLocation keeps fields', loc.name === 'Farmhouse' && loc.scenes === '1, 3' && loc.hospital === '');
t('blankLocation ids unique', S.blankLocation().id !== S.blankLocation().id);

/* ── screenplay mining ── */
const SCRIPT = `INT. FARMHOUSE KITCHEN - NIGHT
Maggie sets the table.

EXT. COUNTRY ROAD - DAY
A rusted truck rattles past.

12. INT. FARMHOUSE KITCHEN - DAY
Morning light. Tom enters.

INT/EXT. BARN - CONTINUOUS
Hay everywhere.`;
const locs = S.scriptLocations(SCRIPT);
t('scriptLocations dedupes to 3 places', locs.length === 3);
t('kitchen groups scenes 1+3', locs[0].name === 'FARMHOUSE KITCHEN' && locs[0].scenes.join(',') === '1,3');
t('numbered slugline still parsed', locs.some(l => l.name === 'COUNTRY ROAD' && l.scenes.join(',') === '2'));
t('INT/EXT slugline parsed', locs.some(l => l.name === 'BARN' && l.scenes.join(',') === '4'));
t('scriptLocations empty script → []', S.scriptLocations('').length === 0 && S.scriptLocations(null).length === 0);

console.log(`test_locations: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
