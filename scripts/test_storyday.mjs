#!/usr/bin/env node
/* Node tests for js/lib-storyday.js (CStoryDay) — run: node scripts/test_storyday.mjs
 *
 * The fixture is deliberately the shape the old suites avoided: a FADE IN:
 * preamble, printed scene numbers, an A-scene (4A), an I/E slugline, a
 * CONTINUOUS, a LATER, an explicit NEXT DAY, a bare heading with no time of
 * day, and a flashback. Every one of those is a different branch of the
 * derivation, and the ambiguous ones must come back UNCERTAIN rather than
 * quietly asserted.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'js/lib-storyday.js'), 'utf8'));
const SD = globalThis.CStoryDay;
const CS = globalThis.CScenes;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SCRIPT = `FADE IN:

1  INT. FARMHOUSE KITCHEN - NIGHT

Maggie sets the table.

MAGGIE
Supper's getting cold.

2  INT. FARMHOUSE HALL - CONTINUOUS

She carries the plates through.

3  EXT. COUNTRY ROAD - DAY

Tom trudges through the mud.

4  INT. BARN - LATER

Tom and the stranger fight.

4A  I/E. TRUCK CAB - DAY

The stranger drives away.

5  INT. FARMHOUSE KITCHEN - NEXT DAY

Maggie scrubs the floor.

6  INT. HOSPITAL CORRIDOR

Nobody has written a time of day on this one.

7  EXT. WHEATFIELD - DAY (FLASHBACK)

A younger Tom runs through the wheat.

8  EXT. FARMHOUSE PORCH - NIGHT

The porch light burns.
`;

const parsed = CS.parse(SCRIPT);
const scenes = parsed.scenes;

/* ── the fixture itself is the thing the old suites got wrong ── */
t('preamble is not a scene, and scene 1 is scene 1', parsed.preamble && scenes[0].label === '1');
t('the A-scene survives as its own scene', scenes.some(s => s.label === '4A'));
t('I/E slugline reads as INT/EXT', CS.byNumber(scenes, '4A').iu === 'INT/EXT');
t('nine scenes parsed', scenes.length === 9);

/* ── time-of-day classification ── */
t('todKind NIGHT', SD.todKind('NIGHT') === 'NIGHT');
t('todKind DAY words', SD.todKind('MORNING') === 'DAY' && SD.todKind('AFTERNOON') === 'DAY');
t('todKind evening is night-side', SD.todKind('DUSK') === 'NIGHT' && SD.todKind('MAGIC HOUR') === 'NIGHT');
t('todKind CONTINUOUS/LATER link to the scene before', SD.todKind('CONTINUOUS') === 'SAME' && SD.todKind('LATER') === 'SAME');
t('todKind of nothing is UNKNOWN, not DAY', SD.todKind('') === 'UNKNOWN' && SD.todKind('   ') === 'UNKNOWN');

/* ── cues read off the whole heading, not just tod ── */
const sc5 = CS.byNumber(scenes, '5');
t('CScenes leaves "NEXT DAY" in the location, not tod', sc5.tod === '' && /NEXT DAY/.test(sc5.location));
t('cueOf still finds the NEXT DAY cue', SD.cueOf(sc5).boundary === 'NEW' && SD.cueOf(sc5).confidence === SD.CERTAIN);
t('cueOf finds CONTINUOUS as a same-day cue', SD.cueOf(CS.byNumber(scenes, '2')).boundary === 'SAME');
t('cueOf flags a flashback as uncertain', (function () {
  const c = SD.cueOf(CS.byNumber(scenes, '7'));
  return c.boundary === 'NEW' && c.confidence === SD.UNCERTAIN;
})());
t('cueOf reads an explicit DAY n stamp as a pin', (function () {
  const c = SD.cueOf({ raw: 'INT. CAMP - DAY 4', body: [] });
  return c.boundary === 'PIN' && c.day === 4;
})());
t('cueOf returns null when the script said nothing', SD.cueOf(CS.byNumber(scenes, '3')) === null);

/* ── the derivation ── */
const res = SD.derive(SCRIPT);
const dayOf = (k) => SD.dayOf(res, k);
const rowOf = (k) => res.rows.filter(r => r.key === k)[0];

t('every scene gets a row, preamble excluded', res.rows.length === 9 && res.sceneCount === 9);
t('scene 1 starts story day 1, certainly', dayOf('1') === 1 && rowOf('1').confidence === SD.CERTAIN);
t('CONTINUOUS keeps scene 2 on day 1, certainly', dayOf('2') === 1 && rowOf('2').confidence === SD.CERTAIN);
t('NIGHT → DAY starts a new story day, certainly', dayOf('3') === 2 && rowOf('3').confidence === SD.CERTAIN);
t('LATER keeps scene 4 on the same day', dayOf('4') === 2 && rowOf('4').confidence === SD.CERTAIN);
t('the A-scene is carried, keyed 4A', rowOf('4A') && rowOf('4A').day === 2);
t('NEXT DAY moves scene 5 on, certainly', dayOf('5') === 3 && rowOf('5').confidence === SD.CERTAIN);
t('a heading with no time of day is UNCERTAIN, not guessed', rowOf('6').confidence === SD.UNCERTAIN &&
  /no time of day/.test(rowOf('6').reason));
t('a flashback is its own day and UNCERTAIN', dayOf('7') > dayOf('5') && rowOf('7').confidence === SD.UNCERTAIN);
t('DAY → NIGHT is same day but flagged UNCERTAIN', rowOf('8').confidence === SD.UNCERTAIN &&
  dayOf('8') === dayOf('7'));
/* 4A is the interesting one: it follows a LATER, so the clock it inherits is
   the DAY printed two scenes earlier, and DAY after DAY is exactly the case
   the script never settles. It is reported UNCERTAIN rather than folded
   silently into day 2. */
t('uncertain scenes are listed, not hidden', res.uncertain.length === 4 &&
  res.uncertain.join(',') === '4A,6,7,8');
t('certainCount and uncertain add up', res.certainCount + res.uncertain.length === res.sceneCount);
t('dayOf an unknown scene is 0, never 1', dayOf('99') === 0);
t('days carry their scenes and a label', (function () {
  const d1 = res.days[0];
  return d1.day === 1 && d1.scenes.join(',') === '1,2' && d1.label === 'Story Day 1' && d1.certain === true;
})());
t('an uncertain day says so in its label', res.days.some(d => /\?$/.test(d.label) && d.certain === false));
t('scenesOfDay returns that day only', SD.scenesOfDay(res, 2).map(r => r.key).join(',') === '3,4,4A');
t('dayLabel marks uncertainty', SD.dayLabel(3, false) === 'Story Day 3 ?' && SD.dayLabel(3, true) === 'Story Day 3');

/* ── two night scenes running: the honest answer is "we do not know" ── */
const NIGHTS = `FADE IN:

1  INT. BAR - NIGHT

He drinks.

1A  INT. MOTEL ROOM - NIGHT

He does not sleep.
`;
t('NIGHT → NIGHT defaults to the same day but is UNCERTAIN', (function () {
  const r = SD.derive(NIGHTS);
  const a = r.rows[1];
  return a.day === 1 && a.confidence === SD.UNCERTAIN && /same night/.test(a.reason);
})());
t('derive accepts scene records as well as text',
  SD.derive(CS.parse(NIGHTS).scenes).rows.length === 2);
t('derive of nothing is empty, not a fabricated day 1',
  SD.derive('').rows.length === 0 && SD.derive('').dayCount === 0);

/* ── overrides ── */
const store = SD.blankStore();
t('blankStore is empty and versioned', store.v === 1 && Object.keys(store.overrides).length === 0);
SD.setOverride(store, '8', 'NEW');
SD.setOverride(store, '6', 'SAME');
SD.nameDay(store, 1, 'The night of the storm');
const res2 = SD.derive(SCRIPT, store);
t('a manual NEW starts a day where the derivation would not', SD.dayOf(res2, '8') > SD.dayOf(res2, '7'));
t('an override is CERTAIN and marked MANUAL', (function () {
  const r = res2.rows.filter(x => x.key === '8')[0];
  return r.confidence === SD.CERTAIN && r.source === 'MANUAL' && /by hand/.test(r.reason);
})());
t('the derivation it overruled is still visible', (function () {
  const r = res2.rows.filter(x => x.key === '8')[0];
  return r.derivedBoundary === 'SAME' && r.derivedConfidence === SD.UNCERTAIN;
})());
t('overriding removes the scene from the uncertain list', res2.uncertain.indexOf('8') < 0 &&
  res2.uncertain.indexOf('6') < 0);
t('overridden scenes are listed', res2.overridden.join(',') === '6,8');
t('a named day uses its name as the label', res2.days[0].label === 'The night of the storm' &&
  res2.days[0].name === 'The night of the storm');
t('a numeric override pins the scene to that story day', (function () {
  const s = SD.setOverride(SD.blankStore(), '4A', 7);
  return SD.dayOf(SD.derive(SCRIPT, s), '4A') === 7;
})());
t('overrideFor understands NEW / SAME / a number / nothing', (function () {
  return SD.overrideFor('NEW').boundary === 'NEW' && SD.overrideFor('same').boundary === 'SAME' &&
    SD.overrideFor(3).day === 3 && SD.overrideFor('') === null && SD.overrideFor('AUTO') === null;
})());
t('clearing an override restores the derivation', (function () {
  const s = SD.setOverride(SD.setOverride(SD.blankStore(), '8', 'NEW'), '8', '');
  return Object.keys(s.overrides).length === 0 && SD.dayOf(SD.derive(SCRIPT, s), '8') === SD.dayOf(res, '8');
})());
t('override keys normalise the way a human types them', (function () {
  const s = SD.setOverride(SD.blankStore(), ' sc 4a ', 'NEW');
  return Object.prototype.hasOwnProperty.call(s.overrides, '4A');
})());
t('nameDay with an empty name clears it', (function () {
  const s = SD.nameDay(SD.nameDay(SD.blankStore(), 2, 'Wedding'), 2, '');
  return Object.keys(s.names).length === 0;
})());
t('normStore repairs a half-written store', (function () {
  const s = SD.normStore({ overrides: null });
  return s.v === 1 && typeof s.overrides === 'object' && typeof s.names === 'object';
})());

/* ── boundaryFor is the branch table, and is callable on its own ── */
t('boundaryFor: first scene always opens a day',
  SD.boundaryFor(null, scenes[0], 0).boundary === 'NEW');
t('boundaryFor: day after day is same-day but uncertain', (function () {
  const b = SD.boundaryFor({ tod: 'DAY' }, { tod: 'DAY' }, 1);
  return b.boundary === 'SAME' && b.confidence === SD.UNCERTAIN;
})());
t('boundaryFor: night into day is a certain new day', (function () {
  const b = SD.boundaryFor({ tod: 'NIGHT' }, { tod: 'DAY' }, 1);
  return b.boundary === 'NEW' && b.confidence === SD.CERTAIN;
})());

/* ── the store (no localStorage in node: it must degrade, not throw) ── */
t('readDays without localStorage returns a blank store', SD.readDays().v === 1);
t('writeDays without localStorage reports false rather than throwing', SD.writeDays(SD.blankStore()) === false);
t('the store key is the new namespaced one', SD.KEY === 'SB_StoryDays_v1');
t('the cue patterns are exported for reuse',
  SD.NEW_DAY_RE.test('THREE DAYS LATER') && SD.SAME_DAY_RE.test('LATER THAT DAY'));

console.log(`test_storyday: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
