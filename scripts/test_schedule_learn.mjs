/* The schedule: cast weeks with a real drop/pick-up, six-day weeks, the
 * assembled call sheet, and the planned-vs-achieved learning loop.
 *
 * Run: node scripts/test_schedule_learn.mjs
 *
 * Why this suite exists, in one line each:
 *   · finding 39 — the DOOD billed eighteen idle days because it could not
 *     express a drop, and the same wrong number was computed in TWO files;
 *   · finding 4  — the call sheet printed a DOOD letter and nothing else,
 *     while every missing field sat one hop away in another store;
 *   · finding 44 — planned eighths and achieved eighths both existed and
 *     nobody compared them, so `4.5 pages/day` survived every film.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['js/lib-money-math.js', 'js/lib-money-accounts.js', 'js/lib-money-sheet.js',
                 'js/lib-shootdays.js', 'tools/lib-money.js', 'tools/lib-sun.js',
                 'timeline/timeline-doc.js', 'timeline/timeline-budget.js',
                 'producer/schedule-board.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
const { SBBudget, SBScheduleBoard: SB, CShootDays: SD, TMoney, TSun } = globalThis;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.error('FAIL  ' + name + (extra !== undefined ? ' — got: ' + JSON.stringify(extra) : '')); }
}

/* ══ fixtures ══════════════════════════════════════════════════════════
   A numbered shooting script with a FADE IN: preamble and an A-scene — the
   two inputs that break most scene numbering — and money in cents. */
const SCRIPT = [
  'FADE IN:',
  '',
  '1  INT. FARMHOUSE KITCHEN - NIGHT',
  '',
  'MAGGIE sets the table. A shotgun leans by the door. RAY watches from the hall.',
  'She pours coffee. Nobody speaks. Outside, a truck idles.',
  '',
  '1A  INT. FARMHOUSE HALL - CONTINUOUS',
  '',
  'RAY carries the plates through. MAGGIE follows him with the pot.',
  '',
  '2  EXT. COUNTRY ROAD - DAY',
  '',
  'A rusted truck rattles past. DEL waves from the cab and keeps driving.',
  '',
  '3  EXT. FARMHOUSE PORCH - DAY',
  '',
  'MAGGIE watches the road. DEL climbs the steps. They do not shake hands.',
].join('\n');

/* Day rates and a weekly quote in cents, not round dollars: the rounding
   bugs live in the cents, and a cast week is a money number. */
const WEEKLY_SCALE_CENTS = 432_675;      // $4,326.75 — one SAG Basic week
const DAY_SCALE_CENTS = 124_612;         // $1,246.12

/* ══ 1 · castWeeks — the one arithmetic ════════════════════════════════ */
{
  /* The order card's worked example: a performer on day 2 and day 20.
     0-based day indices, so 1 and 19. */
  const w = SBBudget.castWeeks([1, 19]);
  check('span is still 19 days', w.spanDays === 19, w.spanDays);
  check('continuous quote is the old 4 weeks', w.contWeeks === 4, w.contWeeks);
  check('drop/pick-up bills 2 weeks', w.spanWeeks === 2, w.spanWeeks);
  check('2 cast weeks saved', w.savedWeeks === 2, w.savedWeeks);
  check('one drop recorded', w.drops.length === 1 && w.drops[0].after === 1 && w.drops[0].pickUp === 19, w.drops);
  check('17 free days in the gap', w.drops[0].freeDays === 17, w.drops[0].freeDays);
  check('drop notice owed the day before the drop', w.drops[0].noticeBy === 0, w.drops[0].noticeBy);
  /* A drop on the performer's very first day cannot owe notice on a day that
     does not exist — the index clamps at day 1 rather than printing "Day 0". */
  check('notice never falls before day 1', SBBudget.castWeeks([0, 20]).drops[0].noticeBy === 0,
    SBBudget.castWeeks([0, 20]).drops[0].noticeBy);
  check('eighteen idle days are no longer billed', w.droppedDays === 17 && w.holdDays === 0, { d: w.droppedDays, h: w.holdDays });
  check('two segments, one day each', w.segments.length === 2 && w.segments.every(s => s.days === 1), w.segments);
  /* The money, in cents, is the whole point of the finding. */
  const savedCents = w.savedWeeks * WEEKLY_SCALE_CENTS;
  check('worked example saves $8,653.50 at SAG Basic weekly scale', savedCents === 865_350, savedCents);

  /* A gap too short to be a legal drop stays a HOLD and is still billed. */
  const short = SBBudget.castWeeks([0, 5]);
  check('a 4-day gap is a hold, not a drop', short.drops.length === 0 && short.droppedDays === 0, short.drops);
  check('short gap still bills the whole span', short.spanWeeks === short.contWeeks, [short.spanWeeks, short.contWeeks]);
  check('the idle days are counted as holds', short.holdDays === 4, short.holdDays);

  /* Exactly at the threshold: 10 free days qualifies, 9 does not. */
  check('10 free days qualifies', SBBudget.castWeeks([0, 11]).drops.length === 1);
  check('9 free days does not', SBBudget.castWeeks([0, 10]).drops.length === 0);

  /* maxDrops caps how many times one performer may be dropped, and the
     BIGGEST gap is the one taken. */
  const two = SBBudget.castWeeks([0, 12, 40]);
  check('one drop by default, the widest gap', two.drops.length === 1 && two.drops[0].after === 12, two.drops);
  const twoAllowed = SBBudget.castWeeks([0, 12, 40], { maxDrops: 2 });
  check('maxDrops 2 takes both gaps', twoAllowed.drops.length === 2, twoAllowed.drops);
  check('two drops beat one', twoAllowed.spanWeeks < two.spanWeeks, [twoAllowed.spanWeeks, two.spanWeeks]);
  check('maxDrops 0 restores the old continuous quote',
    SBBudget.castWeeks([1, 19], { maxDrops: 0 }).spanWeeks === 4);

  /* Weekly minimum guarantee: a re-engagement starts a new week. */
  check('each segment carries its own weekly minimum',
    SBBudget.castWeeks([0, 30]).segments.every(s => s.weeks === 1));

  /* Degenerate inputs must not invent a week. */
  check('no worked days → no weeks', SBBudget.castWeeks([]).spanWeeks === 0);
  check('duplicate days collapse', SBBudget.castWeeks([3, 3, 3]).workDays === 1);
  check('unsorted input is sorted', SBBudget.castWeeks([19, 1]).spanDays === 19);
}

/* ══ 2 · the two implementations agree ═════════════════════════════════
   Before deleting one of two copies you prove they answer alike. The board
   path (real day assignments) and the estimator path (script order) now run
   the SAME castWeeks; this pins that they do, on the gap case. */
{
  const scenes = [
    { id: 's1', num: 1, heading: 'INT. A - DAY', eighths: 8, dn: 'day', cast: ['MAGGIE', 'RAY'], day: 1 },
    { id: 's2', num: 2, heading: 'INT. B - DAY', eighths: 8, dn: 'day', cast: ['RAY'], day: 5 },
    { id: 's3', num: 3, heading: 'EXT. C - DAY', eighths: 8, dn: 'day', cast: ['MAGGIE'], day: 19 },
  ];
  const m = SB.doodMatrix(scenes);
  const maggie = m.rows.find(r => r.name === 'MAGGIE');
  const direct = SBBudget.castWeeks([1, 19]);
  check('board DOOD and castWeeks agree on weeks', maggie.wks === direct.spanWeeks, [maggie.wks, direct.spanWeeks]);
  check('board DOOD and castWeeks agree on the saving', maggie.sav === direct.savedWeeks, [maggie.sav, direct.savedWeeks]);
  check('board DOOD and castWeeks agree on dropped days', maggie.drp === direct.droppedDays, [maggie.drp, direct.droppedDays]);

  /* The board's override object is what the estimator consumes — the row IS
     the castWeeks answer, not a second copy of three of its fields. */
  const ov = SB.boardOverridesModel(scenes);
  check('castDood row carries the full castWeeks answer',
    ov.castDood.MAGGIE.spanWeeks === direct.spanWeeks &&
    ov.castDood.MAGGIE.workDays === direct.workDays &&
    ov.castDood.MAGGIE.savedWeeks === direct.savedWeeks, ov.castDood.MAGGIE);

  /* DOOD codes say what happened. */
  const codes = maggie.codes;
  /* Codes compose: MAGGIE starts, works and is dropped on the same day, then
     is picked up, works and finishes on the same day. A branch chain has to
     pick one, and picking is how a drop that owes notice goes unprinted. */
  check('start, work AND drop on the same day is SWD', codes[1] === 'SWD', codes);
  check('dropped days print as dropped, not held', codes[10] === '—', codes);
  check('pick-up, work and finish on the same day is PWF', codes[19] === 'PWF', codes);
  check('the code spells out for the call sheet', SB.statusOf('SWD') === 'START · DROP AFTER TODAY', SB.statusOf('SWD'));
  check('a hold spells out as HOLD', SB.statusOf('H') === 'HOLD');
  check('RAY, whose gap is short, is held', m.rows.find(r => r.name === 'RAY').codes[3] === 'H', m.rows.find(r => r.name === 'RAY').codes);
  check('matrix totals the saving', m.savedWeeks === 2 && m.drops === 1, { s: m.savedWeeks, d: m.drops });

  /* The pick-up code appears when a performer comes back mid-schedule. */
  const back = SB.doodMatrix([
    { id: 'a', num: 1, heading: 'INT. A - DAY', eighths: 8, dn: 'day', cast: ['DEL'], day: 0 },
    { id: 'b', num: 2, heading: 'INT. B - DAY', eighths: 8, dn: 'day', cast: ['DEL'], day: 15 },
    { id: 'c', num: 3, heading: 'INT. C - DAY', eighths: 8, dn: 'day', cast: ['DEL'], day: 16 },
  ]).rows[0];
  check('work-then-drop is coded WD', back.codes[0] === 'SWD', back.codes);
  check('pick-up work is coded PW', back.codes[15] === 'PW', back.codes);
}

/* ══ 3 · six- and seven-day weeks ══════════════════════════════════════ */
{
  const five = SBBudget.weekPremium(5), six = SBBudget.weekPremium(6), seven = SBBudget.weekPremium(7);
  check('a five-day week carries no premium', five.mult === 1, five);
  check('six-day premium comes from TMoney, not a copy', six.source === 'TMoney.TC_DEFAULTS' &&
    six.sixthDayMult === TMoney.TC_DEFAULTS.sixthDayMult, six);
  check('six-day week averages (5+1.5)/6', Math.abs(six.mult - 6.5 / 6) < 1e-12, six.mult);
  check('seven-day week averages (5+1.5+2)/7', Math.abs(seven.mult - 8.5 / 7) < 1e-12, seven.mult);
  check('premiums are ordered', five.mult < six.mult && six.mult < seven.mult);

  /* A six-day week shortens the calendar AND raises the crew day. */
  const state = { projectName: 'Farmhouse', scriptText: SCRIPT.repeat(60), clips: [],
                  characters: { MAGGIE: {}, RAY: {}, DEL: {} }, locationBible: [], parseResult: null, global: {} };
  const a = SBBudget.analyze(state);
  const p5 = SBBudget.estimateProduction(a, { scale: 'indie', incentive: 'none' });
  const p6 = SBBudget.estimateProduction(a, { scale: 'indie', incentive: 'none', daysPerWeek: 6 });
  check('same shoot days either way', p5.schedule.shootDays === p6.schedule.shootDays, [p5.schedule.shootDays, p6.schedule.shootDays]);
  check('six-day week is reported on the schedule', p6.schedule.daysPerWeek === 6, p6.schedule);
  check('six-day week finishes in fewer calendar weeks', p6.schedule.totalWeeks < p5.schedule.totalWeeks,
    [p5.schedule.totalWeeks, p6.schedule.totalWeeks]);
  const crewLine = p => Object.keys(p.groups['Production (below the line)']).find(k => k.startsWith('5000'));
  check('the 6th day costs more per crew day',
    p6.groups['Production (below the line)'][crewLine(p6)][0] >
    p5.groups['Production (below the line)'][crewLine(p5)][0]);
  check('cast weeks follow the working week',
    SBBudget.castWeeks([0, 1, 2, 3, 4, 5], { daysPerWeek: 6 }).spanWeeks === 1 &&
    SBBudget.castWeeks([0, 1, 2, 3, 4, 5], { daysPerWeek: 5 }).spanWeeks === 2);
}

/* ══ 4 · the learning loop ═════════════════════════════════════════════ */
{
  const scenes = [
    { id: 'sc1', num: 1, heading: 'INT. KITCHEN - NIGHT', eighths: 16, dn: 'night', cast: ['MAGGIE'], day: 0 },
    { id: 'sc2', num: '1A', heading: 'INT. HALL - NIGHT', eighths: 8, dn: 'night', cast: ['RAY'], day: 0 },
    { id: 'sc3', num: 2, heading: 'EXT. ROAD - DAY', eighths: 24, dn: 'day', cast: ['DEL'], day: 1 },
    { id: 'sc4', num: 3, heading: 'EXT. PORCH - DAY', eighths: 16, dn: 'day', cast: ['MAGGIE'], day: 2 },
    { id: 'sc5', num: 4, heading: 'INT. BARN - DAY', eighths: 16, dn: 'day', cast: ['DEL'], day: 3 },
    { id: 'sc6', num: 5, heading: 'INT. LOFT - DAY', eighths: 16, dn: 'day', cast: ['DEL'], day: 3 },
  ];
  const board = { pace: 4.5, scenes, dayMeta: {}, mode: 'script', paceLog: [] };

  /* A scene is worth its eighths ONCE, however many takes it took. */
  const takesD0 = [
    { scene: '1', take: 1 }, { scene: '1', take: 2 }, { scene: '1', take: 3 },
    { scene: '1A', take: 1 },
  ];
  const ach = SB.achievedEighths(scenes, takesD0);
  check('three takes of one scene count its pages once', ach.eighths === 24, ach);
  check('A-scene matched by its printed number', ach.sceneIds.indexOf('sc2') >= 0, ach.sceneIds);
  check('a take naming no scene is ignored', SB.achievedEighths(scenes, [{ take: 1 }]).eighths === 0);
  check('a take naming an unknown scene is ignored', SB.achievedEighths(scenes, [{ scene: '99' }]).eighths === 0);
  check('a strip id also matches', SB.achievedEighths(scenes, [{ scene: 'sc3' }]).eighths === 24);

  const days = [
    { dayIdx: 0, date: '2026-09-07', unit: 'MAIN', sceneIds: ['sc1', 'sc2'], wrapped: true },
    { dayIdx: 1, date: '2026-09-08', unit: 'MAIN', sceneIds: ['sc3'], wrapped: true },
    { dayIdx: 2, date: '2026-09-09', unit: 'MAIN', sceneIds: ['sc4'], wrapped: true },
    /* Today: two scenes on the call sheet, one of them shot so far. Half a
       day looks like catastrophic underperformance, which is why wrapped is
       the gate. */
    { dayIdx: 3, date: '2026-09-10', unit: 'MAIN', sceneIds: ['sc5', 'sc6'], wrapped: false },
  ];
  const takesByDate = {
    '2026-09-07': takesD0,
    '2026-09-08': [{ scene: '2', take: 1 }],
    '2026-09-09': [{ scene: '3', take: 1 }, { scene: '3', take: 2 }],
    '2026-09-10': [{ scene: '4', take: 1 }],
  };
  const rows = SB.paceRowsModel({
    board, shootDays: days, takesFor: (rec) => takesByDate[rec.date] || []
  });
  check('only wrapped days are recorded', rows.length === 3 && rows.every(r => r.dayIdx !== 3), rows.map(r => r.dayIdx));
  check('row carries the required shape', Object.keys(rows[0]).sort().join(',') ===
    'achievedEighths,date,dayIdx,plannedEighths,sceneIds', Object.keys(rows[0]).sort());
  check('planned eighths come from the board', rows[0].plannedEighths === 24 && rows[1].plannedEighths === 24, rows);
  check('achieved eighths come from the take log', rows.map(r => r.achievedEighths).join() === '24,24,16', rows);

  /* the mid-shoot day is exactly the poison this excludes */
  const withPartial = SB.paceRowsModel({
    board, shootDays: days.map(d => ({ ...d, wrapped: true })),
    takesFor: (rec) => takesByDate[rec.date] || []
  });
  check('the mid-shoot day has achieved half of what it planned', withPartial.length === 4 &&
    withPartial[3].plannedEighths === 32 && withPartial[3].achievedEighths === 16, withPartial[3]);
  check('and counting it would drag the learned pace down',
    SB.learnedPace(withPartial).pagesPerDay < SB.learnedPace(rows).pagesPerDay,
    [SB.learnedPace(withPartial).pagesPerDay, SB.learnedPace(rows).pagesPerDay]);

  /* the median, the threshold, and what shows below it */
  const n0 = SB.learnedPace([]);
  check('n=0 returns the shipped default', n0.pagesPerDay === SB.DEFAULT_PACE && n0.pagesPerDay === 4.5, n0);
  check('n=0 says it is NOT learned', n0.learned === false && n0.source === 'default', n0);
  check('n=0 reports the count as zero', n0.learnedN === 0, n0);
  check('n=0 label names it the shipped default',
    /shipped default/.test(SB.paceLabel(SB.resolvePace({}, []))), SB.paceLabel(SB.resolvePace({}, [])));
  check('the threshold is 3 wrapped days', SB.MIN_PACE_EVIDENCE === 3 && n0.minN === 3, n0.minN);

  const n2 = SB.learnedPace(rows.slice(0, 2));
  check('two wrapped days is still not enough', n2.learned === false && n2.pagesPerDay === 4.5, n2);
  check('but the count is visible below the threshold', n2.learnedN === 2, n2);
  check('below-threshold label states how many are needed',
    /2 wrapped days so far, 3 needed/.test(SB.paceLabel(SB.resolvePace({}, rows.slice(0, 2)))),
    SB.paceLabel(SB.resolvePace({}, rows.slice(0, 2))));

  const n3 = SB.learnedPace(rows);
  check('three wrapped days learns', n3.learned === true && n3.source === 'wrapped days', n3);
  check('learned pace is the MEDIAN of achieved eighths (24,24,16 → 24/8)', n3.pagesPerDay === 3, n3);
  check('learnedN is reported alongside', n3.learnedN === 3, n3);
  check('learned label shows the count',
    /learned from 3 wrapped days/.test(SB.paceLabel(SB.resolvePace({}, rows))), SB.paceLabel(SB.resolvePace({}, rows)));
  check('the learned number is not the shipped default', n3.pagesPerDay !== SB.DEFAULT_PACE);

  /* one catastrophic day cannot move a median the way it moves a mean */
  const withDisaster = rows.concat([{ dayIdx: 9, date: '2026-09-18', plannedEighths: 24, achievedEighths: 1, sceneIds: [] }]);
  const mean = withDisaster.reduce((a, r) => a + r.achievedEighths, 0) / withDisaster.length / 8;
  check('median resists one disaster day the mean does not',
    SB.learnedPace(withDisaster).pagesPerDay > mean, { median: SB.learnedPace(withDisaster).pagesPerDay, mean });

  /* the learned pace actually drives the fill */
  const fresh = scenes.map(s => ({ ...s, day: -1 }));
  SB.autoScheduleModel(fresh, SB.resolvePace({}, rows).pace, 'script');
  const dflt = scenes.map(s => ({ ...s, day: -1 }));
  SB.autoScheduleModel(dflt, SB.resolvePace({}, []).pace, 'script');
  const daysOf = list => list.reduce((m, s) => Math.max(m, s.day), -1) + 1;
  check('a slower learned pace boards more days', daysOf(fresh) > daysOf(dflt), [daysOf(fresh), daysOf(dflt)]);

  /* a pace the user typed still wins */
  const mine = SB.resolvePace({ pace: 6, paceSet: true }, rows);
  check('a pace you set overrules the learned one', mine.pace === 6 && mine.userSet === true, mine);
  check('and the learned number is still reported next to it',
    /wrapped days ran 3 pg\/day/.test(SB.paceLabel(mine)), SB.paceLabel(mine));

  /* the log is idempotent */
  const merged = SB.mergePaceLog(rows, rows);
  check('re-recording the same days does not double the log', merged.length === 3, merged.length);
  const updated = SB.mergePaceLog(rows, [{ dayIdx: 1, date: '2026-09-08', plannedEighths: 24, achievedEighths: 32, sceneIds: [] }]);
  check('re-wrapping a day replaces its row', updated.length === 3 && updated[1].achievedEighths === 32, updated[1]);
}

/* ══ 5 · the call sheet is assembled, not typed ════════════════════════ */
{
  const scenes = [
    { id: 'sc1', num: 1, heading: 'INT. FARMHOUSE KITCHEN - NIGHT', eighths: 16, dn: 'night', cast: ['MAGGIE'], day: 0, tags: { stunts: true }, extras: 12, notes: '' },
    { id: 'sc2', num: '1A', heading: 'INT. GAS STATION - NIGHT', eighths: 8, dn: 'night', cast: ['RAY'], day: 0, tags: {}, extras: 0, notes: '' },
    { id: 'sc3', num: 2, heading: 'EXT. COUNTRY ROAD - DAY', eighths: 16, dn: 'day', cast: ['DEL'], day: 1, tags: {}, extras: 0, notes: '' },
    { id: 'sc4', num: 3, heading: 'EXT. FARMHOUSE PORCH - DAY', eighths: 8, dn: 'day', cast: ['MAGGIE'], day: 2, tags: {}, extras: 0, notes: '' },
    { id: 'sc5', num: 4, heading: 'INT. BARN - DAY', eighths: 8, dn: 'day', cast: ['MAGGIE'], day: 20, tags: {}, extras: 0, notes: '' },
  ];
  const board = {
    pace: 4.5, daysPerWeek: 5, mode: 'script', paceLog: [], scenes,
    dayMeta: { 0: { call: '7:00 AM', notes: 'Cold night — hot drinks at basecamp.' },
               /* 5:00 AM tomorrow is inside a 10-hour turnaround off tonight's
                  estimated wrap — the sheet has to say so. */
               1: { call: '5:00 AM' } }
  };
  const shootDays = [0, 1, 2, 20].map(i => ({
    dayIdx: i, date: SD.dateForIndex({ date: '2026-09-07', skipWk: true }, i), unit: 'MAIN', sceneIds: [], wrapped: false
  }));
  const scout = { locations: [
    { name: 'FARMHOUSE KITCHEN', address: '14 Mill Rd', hospital: 'St. Anne General', hospitalAddress: '900 Queen St', parking: 'Field east of the barn — 20 trucks', loadIn: 'Rear porch, 3 steps, no ramp' },
    { name: 'COUNTRY ROAD', address: 'Mill Rd at County 8', hospital: 'St. Anne General', hospitalAddress: '900 Queen St', parking: 'Shoulder, coned', loadIn: 'Tailgate' },
  ] };
  const crew = [
    { name: 'Ada Reyes', role: '1st AD', dept: 'Production' },
    { name: 'Ben Cole', role: 'Operator', dept: 'Camera' },
    { name: 'Cy Nunes', role: 'Gaffer', dept: 'G&E' },
    { name: 'Dot Hale', role: 'Mixer', dept: 'Sound' },
    { name: 'Eli Voss', role: 'Key HMU', dept: 'HMU' },
  ];
  const plan = { date: '2026-09-07', lat: 43.65, lon: -79.38, skipWk: true, tz: -240, tzSource: 'api' };
  const input = { board, day: 0, shootDays, plan, scout, crew, tc: TMoney.TC_DEFAULTS, sun: TSun, project: 'The Last Tide' };
  const cs = SB.callSheetModel(input);

  /* identity — from SB_ShootDays_v1, not a hand-typed MM/DD */
  check('the day carries its real calendar date', cs.date === '2026-09-07', cs.date);
  check('and its weekday', cs.weekday === 'Mon', cs.weekday);
  check('day N of M', cs.dayNumber === 1 && cs.dayCount === 21, [cs.dayNumber, cs.dayCount]);

  /* the clock — every time derived from ONE typed call */
  check('shooting call is 30 min after crew call', cs.timeText.shooting === '7:30 AM', cs.timeText);
  check('breakfast is served before crew call', cs.timeText.breakfast === '6:30 AM', cs.timeText.breakfast);
  check('lunch is TMoney mealAfter hours from call', cs.timeText.lunch === '1:00 PM', cs.timeText.lunch);
  check('back in after TMoney mealLenMin', cs.timeText.lunchBack === '1:30 PM', cs.timeText.lunchBack);
  check('second meal is due six hours after that', cs.timeText.secondMeal === '7:30 PM', cs.timeText.secondMeal);
  check('estimated wrap is the 12-hour day plus the meal', cs.timeText.estWrap === '7:30 PM', cs.timeText.estWrap);
  check('earliest next call honours the 10-hour turnaround', cs.timeText.nextEarliest === '5:30 AM +1', cs.timeText.nextEarliest);
  check('the meal rule is quoted, not implied', cs.mealRule === '6 hrs from call, 30 min', cs.mealRule);

  /* cast — individual calls, not one letter */
  const maggie = cs.castCalls.find(c => c.name === 'MAGGIE');
  const ray = cs.castCalls.find(c => c.name === 'RAY');
  check('every working performer has an individual call', maggie.callText && ray.callText, cs.castCalls);
  check('a performer in scene 1 is called for the first shot', maggie.onSetText === '7:30 AM', maggie);
  check('cast call backs off HMU + wardrobe', maggie.callText === '6:30 AM', maggie.callText);
  check('a performer whose first scene is later is called later',
    SB.clockMins(ray.onSetText) > SB.clockMins(maggie.onSetText), [ray.onSetText, maggie.onSetText]);
  check('DOOD status is spelled out, not just lettered', maggie.status === 'START' && maggie.code === 'SW', maggie);
  check('a performer not working today is not on the sheet', !cs.castCalls.find(c => c.name === 'DEL'), cs.castCalls.map(c => c.name));

  /* the drop shows up as a remark with a notice date */
  const day20 = SB.callSheetModel({ ...input, day: 20 });
  const back = day20.castCalls.find(c => c.name === 'MAGGIE');
  check('the pick-up day says PICK-UP', back && /PICK-UP/.test(back.status), back);
  const day2 = SB.callSheetModel({ ...input, day: 2 });
  const dropped = day2.castCalls.find(c => c.name === 'MAGGIE');
  check('the drop day carries a drop notice', /Drop notice due 2026-09-08/.test(dropped.remark), dropped.remark);

  /* crew — one call per department, from the directory */
  const dept = n => cs.deptCalls.find(c => c.dept === n);
  check('a call per department', cs.deptCalls.length === 5, cs.deptCalls.map(c => c.dept));
  check('camera calls with the unit', dept('Camera').callText === '7:00 AM', dept('Camera'));
  check('G&E pre-calls', dept('G&E').callText === '6:30 AM', dept('G&E'));
  check('HMU pre-calls furthest', dept('HMU').callText === '6:00 AM', dept('HMU'));
  check('the crew are named under their department', dept('Camera').names[0] === 'Ben Cole', dept('Camera').names);

  /* walkie card — the departments this show actually has */
  check('a walkie channel per crewed department', cs.walkie.length === 5, cs.walkie);
  check('production is channel 1', cs.walkie[0].ch === 1 && cs.walkie[0].dept === 'Production', cs.walkie[0]);
  check('no channel for a department nobody is on', !cs.walkie.find(w => w.dept === 'Art'), cs.walkie.map(w => w.dept));

  /* locations + the safety line */
  check('sets resolved from the sluglines', cs.locations.map(l => l.set).join() === 'FARMHOUSE KITCHEN,GAS STATION', cs.locations.map(l => l.set));
  check('the scout card supplies the address', cs.locations[0].address === '14 Mill Rd', cs.locations[0]);
  check('parking comes from the scout book', /20 trucks/.test(cs.locations[0].parking), cs.locations[0].parking);
  check('load-in comes from the scout book', /Rear porch/.test(cs.locations[0].loadIn), cs.locations[0].loadIn);
  check('nearest hospital is on the sheet', cs.hospital.name === 'St. Anne General' && cs.hospital.address === '900 Queen St', cs.hospital);
  check('an unmatched set says so rather than inventing a card', cs.locations[1].matched === false, cs.locations[1]);

  /* sun — the LOCATION's clock, not the browser's */
  check('sunrise and sunset are on the sheet', /^\d{2}:\d{2}$/.test(cs.sun.sunrise) && /^\d{2}:\d{2}$/.test(cs.sun.sunset), cs.sun);
  check('sunrise is before sunset at the location clock', cs.sun.sunrise < cs.sun.sunset, cs.sun);
  check('golden hour is on the sheet', !!cs.sun.goldenPM, cs.sun);
  check('the timezone is named', /UTC/.test(cs.sun.tzLabel), cs.sun.tzLabel);
  check('a pinned offset is not flagged as estimated', cs.sun.tzEstimated === false, cs.sun);
  const est = SB.callSheetModel({ ...input, plan: { ...plan, tzSource: 'est' } });
  check('an estimated offset IS flagged', est.sun.tzEstimated === true, est.sun);

  /* advance schedule */
  check('two days of advance schedule', cs.advance.length === 2, cs.advance);
  check('the advance names the next real date', cs.advance[0].date === '2026-09-08', cs.advance[0]);
  check('the advance carries sets, scenes and pages',
    cs.advance[0].sets.join() === 'COUNTRY ROAD' && cs.advance[0].eighths === 16, cs.advance[0]);
  check('a short turnaround on tomorrow is flagged', cs.advance[0].turnaroundShort === true, cs.advance[0]);

  /* scene block still carries what it always did, plus the tags */
  check('scene rows carry eighths, cast and BG', cs.scenes[0].eighths === 16 && cs.scenes[0].extras === 12, cs.scenes[0]);
  check('breakdown tags reach the sheet', cs.scenes[0].tags.join() === 'stunts', cs.scenes[0].tags);
  check('the day totals its pages', cs.eighths === 24, cs.eighths);

  /* revisions */
  check('an unissued sheet says so', cs.revision.n === 0 && cs.revision.label === 'CALL SHEET' && cs.revision.issued === false, cs.revision);
  const meta1 = { ...board.dayMeta[0] };
  meta1.issues = SB.issueSheet(meta1, cs.signature, '2026-09-06');
  const issued = SB.callSheetModel({ ...input, board: { ...board, dayMeta: { ...board.dayMeta, 0: meta1 } } });
  check('an issued, unchanged sheet is not a revision', issued.revision.label === 'CALL SHEET' && issued.revision.issued === true, issued.revision);
  check('re-issuing an unchanged sheet does not bump the letter',
    SB.issueSheet(meta1, cs.signature, '2026-09-06').length === 1, meta1.issues);
  const moved = { ...board, dayMeta: { ...board.dayMeta, 0: { ...meta1, call: '8:00 AM' } } };
  const changed = SB.callSheetModel({ ...input, board: moved });
  check('a changed sheet is flagged as pending Rev. A',
    changed.revision.changed === true && /REV\. A PENDING/.test(changed.revision.label), changed.revision);
  const meta2 = { ...moved.dayMeta[0] };
  meta2.issues = SB.issueSheet(meta2, changed.signature, '2026-09-06');
  const revA = SB.callSheetModel({ ...input, board: { ...moved, dayMeta: { ...moved.dayMeta, 0: meta2 } } });
  check('re-issuing after a change stamps Rev. A', revA.revision.label === 'CALL SHEET — REV. A', revA.revision);

  /* gaps are stated, never left blank */
  const bare = SB.callSheetModel({ board: { scenes, dayMeta: {} }, day: 0 });
  check('no call time → the sheet says so', bare.gaps.some(g => /No general crew call/.test(g)), bare.gaps);
  check('no shoot-day record → the sheet says so', bare.gaps.some(g => /No calendar date/.test(g)), bare.gaps);
  check('no crew directory → the sheet says so', bare.gaps.some(g => /SB_Crew_v1/.test(g)), bare.gaps);
  check('no hospital → the sheet says so', bare.gaps.some(g => /hospital/i.test(g)), bare.gaps);
  const noTc = SB.callSheetModel({ board, day: 0, shootDays, plan, scout, crew, sun: TSun });
  check('no TMoney → meal times are reported missing, not invented',
    noTc.gaps.some(g => /TMoney/.test(g)) && noTc.timeText.lunch === '' && noTc.timeText.estWrap === '',
    { gaps: noTc.gaps, t: noTc.timeText });
  check('but the call time it WAS given is still honoured', noTc.timeText.general === '7:00 AM', noTc.timeText);

  /* clock parsing accepts what an AD actually types */
  check("clockMins '7:00 AM'", SB.clockMins('7:00 AM') === 420);
  check("clockMins '0700'", SB.clockMins('0700') === 420);
  check("clockMins '7a'", SB.clockMins('7a') === 420);
  check("clockMins '12:30 AM' is after midnight", SB.clockMins('12:30 AM') === 30);
  check("clockMins '12:30 PM' is after noon", SB.clockMins('12:30 PM') === 750);
  check("clockMins '17:45'", SB.clockMins('17:45') === 1065);
  check('clockMins rejects nonsense', SB.clockMins('soon') === null && SB.clockMins('99:99') === null);
  check('clockFmt marks the next day', SB.clockFmt(1470) === '12:30 AM +1', SB.clockFmt(1470));

  /* a day-player rate in cents, so the sheet's arithmetic is exercised in the
     units the money actually lives in */
  check('a two-day player at scale is $2,492.24', DAY_SCALE_CENTS * 2 === 249_224);
}

console.log(fail ? '\n' + fail + ' FAILURES (' + pass + ' passed)' : '\ntest_schedule_learn: ' + pass + ' passed, 0 failed');
process.exit(fail ? 1 : 0);
