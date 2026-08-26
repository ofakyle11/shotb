#!/usr/bin/env node
/* Node tests for js/lib-shootdays.js (CShootDays) — the shoot-day record and
 * the one take accessor.   run: node scripts/test_shootdays.mjs
 *
 * Every fixture in this file is the shape a REAL writer emits, and each one
 * names its writer in a comment. That is not decoration: the daily production
 * report shipped with printedCount permanently 0 because a suite fixture
 * invented `{status:'print'}`, a field no writer of SB_TakeLog_v1 has ever
 * produced, and the suite went green on the invention.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'js/lib-shootdays.js'), 'utf8'));
const SD = globalThis.CShootDays;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

/* A storage double. The library never reaches for a global localStorage, so
   this is the whole of the environment it needs. */
function fakeStore(init) {
  const data = Object.assign({}, init || {});
  return {
    _data: data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

/* ── the writers, quoted ──────────────────────────────────────────────────
   PLAN  — tools/sched-weather.js:105 saves exactly these keys.
   BOARD — producer/schedule-board.js:84 emits strips with {id,num,heading,
           eighths,day}; day -1 is the boneyard.
   TAKELOG — the TCore.Register at tools/tools-media-ui.js:38 declares
           [day,time,scene,take,roll,grade,note] and Register.add stamps `id`.
           `grade` is a <select>, so a circled take is literally 'Circled ⭕'.
   DAILIES — dailies/index.html:185 calls CDailies.makeTake, which returns
           {id,day,scene,slate,take,camera,circled,ngReason,notes,soundRoll,
            lens,tcIn} and wraps it in {days,takes,cur}. */
const PLAN = { date: '2026-09-12', city: 'la', lat: 34.05, lon: -118.24, skipWk: true, n: '' };
const BOARD = {
  pace: 4.5,
  mode: 'script',
  dayMeta: { 0: { call: '07:00', date: '09/14', notes: '' } },
  scenes: [
    { id: 'sc1', num: 1, heading: 'INT. FARMHOUSE KITCHEN - NIGHT', eighths: 12, day: 0, dn: 'night', cast: ['MAGGIE'] },
    { id: 'sc2', num: 2, heading: 'EXT. COUNTRY ROAD - DAY', eighths: 6, day: 0, dn: 'day', cast: [] },
    { id: 'sc3', num: 3, heading: 'INT. STUDY - NIGHT', eighths: 9, day: 1, dn: 'night', cast: ['TOM'] },
    { id: 'sc4', num: 4, heading: 'EXT. RIVER BANK - DUSK', eighths: 4, day: -1, dn: 'day', cast: [] },
  ],
};
const TAKELOG = [
  { id: 'r1', day: '2026-09-14', time: '09:12', scene: '1', take: '1', roll: 'A001', grade: '—', note: '' },
  { id: 'r2', day: '2026-09-14', time: '09:20', scene: '1', take: '2', roll: 'A001', grade: 'Circled ⭕', note: 'the one' },
  { id: 'r3', day: '2026-09-14', time: '09:31', scene: '1', take: '3', roll: 'A001', grade: 'Good', note: '' },
  { id: 'r4', day: '2026-09-15', time: '08:02', scene: '3', take: '1', roll: 'A002', grade: 'NG', note: '' },
  /* Logged before the take log carried a day at all — the shape that is still
     on real machines, and must not be silently counted on today's report. */
  { id: 'r0', time: '17:44', scene: '9', take: '1', roll: 'A000', grade: 'Circled ⭕', note: 'legacy row' },
];
const DAILIES = {
  cur: { date: '2026-09-14', unit: '2ND' },
  days: [{ date: '2026-09-14', unit: '2ND' }, { date: '2026-09-15', unit: 'MAIN' }],
  takes: [
    { id: 'd1', day: '2026-09-14', scene: '2', slate: '2A', take: 1, camera: 'A', circled: false, ngReason: 'boom in frame', notes: '', soundRoll: 'S1', lens: '35', tcIn: '' },
    { id: 'd2', day: '2026-09-14', scene: '2', slate: '2A', take: 2, camera: 'B', circled: true, ngReason: '', notes: 'print it', soundRoll: 'S1', lens: '35', tcIn: '' },
  ],
};

/* ── 1 · calendar arithmetic: the real date, with weekday skips ───────── */
t('isWeekend knows a Saturday', SD.isWeekend('2026-09-12') === true);
t('isWeekend knows a Sunday', SD.isWeekend('2026-09-13') === true);
t('isWeekend knows a Monday', SD.isWeekend('2026-09-14') === false);
t('isWeekend on junk is false, not a crash', SD.isWeekend('') === false && SD.isWeekend('nope') === false);
t('weekday names the day', SD.weekday('2026-09-14') === 'Mon');
t('addCalendarDays counts weekends', SD.addCalendarDays('2026-09-11', 3) === '2026-09-14');
t('addCalendarDays refuses junk', SD.addCalendarDays('09/14', 1) === '');
t('addShootDays steps over the weekend', SD.addShootDays('2026-09-18', 1, true) === '2026-09-21');
t('addShootDays without the rule is calendar days', SD.addShootDays('2026-09-18', 1, false) === '2026-09-19');
t('addShootDays over two weekends', SD.addShootDays('2026-09-14', 10, true) === '2026-09-28');
t('addShootDays(0) stands still', SD.addShootDays('2026-09-14', 0, true) === '2026-09-14');

/* The plan starts on a Saturday; day 1 is the Monday, exactly as the day
   planner draws it. This is the number today/index.html used to guess. */
t('day 1 skips off a weekend start', SD.firstShootDate(PLAN) === '2026-09-14');
t('day 1 stands when the start is a weekday', SD.firstShootDate({ date: '2026-09-15' }) === '2026-09-15');
t('day 1 honours skipWk:false', SD.firstShootDate({ date: '2026-09-12', skipWk: false }) === '2026-09-12');
t('no plan, no date invented', SD.firstShootDate(null) === '' && SD.firstShootDate({}) === '');
t('dateForIndex 0 is day 1', SD.dateForIndex(PLAN, 0) === '2026-09-14');
t('dateForIndex 4 is the Friday', SD.dateForIndex(PLAN, 4) === '2026-09-18');
t('dateForIndex 5 jumps the weekend', SD.dateForIndex(PLAN, 5) === '2026-09-21');
t('dateForIndex with no plan is empty', SD.dateForIndex({}, 3) === '');

/* ── 2 · the record ───────────────────────────────────────────────────── */
{
  const days = SD.build(PLAN, BOARD);
  t('build makes one record per scheduled day', days.length === 2);
  t('build stamps the derived calendar date', days[0].date === '2026-09-14' && days[1].date === '2026-09-15');
  t('build carries the strips', days[0].sceneIds.join() === 'sc1,sc2' && days[1].sceneIds.join() === 'sc3');
  t('build leaves the boneyard out', days.every((d) => !d.sceneIds.includes('sc4')));
  t('build defaults the unit and the wrap flag', days[0].unit === 'MAIN' && days[0].wrapped === false);
  t('blankDay is the same shape', Object.keys(SD.blankDay(3)).sort().join() === 'date,dayIdx,sceneIds,unit,wrapped');

  const withUnits = SD.build(PLAN, BOARD, { dailies: DAILIES });
  t('build takes the unit from the day Dailies logged', withUnits[0].unit === '2ND' && withUnits[1].unit === 'MAIN');

  const wrapped = SD.setWrapped(days, 0, true);
  t('setWrapped marks one day', wrapped[0].wrapped === true && wrapped[1].wrapped === false);
  const rebuilt = SD.build(PLAN, BOARD, { existing: wrapped, dailies: DAILIES });
  t('a rebuild keeps what a human set', rebuilt[0].wrapped === true && rebuilt[0].unit === '2ND');
  t('a rebuild still recomputes the derived halves', rebuilt[0].date === '2026-09-14' && rebuilt[0].sceneIds.join() === 'sc1,sc2');

  /* Both identities, and the join between them — the whole point of the file. */
  t('byIndex finds the day', SD.byIndex(days, 1).date === '2026-09-15');
  t('byDate finds the same day', SD.byDate(days, '2026-09-15').dayIdx === 1);
  t('indexForDate is the join key', SD.indexForDate(days, '2026-09-14') === 0);
  t('a date that is not a shoot day is -1, not 0', SD.indexForDate(days, '2026-09-19') === -1);
  t('dateForDay is the inverse', SD.dateForDay(days, 0) === '2026-09-14');
  t('dateForDay off the end is empty', SD.dateForDay(days, 9) === '');
  t('byIndex off the end is null', SD.byIndex(days, 9) === null);
  t('byDate on junk is null', SD.byDate(days, '09/14') === null);
  t('todayIndex is a lookup, not a guess', SD.todayIndex(days, '2026-09-15') === 1);
  t('todayIndex off the schedule is -1', SD.todayIndex(days, '2026-01-01') === -1);
  t('currentDay on a shoot day is that day', SD.currentDay(days, '2026-09-14').dayIdx === 0);
  t('currentDay on a dark day is the next one', SD.currentDay(days, '2026-09-13').dayIdx === 0);
  t('currentDay after wrap is the last day', SD.currentDay(days, '2026-12-01').dayIdx === 1);
  t('label reads like a call sheet', SD.label(days[0]) === 'Day 1 — Mon 2026-09-14');
  t('label names a second unit', SD.label(withUnits[0]) === 'Day 1 — Mon 2026-09-14 · 2ND unit');
  t('label of nothing is empty', SD.label(null) === '');

  t('scheduledOn is that day only', SD.scheduledOn(BOARD, 0).length === 2 && SD.scheduledOn(BOARD, 1).length === 1);
  t('scheduledOn never returns the boneyard', SD.scheduledOn(BOARD, -1).length === 0);
  t('boardDayCount counts scheduled days', SD.boardDayCount(BOARD) === 2 && SD.boardDayCount({}) === 0);

  const up = SD.upsert(days, { dayIdx: 1, date: '2026-09-15', unit: 'SPLINTER', sceneIds: ['sc3'], wrapped: true });
  t('upsert replaces in place', up.length === 2 && up[1].unit === 'SPLINTER');
  const added = SD.upsert(days, { dayIdx: 7, date: '2026-09-23' });
  t('upsert appends a day the board has not got yet', added.length === 3 && added[2].dayIdx === 7);
}

/* ── 3 · storage, with a fake store ───────────────────────────────────── */
{
  const ls = fakeStore({
    SB_ShootPlan_v1: JSON.stringify(PLAN),
    SB_ScheduleBoard_v1: JSON.stringify(BOARD),
    SB_Dailies_v1: JSON.stringify(DAILIES),
  });
  t('load on an empty store is an empty list', SD.load(ls).length === 0);
  const days = SD.sync(ls);
  t('sync builds from the plan and the board', days.length === 2 && days[0].date === '2026-09-14');
  t('sync takes the unit from Dailies', days[0].unit === '2ND');
  t('sync persisted under SB_ShootDays_v1', JSON.parse(ls.getItem('SB_ShootDays_v1')).length === 2);
  t('the store key is the one the audit named', SD.KEY === 'SB_ShootDays_v1');

  SD.save(ls, SD.setWrapped(days, 0, true));
  t('sync does not undo a wrap', SD.sync(ls)[0].wrapped === true);

  /* Dailies can start a day the stripboard has never heard of. */
  const after = SD.upsertDate(ls, '2026-10-05', { unit: 'SPLINTER' });
  t('upsertDate adds an unscheduled day', after.length === 3 && after[2].date === '2026-10-05');
  t('upsertDate gives it its own index', after[2].dayIdx === 2 && after[2].unit === 'SPLINTER');
  const again = SD.upsertDate(ls, '2026-10-05', { unit: '2ND' });
  t('upsertDate on the same date updates, not duplicates', again.length === 3 && again[2].unit === '2ND');
  t('upsertDate persists', SD.load(ls).length === 3);
  t('load sorts by day index', SD.load(ls).map((d) => d.dayIdx).join() === '0,1,2');
  t('save with no store still answers', SD.save(null, [{ dayIdx: 0 }]).length === 1);
}

/* ── 4 · the one take accessor ────────────────────────────────────────── */
{
  const stores = { takeLog: TAKELOG, dailies: DAILIES };
  const all = SD.allTakes(stores);
  t('allTakes sees BOTH stores', all.length === 7);
  t('every take names the store it came from',
    all.filter((x) => x.source === 'SB_TakeLog_v1').length === 5 &&
    all.filter((x) => x.source === 'SB_Dailies_v1').length === 2);

  const day = SD.takesOn(stores, '2026-09-14');
  t('takesOn filters to ONE day across both stores', day.length === 5);
  t('takesOn does not leak the next day', day.every((x) => x.day === '2026-09-14'));
  t('takesOn keeps the other day separate', SD.takesOn(stores, '2026-09-15').length === 1);
  t('takesOn on a dark day is empty', SD.takesOn(stores, '2026-09-19').length === 0);

  /* The bug this replaces: an undated take used to pass the `!t.date ||`
     guard and be counted on every date of the shoot. */
  t('an undated take is on no day', day.every((x) => x.id !== 'r0'));
  t('undated takes are counted, not hidden', SD.undatedTakes(stores).length === 1);

  /* 'Circled ⭕' is a <select> label; `circled` is the fact. */
  t('grade normalises to a circled boolean', SD.normTakeLogRow(TAKELOG[1]).circled === true);
  t('"Good" is not a circle', SD.normTakeLogRow(TAKELOG[2]).circled === false);
  t('"NG" is not a circle', SD.normTakeLogRow(TAKELOG[3]).circled === false);
  t('isCircledGrade reads the writer\'s own option', SD.isCircledGrade(SD.CIRCLED_GRADE) === true);
  t('isCircledGrade is not fooled by "Good"', SD.isCircledGrade('Good') === false);
  t('a Dailies boolean survives unchanged', SD.normDailiesTake(DAILIES.takes[1]).circled === true);
  t('circledTakes counts both stores', SD.circledTakes(day).length === 2);

  const norm = SD.normTakeLogRow(TAKELOG[1]);
  t('a take-log row normalises to the common shape',
    norm.scene === '1' && norm.take === 2 && norm.roll === 'A001' &&
    norm.note === 'the one' && norm.camera === 'A' && norm.slate === '');
  const dnorm = SD.normDailiesTake(DAILIES.takes[1]);
  t('a Dailies row normalises to the same shape',
    dnorm.scene === '2' && dnorm.slate === '2A' && dnorm.take === 2 &&
    dnorm.camera === 'B' && dnorm.roll === 'S1' && dnorm.note === 'print it');
  t('a Dailies NG take reports its grade', SD.normDailiesTake(DAILIES.takes[0]).grade === 'NG');
  t('the two normalisers agree on every key',
    Object.keys(norm).sort().join() === Object.keys(dnorm).sort().join());
  t('either store may be absent', SD.allTakes({ dailies: DAILIES }).length === 2 &&
    SD.allTakes({ takeLog: TAKELOG }).length === 5 && SD.allTakes(null).length === 0);
  t('a Register wrapped in {rows} is read too', SD.allTakes({ takeLog: { rows: TAKELOG } }).length === 5);
  t('the take-store keys are the real ones',
    SD.TAKELOG_KEY === 'SB_TakeLog_v1' && SD.DAILIES_KEY === 'SB_Dailies_v1' &&
    SD.PLAN_KEY === 'SB_ShootPlan_v1' && SD.BOARD_KEY === 'SB_ScheduleBoard_v1' &&
    SD.DEFAULT_UNIT === 'MAIN');
}

console.log(`test_shootdays: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
