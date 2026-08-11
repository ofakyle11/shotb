/* Smoke test for producer/ suite modules — run: node scripts/test_producer_suite.mjs */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['timeline/timeline-budget.js', 'producer/budget-sheet.js', 'producer/schedule-board.js', 'producer/incentives.js']) {
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
check('18 categories (contingency auto)', sheet.categories.length === 18, sheet.categories.length);
check('accounts 1000..18000', sheet.categories[0].acct === '1000' && sheet.categories[17].acct === '18000');

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
const SCRIPT = ('INT. WAREHOUSE - NIGHT\n\nJACK fights two MEN. An EXPLOSION. A CROWD scatters. Gunshots everywhere as the roof burns.\n\nJACK\nMove!\n\nEXT. HARBOR - DAY\n\nMAYA dives into the water as the boat chase ends in a crash.\n\nMAYA\nGo!\n\n').repeat(10);
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
check('codes start SW and end WF (multi-day)', jack.wrk < 2 || (jack.codes.filter(c => c).length && jack.codes.find(c => c) === 'SW' && [...jack.codes].reverse().find(c => c) === 'WF'), jack && jack.codes);
check('holds = span - work', jack.hld === jack.tot - jack.wrk, jack);
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

// ── CSV export ──
const csvSheet = SBBudgetSheet.blankSheet();
csvSheet.categories[0].items = [{ id: 'z', desc: 'Option, purchase "rights"', amt: '', units: '', rate: '', est: 50000, actual: 0, notes: '' }];
for (let i = 1; i < csvSheet.categories.length; i++) csvSheet.categories[i].items = [];
const csv = SBBudgetSheet.sheetToCsv(csvSheet);
check('csv has header + grand total', csv.startsWith('Account,') && csv.includes('GRAND TOTAL'), csv.split('\n')[0]);
check('csv quotes commas/quotes', csv.includes('"Option, purchase ""rights"""'), csv.split('\n')[1]);
check('csv grand includes contingency', csv.includes('GRAND TOTAL,,,,' + Math.round(55000)) || csv.split('\n').pop().includes('55000'), csv.split('\n').pop());

console.log(failures ? '\n' + failures + ' FAILURES' : '\nAll producer suite checks passed.');
process.exit(failures ? 1 : 0);
