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

console.log(failures ? '\n' + failures + ' FAILURES' : '\nAll producer suite checks passed.');
process.exit(failures ? 1 : 0);
