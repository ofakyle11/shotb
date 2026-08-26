/* Smoke test for producer/ suite modules — run: node scripts/test_producer_suite.mjs */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['js/lib-money-math.js', 'js/lib-money-accounts.js', 'js/lib-money-sheet.js',
                 'timeline/timeline-doc.js', 'timeline/timeline-budget.js', 'producer/budget-sheet.js', 'producer/schedule-board.js', 'producer/incentives.js']) {
  (0, eval)(readFileSync(join(root, f), 'utf8'));
}
const { SBBudget, SBBudgetSheet, SBScheduleBoard } = globalThis;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name + (extra != null ? ' — got: ' + JSON.stringify(extra) : '')); }
}

// ── budget sheet model ──
const sheet = SBBudgetSheet.blankSheet();
/* 19 now: wave 1 pulled fringes out of General Expenses onto their own
   CAccounts.FRINGE_ACCT ('20000') line. Contingency (19000) stays computed. */
check('19 categories (contingency auto, fringes seeded)', sheet.categories.length === 19, sheet.categories.length);
check('accounts 1000..18000 then 20000', sheet.categories[0].acct === '1000'
  && sheet.categories[17].acct === '18000' && sheet.categories[18].acct === '20000');

const it = { amt: '3', units: '10', rate: '500', est: 999, actual: 0 };
check('amt×units×rate wins over manual est', SBBudgetSheet.itemEst(it) === 15000, SBBudgetSheet.itemEst(it));
check('manual est when calc incomplete', SBBudgetSheet.itemEst({ amt: '3', units: '', rate: '500', est: 999 }) === 999);

sheet.categories[0].items = [{ id: 'a', desc: 'x', amt: '', units: '', rate: '', est: 100000, actual: 90000, notes: '' }];
sheet.categories[1].items = [{ id: 'b', desc: 'y', amt: '2', units: '5', rate: '1000', est: 0, actual: 0, notes: '' }];
for (let i = 2; i < sheet.categories.length; i++) sheet.categories[i].items = [];
const tot = SBBudgetSheet.sheetTotals(sheet);
check('subtotal sums categories', tot.subtotal === 110000, tot.subtotal);
check('contingency 10%', Math.abs(tot.contingency - 11000) < 1e-9, tot.contingency);
check('grand = subtotal + contingency', Math.abs(tot.grand - 121000) < 1e-9, tot.grand);
check('actuals tracked', tot.actual === 90000, tot.actual);

// ── seeding from the estimator ──
/* A NUMBERED shooting script with a FADE IN: preamble and an A-scene — the
   two inputs that make most of this codebase's scene numbering start at 2 and
   lose A-scenes. The preamble is written once, outside the repeat, because a
   title card appears once in a screenplay and counting it as a scene is the
   exact defect the fixture exists to catch. */
const SCENE_PAIR = [
  '1  INT. WAREHOUSE - NIGHT',
  '',
  'JACK fights two MEN. An EXPLOSION. A CROWD scatters. Gunshots everywhere as the roof burns.',
  '',
  'JACK',
  'Move!',
  '',
  '1A  EXT. HARBOR - DAY',
  '',
  'MAYA dives into the water as the boat chase ends in a crash.',
  '',
  'MAYA',
  'Go!',
  '',
  ''
].join('\n');
const SCRIPT = 'FADE IN:\n\n' + SCENE_PAIR.repeat(10);
const state = { projectName: 'T', scriptText: SCRIPT, clips: [], characters: { JACK: {}, MAYA: {}, DRIVER: {} }, locationBible: [], parseResult: null, global: {} };
const analysis = SBBudget.analyze(state);
const prod = SBBudget.estimateProduction(analysis, {});
const seeded = SBBudgetSheet.seedFromEstimate(SBBudgetSheet.blankSheet(), prod);
const stot = SBBudgetSheet.sheetTotals(seeded);
check('seeded grand total > 0', stot.grand > 100000, stot.grand);
check('seeded grand within estimator range', stot.grand > prod.total.low * 0.8 && stot.grand < prod.total.high * 1.2, { grand: stot.grand, range: [prod.total.low, prod.total.high] });
const cast = seeded.categories.find(c => c.acct === '4000');
check('cast lines routed to 4000', cast.items.length >= 3, cast.items.length);
const noCont = seeded.categories.every(c => !c.items.some(i => /contingency/i.test(i.desc)));
check('contingency not seeded as line (auto)', noCont);

// ── schedule board ──
const scenes = SBScheduleBoard.scenesFromScript(state);
check('strips built from script', scenes.length >= 10, scenes.length);
check('the FADE IN: preamble is not a strip', !/FADE IN/i.test(scenes[0].heading), scenes[0].heading);
check('A-scenes reach the board', scenes.some(s => /^1A\b/.test(s.heading)), scenes.slice(0, 3).map(s => s.heading));
check('the scene number prefix is stripped from the set name',
  SBScheduleBoard.locOf(scenes[0].heading) === 'WAREHOUSE', SBScheduleBoard.locOf(scenes[0].heading));
check('night strip detected', scenes.some(s => s.dn === 'night'));
check('cast attached to strips', scenes.some(s => s.cast.includes('JACK')));
check('all strips start unscheduled', scenes.every(s => s.day === -1));

SBScheduleBoard.autoScheduleModel(scenes, 1); // 1 page/day pace → multi-day board
const maxDay = scenes.reduce((m, s) => Math.max(m, s.day), -1);
check('auto-schedule assigns all scenes', scenes.every(s => s.day >= 0));
check('multiple days for long script', maxDay >= 1, maxDay);
// no day over pace unless a single scene exceeds it
const perDay = {};
scenes.forEach(s => { perDay[s.day] = (perDay[s.day] || 0) + s.eighths; });
const over = Object.entries(perDay).filter(([d, e]) => e > 8).filter(([d]) => scenes.filter(s => s.day == d).length > 1);
check('no multi-scene day exceeds pace', over.length === 0, perDay);

const dood = SBScheduleBoard.doodMatrix(scenes);
check('dood has rows and days', dood.rows.length >= 2 && dood.days === maxDay + 1, { rows: dood.rows.length, days: dood.days });
const jack = dood.rows.find(r => r.name === 'JACK');
check('JACK spans schedule', jack && jack.tot >= jack.wrk && jack.wrk >= 1, jack);
check('codes start with S and end with F (multi-day)', jack.wrk < 2 ||
  (/^S/.test(jack.codes.find(c => c)) && /F$/.test([...jack.codes].reverse().find(c => c))), jack && jack.codes);
check('holds = span - work - dropped', jack.hld === jack.tot - jack.wrk - jack.drp, jack);
const single = SBScheduleBoard.doodMatrix([{ day: 0, eighths: 1, cast: ['SOLO'] }]);
check('single-day role coded SWF', single.rows[0].codes[0] === 'SWF', single.rows[0]);

check('formatEighths 15 → 1 7/8', SBScheduleBoard.formatEighths(15) === '1 7/8', SBScheduleBoard.formatEighths(15));
check('formatEighths 8 → 1', SBScheduleBoard.formatEighths(8) === '1');
check('formatEighths 3 → 3/8', SBScheduleBoard.formatEighths(3) === '3/8');

// ── parseEighths ──
check('parseEighths "1 7/8" → 15', SBScheduleBoard.parseEighths('1 7/8') === 15);
check('parseEighths "7/8" → 7', SBScheduleBoard.parseEighths('7/8') === 7);
check('parseEighths "15" → 15 eighths', SBScheduleBoard.parseEighths('15') === 15);
check('parseEighths "2.5" pages → 20', SBScheduleBoard.parseEighths('2.5') === 20);
check('parseEighths garbage → null', SBScheduleBoard.parseEighths('abc') === null);

// ── location-grouped auto-schedule ──
const locScenes = [
  { id: 'a', num: 1, heading: 'INT. WAREHOUSE - NIGHT', eighths: 8, dn: 'night', cast: [], day: -1 },
  { id: 'b', num: 2, heading: 'EXT. HARBOR - DAY', eighths: 8, dn: 'day', cast: [], day: -1 },
  { id: 'c', num: 3, heading: 'INT. WAREHOUSE - DAY', eighths: 8, dn: 'day', cast: [], day: -1 },
  { id: 'd', num: 4, heading: 'EXT. HARBOR - NIGHT', eighths: 8, dn: 'night', cast: [], day: -1 },
];
SBScheduleBoard.autoScheduleModel(locScenes, 2, 'location'); // 16 eighths/day → 2 scenes per day
const dayOf = Object.fromEntries(locScenes.map(s => [s.id, s.day]));
check('location grouping keeps sets together', dayOf.a === dayOf.c && dayOf.b === dayOf.d && dayOf.a !== dayOf.b, dayOf);
check('locOf strips prefix', SBScheduleBoard.locOf('INT. WAREHOUSE - NIGHT') === 'WAREHOUSE');

// ── board overrides (breakdown tags + real DOOD) ──
const ovScenes = [
  { id: 'x1', num: 1, heading: 'INT. A - DAY', eighths: 4, dn: 'day', cast: ['JACK'], day: 0, tags: { stunts: true }, extras: 20, notes: '' },
  { id: 'x2', num: 2, heading: 'INT. A - DAY', eighths: 4, dn: 'day', cast: ['JACK', 'MAYA'], day: 0, tags: { stunts: true, sfx: true }, extras: 0, notes: '' },
  { id: 'x3', num: 3, heading: 'EXT. B - DAY', eighths: 4, dn: 'day', cast: ['JACK'], day: 4, tags: {}, extras: 30, notes: '' },
];
const ov = SBScheduleBoard.boardOverridesModel(ovScenes);
check('castDood from board days', ov.castDood.JACK.workDays === 2 && ov.castDood.JACK.spanDays === 5, ov.castDood.JACK);
check('spanWeeks from span', ov.castDood.JACK.spanWeeks === 1, ov.castDood.JACK.spanWeeks);
/* Finding 39: a 3-day gap is a hold and is still billed; the drop only opens
   once the gap is wide enough to be one. Both answers come from the SAME
   SBBudget.castWeeks the estimator uses — see scripts/test_schedule_learn.mjs
   for the agreement proof. */
check('a short gap is not a drop', ov.castDood.JACK.drops.length === 0 && ov.castDood.JACK.holdDays === 3, ov.castDood.JACK);
const gapScenes = ovScenes.map(sc => sc.id === 'x3' ? { ...sc, day: 20 } : { ...sc });
const gapOv = SBScheduleBoard.boardOverridesModel(gapScenes);
check('a genuine gap becomes a drop', gapOv.castDood.JACK.drops.length === 1, gapOv.castDood.JACK.drops);
check('the drop cuts the cast weeks', gapOv.castDood.JACK.spanWeeks === 2 &&
  gapOv.castDood.JACK.contWeeks === 5 && gapOv.castDood.JACK.savedWeeks === 3, gapOv.castDood.JACK);
check('a six-day week is carried to the estimator',
  SBScheduleBoard.boardOverridesModel(ovScenes, { daysPerWeek: 6 }).daysPerWeek === 6);
check('stuntDays = distinct tagged days', ov.unitOverrides.stuntDays === 1, ov.unitOverrides);
check('pyroDays from sfx tag', ov.unitOverrides.pyroDays === 1, ov.unitOverrides);
check('extrasDays summed', ov.unitOverrides.extrasDays === 50, ov.unitOverrides);
check('no overrides for empty board', Object.keys(SBScheduleBoard.boardOverridesModel([{ id: 'q', num: 1, heading: 'INT. A - DAY', eighths: 4, dn: 'day', cast: [], day: -1 }])).length === 0);

// ── overrides flow into the estimator ──
const base = SBBudget.estimateProduction(analysis, { scale: 'indie' });
const shortDood = {};
(analysis.rankedNames || []).forEach(n => { shortDood[n] = { workDays: 1, spanDays: 1, spanWeeks: 1 }; });
const withDood = SBBudget.estimateProduction(analysis, { scale: 'indie', castDood: shortDood });
const supKey = k => Object.keys(k.groups['Above the line']).find(x => x.includes('4100'));
const supLow = p => p.groups['Above the line'][supKey(p)][0];
check('tight board DOOD lowers supporting cast cost', supLow(withDood) <= supLow(base), { base: supLow(base), withDood: supLow(withDood) });
const noUnits = SBBudget.estimateProduction(analysis, { scale: 'indie', unitOverrides: { stuntDays: 0, pyroDays: 0, waterDays: 0, animalDays: 0, extrasDays: 10 } });
const unitsKey = p => Object.keys(p.groups['Production (below the line)']).find(x => x.includes('9900'));
check('unit overrides zero out special units', noUnits.groups['Production (below the line)'][unitsKey(noUnits)][1] === 0, noUnits.groups['Production (below the line)'][unitsKey(noUnits)]);
check('estimator reports the working week it used', base.schedule.daysPerWeek === 5 && base.schedule.weekPremium.mult === 1, base.schedule);
check('estimator reports what the drops saved', typeof base.dood.savedWeeks === 'number' && typeof base.dood.drops === 'number', base.dood);

// ── CSV export ──
/* Money in cents: a top sheet whose lines are round dollars never asks the
   arithmetic to carry a fraction, and the rounding bugs live in the cents. */
{
  const centsSheet = SBBudgetSheet.blankSheet();
  centsSheet.categories.forEach(c => { c.items = []; });
  centsSheet.categories[0].items = [{ id: 'c1', desc: 'Option', amt: '3', units: '5', rate: '1061.64', est: 0, actual: 0, notes: '' }];
  centsSheet.categories[1].items = [{ id: 'c2', desc: 'Producer', amt: '', units: '', rate: '', est: 12345.67, actual: 12345.68, notes: '' }];
  check('amt x units x rate keeps the cents', SBBudgetSheet.itemEst(centsSheet.categories[0].items[0]) === 15924.6,
    SBBudgetSheet.itemEst(centsSheet.categories[0].items[0]));
  const ct = SBBudgetSheet.sheetTotals(centsSheet);
  check('cents subtotal is exact, not a float tail', ct.subtotal === 28270.27, ct.subtotal);
  check('cents contingency rounds half away from zero', ct.contingency === 2827.03, ct.contingency);
  check('cents actuals survive the round trip', ct.actual === 12345.68, ct.actual);
  check('csv writes fixed 2-decimal money, never a float tail',
    SBBudgetSheet.sheetToCsv(centsSheet).indexOf('15924.60') >= 0, SBBudgetSheet.sheetToCsv(centsSheet).split('\n')[1]);
}

const csvSheet = SBBudgetSheet.blankSheet();
csvSheet.categories[0].items = [{ id: 'z', desc: 'Option, purchase "rights"', amt: '', units: '', rate: '', est: 50000, actual: 0, notes: '' }];
for (let i = 1; i < csvSheet.categories.length; i++) csvSheet.categories[i].items = [];
const csv = SBBudgetSheet.sheetToCsv(csvSheet);
check('csv has header + grand total', csv.startsWith('Account,') && csv.includes('GRAND TOTAL'), csv.split('\n')[0]);
check('csv quotes commas/quotes', csv.includes('"Option, purchase ""rights"""'), csv.split('\n')[1]);
check('csv grand includes contingency', csv.includes('GRAND TOTAL,,,,' + Math.round(55000)) || csv.split('\n').pop().includes('55000'), csv.split('\n').pop());

// ══ Sales forecast engine ══
{
  (0, eval)(readFileSync(join(root, 'producer/sales-forecast.js'), 'utf8'));
  const { SBSales } = globalThis;

  // quantile forecast
  const fc = SBSales.forecastGross({ budget: 10e6, genre: 'Drama', starTier: 'name', window: 'fall', rating: 'R' });
  check('gross quantiles monotonic', fc.gross.p10 < fc.gross.p25 && fc.gross.p25 < fc.gross.p50 && fc.gross.p50 < fc.gross.p75 && fc.gross.p75 < fc.gross.p90, fc.gross);
  check('bracket picked for $10M', fc.bracket === '$5–20M', fc.bracket);
  const horror = SBSales.forecastGross({ budget: 10e6, genre: 'Horror', starTier: 'name', window: 'fall', rating: 'R' });
  check('horror beats drama at same budget', horror.gross.p50 > fc.gross.p50, { h: horror.gross.p50, d: fc.gross.p50 });
  const franchise = SBSales.forecastGross({ budget: 10e6, genre: 'Drama', starTier: 'name', window: 'fall', rating: 'R', franchise: true });
  check('franchise lifts the band', Math.abs(franchise.gross.p50 / fc.gross.p50 - 1.7) < 0.01, franchise.gross.p50 / fc.gross.p50);
  const jan = SBSales.forecastGross({ budget: 10e6, genre: 'Drama', starTier: 'name', window: 'january', rating: 'R' });
  check('january dump hurts', jan.gross.p50 < fc.gross.p50);
  check('failure rate surfaced', SBSales.FAILURE_RATE > 0.1 && SBSales.FAILURE_RATE < 0.2, SBSales.FAILURE_RATE);

  // waterfall: studio $100M film grossing 2.5x should be modestly profitable,
  // and breakeven should land near the classic 2-2.5x rule
  const wf = SBSales.waterfall(250e6, 100e6, { strategy: 'studio', genre: 'Action' });
  check('2.5x studio film is profitable', wf.net > 0, wf.net);
  check('breakeven near 2-2.5x rule', wf.breakevenGross / 100e6 > 1.8 && wf.breakevenGross / 100e6 < 2.8, wf.breakevenGross / 100e6);
  const flop = SBSales.waterfall(80e6, 100e6, { strategy: 'studio', genre: 'Action' });
  check('0.8x studio film loses money', flop.net < 0, flop.net);
  check('rentals ~43% of gross', Math.abs(wf.rentals / wf.gross - 0.428) < 1e-9);
  check('lifetime > rentals (ancillary)', wf.lifetime > wf.rentals);
  const iwf = SBSales.waterfall(7.5e6, 3e6, { strategy: 'indie', genre: 'Drama' });
  check('indie 2.5x profitable with agent fee', iwf.net > 0 && iwf.agent > 0, iwf.net);

  // pre-sales: totals in the researched 30-50% band for a name lead
  const ps = SBSales.presales(3e6, 'name');
  check('presales total 30-50% of budget', ps.pctLow >= 0.28 && ps.pctHigh <= 0.53, { low: ps.pctLow, high: ps.pctHigh });
  check('12 territories', ps.rows.length === 12, ps.rows.length);
  check('net after commission below gross MGs', ps.netHigh < ps.totalHigh);
  const psA = SBSales.presales(3e6, 'alist');
  check('a-list lead lifts territory value', psA.totalHigh > ps.totalHigh);

  // buyouts
  const bo = SBSales.buyoutComps(2e6);
  check('buyout comps ordered', bo.typical[0] < bo.typical[1] && bo.breakout[0] < bo.breakout[1] && bo.breakout[1] === 20e6);
}

// ── documentary mode ──
{
  const { SBDoc } = globalThis;
  const DOCSCRIPT = [
    'WORKING TITLE: THE LAST TIDE — a feature documentary treatment',
    '',
    'ACT ONE. We open on ARCHIVAL newsreel footage of the 1968 flood.',
    'NARRATOR (V.O.) sets the stakes over drone AERIALS of the delta.',
    '',
    'INTERVIEW: DR. ELENA VASQUEZ, hydrologist. She walks us through the maps.',
    'INTERVIEW WITH MARCUS COLE, the last shrimper on the east bank.',
    '',
    'We follow MARCUS (VERITE) through a dawn haul. B-ROLL: nets, gulls, ice.',
    'TRAVEL TO New Orleans. ON LOCATION IN Baton Rouge.',
    '',
    'ELENA VASQUEZ: The levee data tells one story. The water tells another.',
    'MARCUS COLE: My father worked this bank. His father before him.',
    'ELENA VASQUEZ: By 2040 this parish is open water.',
    '',
    'ARCHIVAL: home movies from the Cole family, 8mm, 1970s.',
    'MUSIC CUE: original score builds. ANIMATION: the delta shrinking, mapped.',
    'RE-ENACTMENT: the night of the breach, stylized.',
    'STOCK FOOTAGE of Hurricane season. NEWSREEL: the evacuation.'
  ].join('\n');
  const dst = { projectName: 'Doc', scriptText: DOCSCRIPT, clips: [], characters: {}, locationBible: [], parseResult: null, global: {} };
  const da = SBBudget.analyze(dst);
  check('doc analysis attached to analyze()', !!da.doc);
  check('treatment reads as documentary', da.doc.isDocLike === true, da.doc.docScore);
  check('subjects detected from interviews + speakers', da.doc.subjectCount >= 2, da.doc.subjects);
  check('archival cues counted', da.doc.counts.archival >= 3, da.doc.counts.archival);

  const dprod = SBBudget.estimateProduction(da, { mode: 'documentary', docScale: 'indie', docMusic: 'mixed', incentive: 'none' });
  check('doc estimate returns documentary mode', dprod.mode === 'documentary');
  check('doc groups use doc accounts', !!dprod.groups['Rights — archival & music']);
  check('doc total is a low<high band', dprod.total.low > 0 && dprod.total.low < dprod.total.high, dprod.total);
  check('indie doc total in plausible band ($250k–$2M)', dprod.total.likely > 250e3 && dprod.total.likely < 2e6, dprod.total.likely);
  check('edit calendar scales with runtime (ADE ~1mo/10min)', dprod.docSchedule.editWeeks >= 15, dprod.docSchedule.editWeeks);
  const d90 = SBBudget.estimateProduction(da, { mode: 'documentary', docScale: 'indie', runtimeMin: 90, incentive: 'none' });
  check('90-min feature edits ~8-10 months', d90.docSchedule.editWeeks >= 30 && d90.docSchedule.editWeeks <= 48, d90.docSchedule.editWeeks);
  check('shooting ratio reported', dprod.docSchedule.shootingRatio >= 10 && dprod.docSchedule.shootingRatio <= 80, dprod.docSchedule.shootingRatio);
  check('archival auto-set from cues', dprod.tiers.archival.id !== 'none', dprod.tiers.archival.id);
  check('grants panel data present', dprod.grants.length >= 5, dprod.grants.length);

  const ny = SBBudget.estimateProduction(da, { mode: 'documentary', docScale: 'indie', incentive: 'newyork' });
  check('NY excludes documentaries', ny.recovery && ny.recovery.excluded === true, ny.recovery);
  const ga = SBBudget.estimateProduction(da, { mode: 'documentary', docScale: 'indie', incentive: 'georgia' });
  check('Georgia docs capped at 20% base', ga.recovery && !ga.recovery.excluded &&
    ga.recovery.high <= ga.total.high * 0.75 * 0.20 + 1, ga.recovery && ga.recovery.high);
  const uk = SBBudget.estimateProduction(da, { mode: 'documentary', docScale: 'indie', incentive: 'ukavec' });
  check('UK AVEC full rate for docs', uk.recovery && uk.recovery.high > 0 && !uk.recovery.excluded);

  // scripted regression: same analysis without mode stays scripted
  const sprod = SBBudget.estimateProduction(da, {});
  check('scripted path unchanged without mode', sprod.mode === undefined && !!sprod.groups['Above the line']);

  // doc sales
  const ds = SBDoc.docSales([600e3, 900e3], { heat: 'solid' });
  check('doc sales has 5 license paths', Object.keys(ds.paths).length === 5, Object.keys(ds.paths));
  check('solid heat is a modest stack', ds.gross[1] < 400e3, ds.gross);
  check('CMSI priors surfaced', ds.profitRate === 0.20 && ds.zeroRevenueRate === 0.40);
  const bo2 = SBDoc.docSales([600e3, 900e3], { heat: 'breakout' });
  check('breakout streamer ceiling $15M', bo2.heat.streamer[1] === 15e6, bo2.heat.streamer);

  // top-sheet seeding compatibility
  const dsheet = SBBudgetSheet.blankSheet();
  SBBudgetSheet.seedFromEstimate(dsheet, dprod);
  const dtot = SBBudgetSheet.sheetTotals(dsheet);
  check('doc estimate seeds the top sheet', dtot.grand > 100e3, dtot.grand);
}

console.log(failures ? '\n' + failures + ' FAILURES' : '\nAll producer suite checks passed.');
process.exit(failures ? 1 : 0);

