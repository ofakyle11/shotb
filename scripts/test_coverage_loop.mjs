#!/usr/bin/env node
/* The coverage loop — planned scenes against shot scenes.
 *   run: node scripts/test_coverage_loop.mjs
 *
 * WHAT THIS SUITE IS FOR
 * Both ends of this loop already existed and were never joined. The stripboard
 * (SB_ScheduleBoard_v1) knows which scenes were scheduled on which day index;
 * the shoot-day record (SB_ShootDays_v1) turns that index into a calendar date;
 * the two take logs know what was shot on that date. Nothing compared them, so
 * "we did not get scene 24" was not a wrong answer anywhere — it was no answer
 * at all, an unshot scene silently absent from a coverage report.
 *
 * The fixture is therefore built to fail in exactly that way: scene 24 is
 * scheduled on day 2 and never shot, its A-scene 24A IS shot the same day (so a
 * report that keys on the numeric base would call 24 covered), one scene is
 * missed and picked up two days later, one is shot without being scheduled,
 * and one strip on the board matches no scene in the screenplay at all.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'js/lib-shootdays.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'dailies/lib-dailies.js'), 'utf8'));
const D = globalThis.CDailies;
const SD = globalThis.CShootDays;
const CS = globalThis.CScenes;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

/* A shooting script: a FADE IN: preamble, printed scene numbers that do not
   start at 1, and an A-scene that is not scene 24. */
const SCRIPT = `FADE IN:

23  INT. FARMHOUSE KITCHEN - NIGHT

Maggie sets the table for three and lays out the good knives.

24  INT. STUDY - NIGHT

Tom loads the shotgun by lamplight. The safe stands open behind him.

24A  EXT. PORCH - NIGHT

Headlights swing across the boards. Tom does not move.

25  EXT. RIVER BANK - DUSK

The current takes the letter away.`;

const SCENES = CS.parse(SCRIPT).scenes;
t('the fixture is a four-scene shooting script numbered 23, 24, 24A, 25',
  SCENES.map(s => s.label).join(',') === '23,24,24A,25');

/* producer/schedule-board.js strips: {id, num (ORDINAL), heading, eighths, day}.
   The strip never carries the printed scene number as a field — it is inside
   the heading, which is why the join has to read it out of there. */
const BOARD = { scenes: [
  { id: 'sc1', num: 1, heading: '23  INT. FARMHOUSE KITCHEN - NIGHT', eighths: 8, day: 0 },
  { id: 'sc2', num: 2, heading: '24  INT. STUDY - NIGHT', eighths: 12, day: 1 },
  { id: 'sc3', num: 3, heading: '24A  EXT. PORCH - NIGHT', eighths: 4, day: 1 },
  { id: 'sc4', num: 4, heading: '25  EXT. RIVER BANK - DUSK', eighths: 6, day: 2 },
  { id: 'scX', num: 9, heading: 'INT. A SCENE NOBODY WROTE - DAY', eighths: 2, day: 1 }
] };

/* The day planner's plan; day 0 is Monday 2026-09-07. */
const PLAN = { date: '2026-09-07', skipWk: true };
const DAYS = SD.build(PLAN, BOARD, {}).map(d => Object.assign({}, d, { wrapped: true }));
t('the shoot days come off the board and the plan, not off a hand-typed date',
  DAYS.length === 3 && DAYS[0].date === '2026-09-07' && DAYS[2].date === '2026-09-09');
t('byDate resolves the day the takes are stamped with',
  SD.byDate(DAYS, '2026-09-08').dayIdx === 1);

/* SB_Dailies_v1 takes. Day 2 (2026-09-08) shot 24A and never got 24.
   Scene 25 was scheduled for day 3 and was not shot until day 3 — it was, so
   nothing to report there; scene 23 was scheduled day 1 and missed, then
   picked up on day 3. */
const dailies = { takes: [
  { id: 'd1', day: '2026-09-08', scene: '24A', slate: '24AA', take: 1, camera: 'A', circled: true, notes: 'headlights' },
  { id: 'd2', day: '2026-09-08', scene: '24A', slate: '24AA', take: 2, camera: 'A', circled: false, notes: '' },
  { id: 'd3', day: '2026-09-09', scene: '23', slate: '23A', take: 1, camera: 'A', circled: false, notes: 'pick-up' },
  { id: 'd4', day: '2026-09-09', scene: '99', slate: '99A', take: 1, camera: 'A', circled: false, notes: 'insert' }
] };
/* SB_TakeLog_v1 — the Tools → Slate Register. Its circle is the display string
   'Circled ⭕' in `grade`, and its rows carry no slate at all. */
const takeLog = [
  { id: 'r1', day: '2026-09-09', time: '18:02', scene: '25', take: '1', roll: 'A004', grade: 'Circled ⭕', note: 'the letter' }
];
const STORES = { takeLog: takeLog, dailies: dailies };

const cov = D.coverageAgainstSchedule({
  board: BOARD, shootDays: DAYS, scriptText: SCRIPT, stores: STORES, asOf: '2026-09-10'
});

/* ── the answer the whole loop exists to produce ── */
t('scene 24 is reported as scheduled and never shot',
  cov.missed.length === 1 && cov.missed[0].key === '24');
t('the gap names the day and the date it was scheduled on',
  cov.missed[0].dayIdx === 1 && cov.missed[0].date === '2026-09-08');
t('the gap is a sentence somebody can act on, not a statistic',
  /Scene 24 .*INT\. STUDY - NIGHT.* scheduled on Day 2 \(2026-09-08\) and NO take was logged/.test(cov.missed[0].note) &&
  /1 4\/8 pages unshot/.test(cov.missed[0].note));
t('the missed pages are carried as eighths',
  cov.missed[0].eighths === 12 && cov.totals.missedEighths === 12);

/* ── the A-scene must not cover the scene it is an insert to ── */
t('24A being shot does NOT count as coverage of 24',
  cov.days[1].scheduled.filter(r => r.key === '24')[0].shot === false &&
  cov.days[1].scheduled.filter(r => r.key === '24A')[0].shot === true);
t('the A-scene carries its own take and circle counts', (() => {
  const a = cov.days[1].scheduled.filter(r => r.key === '24A')[0];
  return a.takes === 2 && a.circled === 1;
})());

/* ── missed on the day, picked up later, is a different fact ── */
t('a scene missed on its day and picked up later is not on the missed list',
  cov.missed.every(r => r.key !== '23') && cov.pickedUp.length === 1 && cov.pickedUp[0].key === '23');
t('the pick-up says which day it was recovered on',
  /picked up on Day 3/.test(cov.pickedUp[0].note));

/* ── everything the join could not do, said out loud ── */
t('a strip matching no scene in the screenplay is reported, not skipped',
  cov.unmatchedStrips.length === 1 && /NOBODY WROTE/.test(cov.unmatchedStrips[0].heading));
t('takes against a scene the screenplay does not have are reported',
  cov.notInScript.length === 1 && cov.notInScript[0].key === '99' &&
  /this screenplay has no scene 99/.test(cov.notInScript[0].note));
t('a scene shot on a day it was not scheduled for is reported as unplanned',
  cov.unplanned.length === 1 && cov.unplanned[0].key === '23' && cov.unplanned[0].dayIdx === 2);

/* ── the other take store counts as coverage ── */
t('a take logged in Tools → Slate covers its scene here',
  cov.days[2].scheduled.filter(r => r.key === '25')[0].shot === true);
t('and its circle survives the crossing',
  cov.days[2].scheduled.filter(r => r.key === '25')[0].circled === 1);

/* ── a day that has not happened is not a gap ── */
const early = D.coverageAgainstSchedule({
  board: BOARD, shootDays: SD.build(PLAN, BOARD, {}), scriptText: SCRIPT, stores: STORES, asOf: '2026-09-08'
});
t('an unwrapped day still ahead of the calendar is not judged',
  early.totals.judgedDays === 1 && early.days[1].dayOver === false && early.days[2].dayOver === false);
t('nothing on a future day is called a gap', early.missed.every(r => r.dayIdx === 0));
t('a wrapped day is judged whatever the calendar says', (() => {
  const one = SD.build(PLAN, BOARD, {}).map(d => Object.assign({}, d, { wrapped: d.dayIdx === 1 }));
  const c = D.coverageAgainstSchedule({ board: BOARD, shootDays: one, scriptText: SCRIPT, stores: STORES });
  return c.totals.judgedDays === 1 && c.missed.length === 1 && c.missed[0].key === '24';
})());
t('with no asOf and nothing wrapped, nothing is judged and the report says so', (() => {
  const c = D.coverageAgainstSchedule({ board: BOARD, shootDays: SD.build(PLAN, BOARD, {}), scriptText: SCRIPT, stores: STORES });
  return c.totals.judgedDays === 0 && c.missed.length === 0 &&
    /No shoot day has wrapped yet/.test(D.missedText(c));
})());

/* ── totals ── */
t('the totals count strips, not scenes',
  cov.totals.scheduled === 4 && cov.totals.shot === 2 && cov.totals.missed === 1 && cov.totals.pickedUp === 1);
t('every scheduled day is reported, wrapped or not', cov.days.length === 3 && cov.totals.judgedDays === 3);
t('a scene on no strip at all is a schedule gap, not a coverage gap', (() => {
  const thin = { scenes: BOARD.scenes.filter(s => s.id !== 'sc4') };
  const c = D.coverageAgainstSchedule({ board: thin, shootDays: DAYS, scriptText: SCRIPT, stores: STORES, asOf: '2026-09-10' });
  const hit = c.neverScheduled.filter(r => r.key === '25')[0];
  return c.neverScheduled.length === 1 && hit && /is on no strip of the stripboard/.test(hit.note) && hit.shot === true;
})());

/* ── the text export ── */
const text = D.missedText(cov, { production: 'Night Harvest', asOf: '2026-09-10' });
t('the text export is headed and names the production',
  /SCHEDULED AND NOT SHOT — Night Harvest/.test(text) && /As of 2026-09-10/.test(text));
t('the text export carries the gap and the outstanding pages',
  /Scene 24/.test(text) && /1 scene\(s\) scheduled and never shot/.test(text) && /1 4\/8 pages outstanding/.test(text));
t('the text export carries the pick-up and the unmatched strip',
  /picked up on Day 3/.test(text) && /NOBODY WROTE/.test(text));
t('a clean day reports nothing rather than nothing-shaped', (() => {
  const all = { takes: [
    { id: 'a1', day: '2026-09-07', scene: '23', slate: '23A', take: 1, circled: true },
    { id: 'a2', day: '2026-09-08', scene: '24', slate: '24A', take: 1, circled: true },
    { id: 'a3', day: '2026-09-08', scene: '24A', slate: '24AA', take: 1, circled: true },
    { id: 'a4', day: '2026-09-09', scene: '25', slate: '25A', take: 1, circled: true }
  ] };
  const c = D.coverageAgainstSchedule({ board: BOARD, shootDays: DAYS, scriptText: SCRIPT,
                                        stores: { dailies: all }, asOf: '2026-09-10' });
  return c.missed.length === 0 && /Nothing\. Every scene scheduled on the 3 day\(s\)/.test(D.missedText(c));
})());

/* ── the strip→scene join itself ── */
t('a strip is joined by the printed number inside its own heading', (() => {
  const hit = D.stripScene(SCENES, BOARD.scenes[2]);
  return hit.scene.key === '24A' && hit.how === 'number';
})());
t('a strip whose heading lost its number falls back to the heading text', (() => {
  const hit = D.stripScene(SCENES, { id: 'x', num: 2, heading: 'INT. STUDY - NIGHT' });
  return hit.scene.key === '24' && hit.how === 'heading';
})());
t('an ordinal is NOT an identity on a numbered script', (() => {
  const hit = D.stripScene(SCENES, { id: 'x', num: 2, heading: 'Scene 2' });
  return hit.scene === null && hit.how === '';
})());
t('on an unnumbered draft the ordinal is all there is, and it resolves', (() => {
  const plain = CS.parse('INT. A - DAY\n\nOne.\n\nINT. B - NIGHT\n\nTwo.').scenes;
  const hit = D.stripScene(plain, { id: 'x', num: 2, heading: 'Scene 2' });
  return hit.scene.label === '2' && hit.how === 'ordinal';
})());

/* ── takeSceneKey, the other half of the join ── */
t('a take names its scene by the printed identity', D.takeSceneKey(SCENES, { scene: ' sc 24a ' }) === '24A');
t('a take with no scene falls back to its slate', D.takeSceneKey(SCENES, { scene: '', slate: '24B' }) === '24');
t('a take against a scene the script does not have keeps its own identity',
  D.takeSceneKey(SCENES, { scene: '77' }) === '77');
t('a take with neither has no identity and is not counted anywhere',
  D.takeSceneKey(SCENES, { scene: '', slate: '' }) === '');

/* ── the guards ── */
t('dayIsOver: wrapped wins over the calendar',
  D.dayIsOver({ wrapped: true, date: '2099-01-01' }, '2026-09-10') === true &&
  D.dayIsOver({ wrapped: false, date: '2026-09-10' }, '2026-09-10') === false &&
  D.dayIsOver({ wrapped: false, date: '2026-09-09' }, '2026-09-10') === true);
t('eighthsLabel speaks in pages and eighths',
  D.eighthsLabel(12) === '1 4/8 pages' && D.eighthsLabel(8) === '1 page' &&
  D.eighthsLabel(3) === '3/8 pages' && /no page count/.test(D.eighthsLabel(0)));
t('an empty board and no days is safe and says nothing', (() => {
  const c = D.coverageAgainstSchedule({ scriptText: SCRIPT });
  return c.missed.length === 0 && c.days.length === 0 && c.neverScheduled.length === 4;
})());
t('coverageAgainstSchedule refuses to guess without the shoot-day record', (() => {
  const keep = globalThis.CShootDays;
  delete globalThis.CShootDays;
  let threw = false;
  try { D.coverageAgainstSchedule({ scriptText: SCRIPT }); } catch (e) { threw = /lib-shootdays/.test(e.message); }
  globalThis.CShootDays = keep;
  return threw;
})());

console.log(`test_coverage_loop: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
