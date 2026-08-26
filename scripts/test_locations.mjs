#!/usr/bin/env node
/* Node tests for locations/lib-scout.js (CScout) — run: node scripts/test_locations.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'locations/lib-scout.js'), 'utf8'));
const S = globalThis.CScout;
const SRC = readFileSync(join(ROOT, 'locations/lib-scout.js'), 'utf8');

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

/* ── the approximate solar engine is GONE ──
   It returned local solar time with no longitude, timezone or DST
   correction and was up to 1h40m out on sunset. tools/lib-sun.js is the
   tested engine and locations/index.html loads it; a second one living
   here is the defect, so its absence is the assertion. Sun maths itself is
   covered by scripts/test_sun.mjs. */
t('CScout no longer ships a solar engine', S.goldenHour === undefined);
t('nothing in lib-scout.js still computes sunrise', !/goldenHour|declination|cosH/.test(SRC));
t('dayOfYear survives and handles leap years', S.dayOfYear('2024-03-01') === 61 && S.dayOfYear('2026-03-01') === 60 &&
  S.dayOfYear('2026-01-01') === 1 && S.dayOfYear('2026-12-31') === 365);
t('dayOfYear rejects a non-date', S.dayOfYear('not-a-date') === null && S.dayOfYear('2026-13-01') === null);

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
t('a location carries its own pin and its own UTC offset', 'lat' in loc && 'lon' in loc &&
  loc.tzOffsetMin === null && loc.tzSource === '');
t('a recorded offset survives on the record so no network call is needed',
  S.blankLocation({ lat: 47.5, lon: 19.04, tzOffsetMin: 120, tzSource: 'api' }).tzOffsetMin === 120);
t('a location carries a structured supply and a fixture order', loc.supplyAmps === null &&
  loc.supplyVolts === 120 && loc.supplyPhases === 1 && Array.isArray(loc.fixtures) && loc.fixtures.length === 0);

/* ── electrical load ──────────────────────────────────────────────────────
   Blowing the house service is the most common electrical incident on a
   small set, and "power: ask the super" is what the record used to hold.
   Line current is per LEG at 120V, which is how a distro is actually
   loaded; the 80% ceiling is the continuous-load derate a shoot day always
   triggers. */
const FX = S.FIXTURES;
t('the fixture list is real hardware with real wattages', FX.length >= 15 &&
  FX.every(f => f.id && f.name && f.watts > 0 && f.kind && f.draw >= 1));
t('the list spans practicals to a 12K', FX.some(f => f.watts <= 100) && FX.some(f => f.watts >= 10000));
t('HMI ballast draw is above the lamp rating, tungsten and LED are not',
  FX.filter(f => f.kind === 'hmi').every(f => f.draw > 1) &&
  FX.filter(f => f.kind === 'tungsten' || f.kind === 'led').every(f => f.draw === 1));
t('fixtureById finds one and refuses an unknown', S.fixtureById('hmi-1800').watts === 1800 &&
  S.fixtureById('nope') === null && S.fixtureById('') === null);
t('support loads nobody budgets for are on the list — HMU, heaters, video village',
  ['hmu-station', 'heater', 'video-vill'].every(id => S.fixtureById(id)));

/* free text → a number the gaffer can use */
t('parseSupply reads a plain amperage', (() => { const p = S.parseSupply('100A service in the basement'); return p.amps === 100 && p.phases === 1 && p.volts === 120; })());
t('parseSupply reads 3-phase', (() => { const p = S.parseSupply('200 amp 3-phase, 120/208'); return p.amps === 200 && p.phases === 3 && p.volts === 120; })());
t('parseSupply reads a circuit count', (() => { const p = S.parseSupply('2 x 20A wall circuits'); return p.circuits === 2 && p.amps === 20; })());
t('parseSupply returns null on a note with no number in it',
  S.parseSupply('lots of power, ask the super') === null && S.parseSupply('') === null && S.parseSupply(null) === null);

/* the order against the supply */
const ORDER = [{ fixture: 'hmi-1800', qty: 2 }, { fixture: 'tung-1k', qty: 2 }, { fixture: 'led-panel', qty: 4 }];
const d1 = S.powerDemand(ORDER, { amps: 100, phases: 1, volts: 120 });
t('demand sums nameplate watts with the ballast factor', d1.watts === 1800 * 1.2 * 2 + 2000 + 1800, d1.watts);
t('demand reports kW to a tenth', d1.kw === Math.round(d1.watts / 100) / 10);
t('amps per leg is watts over 120 on a single phase', d1.ampsPerLeg === Math.round(d1.watts / 120 * 10) / 10);
t('usable amps is the 80% continuous derate', d1.usableAmps === 80 && d1.supplyAmps === 100);
t('an 8.1kW order on a 100A service is TIGHT — 67.7A of 80 usable', d1.verdict === 'tight' && d1.ampsPerLeg === 67.7, d1.verdict);
t('one more HMI pushes it past the 80% derate but still inside the service',
  S.powerDemand(ORDER.concat([{ fixture: 'hmi-1800', qty: 1 }]), { amps: 100 }).verdict === 'derate');
t('two more trips the service outright',
  S.powerDemand(ORDER.concat([{ fixture: 'hmi-1800', qty: 2 }]), { amps: 100 }).verdict === 'over');
t('every line item is itemised', d1.lines.length === 3 && d1.lines[0].qty === 2 && d1.lines[0].watts === 4320);

const SMALL = [{ fixture: 'led-panel', qty: 2 }, { fixture: 'practical', qty: 4 }];
t('a small LED package clears a 100A service', S.powerDemand(SMALL, { amps: 100 }).verdict === 'ok');
t('…and its headroom is stated in amps', S.powerDemand(SMALL, { amps: 100 }).headroomAmps > 60);

const BIG = [{ fixture: 'tung-10k', qty: 1 }, { fixture: 'tung-5k', qty: 2 }];
const over = S.powerDemand(BIG, { amps: 100, phases: 1 });
t('20kW on a 100A single-phase service is OVER the service', over.verdict === 'over' && over.ampsPerLeg > 100);
t('it says how many amps per leg it actually needs', over.needAmpsPerLeg === Math.ceil(over.ampsPerLeg / 0.8));
t('the same order on 200A three-phase is fine — the phase count is the difference',
  S.powerDemand(BIG, { amps: 200, phases: 3 }).verdict === 'ok');
t('three-phase divides the load across three legs',
  S.powerDemand(BIG, { amps: 200, phases: 3 }).ampsPerLeg === Math.round(over.ampsPerLeg / 3 * 10) / 10);

const unknown = S.powerDemand(ORDER, null);
t('an unrecorded supply is UNKNOWN, never assumed adequate',
  unknown.verdict === 'unknown' && unknown.supplyAmps === null && unknown.headroomAmps === null);
t('…and the draw is still computed so the gap is visible', unknown.watts === d1.watts && unknown.ampsPerLeg > 0);
t('powerDemand accepts the free-text note directly',
  S.powerDemand(ORDER, '200 amp 3-phase').ampsPerLeg === S.powerDemand(ORDER, { amps: 200, phases: 3 }).ampsPerLeg);
t('an empty order draws nothing and claims nothing',
  S.powerDemand([], { amps: 100 }).watts === 0 && S.powerDemand(null, null).lines.length === 0);
t('a custom wattage with no catalogue entry still counts',
  S.powerDemand([{ watts: 1500, qty: 2, name: 'Practical chandelier' }], { amps: 100 }).watts === 3000);
t('a zero quantity contributes nothing', S.powerDemand([{ fixture: 'tung-10k', qty: 0 }], { amps: 100 }).watts === 0);
t('the verdict is a sentence a producer can act on', /generator|panel|usable|trips/i.test(S.powerVerdictText(over)) &&
  /tech scout/i.test(S.powerVerdictText(unknown)));
t('the note says what it did NOT account for', /[Ii]nrush/.test(d1.note) && /80%/.test(d1.note));

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
