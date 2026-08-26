#!/usr/bin/env node
/* The money half of the ops suite: CPayroll (js/lib-payroll.js) and the
   CMoney cost report it posts into — run: node scripts/test_ops_money.mjs

   Every fixture in here carries CENTS. No money fixture in this slice did
   before, which is exactly why rounding drift stayed invisible: a report that
   only ever sees round dollars foots by luck, and the defect that shipped —
   per-row EFC and variance rounded while the columns were summed raw — cannot
   be reproduced with a fixture made of whole numbers.

   Load order is the runtime contract, so the suite loads in the same order the
   pages do: math → accounts → sheet → TMoney → CPayroll → CMoney. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['js/lib-money-math.js', 'js/lib-money-accounts.js', 'js/lib-money-sheet.js',
                 'tools/lib-money.js', 'js/lib-payroll.js', 'finance/lib-money.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
const { CMoney: M, CPayroll: P, CAccounts: A, CMoneyMath: MM, TMoney: T } = globalThis;

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error('  ✗', n); } };
/* Compare money the way the report does: to the cent. */
const c$ = (v) => Math.round(v * 100);

/* ══ 1. one worked day, end to end ══════════════════════════════════════
   R. Okafor, gaffer, $42.75/hr. Call 06:00, wrap 20:30 — 14.5 elapsed, one
   30-minute meal, so 14.0 worked. Meal came at 6.5h, half an hour late.
     straight  8.00h × 42.75            = 342.00
     OT 1.5×   3.50h × 42.75 × 1.5      = 224.44   (worked hours over 8)
     DT 2×     2.50h × 42.75 × 2        = 213.75   (elapsed hours over 12)
     gross                              = 780.19
     meal penalty, 1 half-hour          =  25.00
     fringes 28% of 805.19              = 225.45
   Labour 805.19 posts to 8000 Grip & Electric — the gaffer's own account, not
   Direction — and the 225.45 of fringes to 20000, never to the department. */
const gaffer = P.cardFromLog({
  date: '2026-08-24', name: 'R. Okafor', role: 'Gaffer', rate: '42.75',
  call: '06:00', wrap: '20:30', meals: '1', firstMeal: '6.5', dow: 'Weekday'
});
const day = P.laborCents(gaffer);
t('card: elapsed 14.5h, worked 14.0h', day.elapsed === 14.5 && day.worked === 14);
t('card: gross 780.19 in cents', day.grossCents === 78019);
t('card: meal penalty 25.00 in cents', day.penaltyCents === 2500);
t('card: labour = gross + penalties = 805.19', day.laborCents === 80519);
t('card: fringes 28% of 805.19 = 225.45', day.fringeCents === 22545);
t('card: total foots to the engine, to the cent',
  day.totalCents === 103064 && day.totalCents === MM.cents(T.timecard({
    rate: 42.75, call: '06:00', wrap: '20:30', mealsTaken: 1, firstMealAtHr: 6.5, dayOfWeek: 3
  }).total));
t('card: gaffer lands on 8000 G&E, not Direction', P.laborAcct(gaffer) === '8000');

const posts = P.cardPostings(gaffer);
t('postings: exactly two — labour and fringes', posts.length === 2);
t('postings: labour 805.19 on 8000, actual',
  posts[0].acct === '8000' && posts[0].cents === 80519 && posts[0].kind === 'actual' && posts[0].amount === 805.19);
t('postings: fringes on FRINGE_ACCT 20000, never on the department',
  posts[1].acct === A.FRINGE_ACCT && posts[1].acct === '20000' && posts[1].cents === 22545);
t('postings: each names the person and the day', /R\. Okafor/.test(posts[0].desc) && /2026-08-24/.test(posts[1].desc));

/* ══ 2. the chart decides the account, from the role ══ */
t('acct: day player is cast 4200', P.laborAcct(P.cardFromLog({ role: 'Day player', kind: 'cast' })) === '4200');
t('acct: 1st AC is camera 6000', P.laborAcct(P.cardFromLog({ role: '1st AC' })) === '6000');
t('acct: unmatched crew is other crew 5000, not Direction',
  P.laborAcct(P.cardFromLog({ role: 'Unit yak wrangler' })) === A.DEFAULT_CREW);
t('acct: unmatched cast is Cast 4000',
  P.laborAcct(P.cardFromLog({ role: '', kind: 'cast' })) === A.DEFAULT_CAST);
t('acct: an explicit account on the card wins',
  P.laborAcct(P.cardFromLog({ role: 'Gaffer', acct: '8500' })) === '8500');
t('acct: an explicit account that is not in the chart does not',
  P.laborAcct(P.cardFromLog({ role: 'Gaffer', acct: '1400' })) === '8000');

/* ══ 3. status decides which column ══ */
const scheduled = P.cardFromLog({ date: '2026-08-25', name: 'R. Okafor', role: 'Gaffer',
  rate: '42.75', call: '07:00', wrap: '19:00', meals: '1', firstMeal: '5.5', status: 'scheduled' });
const sched = P.cardPostings(scheduled);
t('status: a scheduled day is committed, not actual', sched.every((p) => p.kind === 'committed') && sched.length === 2);
t('status: a void card posts nothing',
  P.cardPostings(P.cardFromLog({ name: 'X', role: 'Gaffer', rate: '42.75', call: '06:00', wrap: '18:00', status: 'void' })).length === 0);

/* ══ 4. a card logged before payroll reached the report ══
   Those rows carry only the loaded total the Timecards tab calls
   "gross+fringe total". Splitting it back out must not create or destroy a
   cent: fringes are the residual, so the two postings add to the logged
   figure exactly. */
const legacy = P.cardFromLog({ date: '2026-08-24', name: 'A. Vane', role: 'Best boy', total: '1030.64' });
const lc = P.laborCents(legacy);
t('legacy: loaded total split at the default 28%', lc.grossCents === 80519 && lc.fringeCents === 22545);
t('legacy: the split foots back to the logged total', lc.grossCents + lc.fringeCents === MM.cents('1030.64'));
t('legacy: still lands on the right account', lc.acct === '8000' && lc.source === 'total');
t('legacy: an empty row is an error, not a silent zero',
  /nothing to post/.test(P.laborCents(P.cardFromLog({ name: 'ghost' })).error));
t('bad call/wrap surfaces as an error and posts nothing', (() => {
  const bad = P.cardFromLog({ name: 'B. Time', role: 'Gaffer', rate: '42.75', call: 'noon', wrap: '20:30' });
  return !!P.laborCents(bad).error && P.cardPostings(bad).length === 0;
})());

/* ══ 5. the summary the Money Room prints ══ */
const cards = [gaffer, scheduled, legacy, P.cardFromLog({ name: 'B. Time', role: 'Gaffer', rate: '42.75', call: 'noon', wrap: '20:30' })];
const flat = P.postingsFor(cards);
t('postingsFor: one flat list, errors and voids dropped', flat.length === 6 &&
  flat.every((p) => p.source === 'payroll' && Number.isInteger(p.cents) && p.cents !== 0));
const sum = P.payrollSummary(cards);
t('summary: three costable cards, one flagged', sum.cards === 3 && sum.errors.length === 1);
t('summary: two people', sum.people === 2);
t('summary: labour + fringes = total, to the cent', c$(sum.labor) + c$(sum.fringes) === c$(sum.total));
t('summary: actual and committed split, and add back to total',
  c$(sum.actual) + c$(sum.committed) === c$(sum.total) && sum.committed > 0);
t('summary: fringes are gathered on 20000', c$(sum.byAcct['20000']) === c$(sum.fringes));
t('summary: the department carries labour only, never fringes',
  c$(sum.byAcct['8000']) === c$(sum.labor));

/* ══ 6. labour on the cost report ══════════════════════════════════════
   The whole point of the order: before this, none of the above reached the
   report and every EFC and variance was wrong by the size of the crew. */
const sheet = { categories: [
  { acct: '5000', name: 'Production Staff', items: [{ est: 12500.75 }] },
  /* Amt × Units × Rate wins when all three are set — 2 × 5 × 312.35 */
  { acct: '8000', name: 'Grip & Electric', items: [{ amt: 2, units: 5, rate: 312.35 }] },
  { acct: '20000', name: 'Payroll Fringes', items: [{ est: 4210.19 }] },
  /* two items whose float sum prints as 15924.599999999999 */
  { acct: '15200', name: 'VFX', items: [{ est: 15920.3 }, { est: 4.3 }] } ] };

const m = M.blank();
t('blank state declares the labour slot', Array.isArray(m.labor) && m.labor.length === 0);
M.addPO(m, { vendor: 'Grip Co', desc: 'lighting package', acct: '8000', amount: 1875.4 });
M.addPetty(m, { who: 'PA', desc: 'gaff tape', acct: '8000', amount: 41.37 });
t('payroll posts into the money room state', P.postToMoney(m, cards) === 6 && m.labor.length === 6);

let rep = M.costReport(sheet, m);
const ge = rep.rows.filter((r) => r.acct === '8000')[0];
const fr = rep.rows.filter((r) => r.acct === '20000')[0];
t('report: labour reaches actual — 805.19 worked + 805.19 legacy + 41.37 petty',
  c$(ge.actual) === 80519 + 80519 + 4137);
t('report: a scheduled crew day reaches committed alongside the open PO',
  c$(ge.committed) === 187540 + P.laborCents(scheduled).laborCents);
t('report: fringes land on 20000 and nowhere else',
  c$(fr.actual) === 22545 * 2 && c$(fr.committed) === P.laborCents(scheduled).fringeCents);
t('report: labour is called out for the payroll panel',
  c$(rep.labor.actual) + c$(rep.labor.committed) === c$(rep.labor.total) &&
  c$(rep.labor.total) === c$(sum.total) && rep.labor.postings === 6);
t('report: labour drives the account over budget and the variance shows it',
  ge.over === true && c$(ge.variance) === c$(ge.budget) - c$(ge.efc));
t('report: EFC = actual + committed + ETC on every row',
  rep.rows.every((r) => c$(r.efc) === c$(r.actual) + c$(r.committed) + c$(r.etc)));
t('report: an account with no payroll is untouched',
  c$(rep.rows.filter((r) => r.acct === '5000')[0].actual) === 0);
t('report: without the labour postings the film is understated by the crew', (() => {
  const bare = M.costReport(sheet, { pos: m.pos, petty: m.petty, etc: {} });
  return c$(rep.totals.efc) - c$(bare.totals.efc) > 0 &&
         c$(rep.totals.actual) - c$(bare.totals.actual) === 103064 * 2;
})());
t('report: unbudgeted fringes still surface rather than vanishing', (() => {
  const noFringeLine = { categories: sheet.categories.filter((c2) => c2.acct !== '20000') };
  const r = M.costReport(noFringeLine, m).rows.filter((x) => x.acct === '20000')[0];
  return !!r && /Unbudgeted/.test(r.name) && c$(r.actual) === 22545 * 2;
})());
t('postAcct rolls a detail posting up to the budgeted major account',
  M.postAcct(M.budgetByAcct(sheet), '8500') === '8000');

/* ══ 7. the TOTAL row has to foot ══════════════════════════════════════
   The defect: per-row efc/variance were rounded while budget/actual/committed
   were summed raw, so the TOTAL row disagreed with its own columns — $79 of
   phantom cost at 240 accounts, on the report that goes to the completion
   bond. These cases fail the moment anyone rounds a row before summing. */
const colSum = (k) => rep.rows.reduce((a, r) => a + c$(r[k]), 0);
for (const k of ['budget', 'actual', 'committed', 'etc', 'efc', 'variance']) {
  t('foots: TOTAL ' + k + ' = the sum of the rows', colSum(k) === c$(rep.totals[k]));
}
t('foots: TOTAL EFC = actual + committed + ETC',
  c$(rep.totals.efc) === c$(rep.totals.actual) + c$(rep.totals.committed) + c$(rep.totals.etc));
t('foots: TOTAL variance = budget − EFC',
  c$(rep.totals.variance) === c$(rep.totals.budget) - c$(rep.totals.efc));

/* The fixture the defect cannot survive: three rows of $100.50. Rounded per
   row and then summed, the total reads $303. Summed as posted, it is $301.50.
   A report that agrees with the second number is not rounding early. */
const halves = { categories: [
  { acct: '6000', name: 'Camera', items: [{ est: 100.5 }] },
  { acct: '7000', name: 'Sound', items: [{ est: 100.5 }] },
  { acct: '9000', name: 'Art Department', items: [{ est: 100.5 }] } ] };
const hrep = M.costReport(halves, M.blank());
const roundedRows = hrep.rows.reduce((a, r) => a + Math.round(r.efc), 0);
t('half-cent fixture: the two ways of totalling really do disagree', roundedRows === 303);
t('half-cent fixture: the report totals what was posted, not what was rounded',
  c$(hrep.totals.efc) === 30150 && c$(hrep.totals.budget) === 30150);

/* ══ 8. the CSV leaves as decimal money, not as a float ══ */
const csv = M.csv(rep);
const cells = csv.split('\n').slice(1).flatMap((l) => l.split(',').slice(2));
t('csv: every money cell has exactly two decimals', cells.every((c2) => /^-?\d+\.\d{2}$/.test(c2)));
t('csv: no raw float ever reaches a cell', !/\.\d{3,}/.test(csv));
t('csv: the float that used to ship is 15924.599999999999',
  String(15920.3 + 4.3) === '15924.599999999999' && csv.indexOf('15924.60') > 0);
t('csv: the labour actual is written to the cent', csv.indexOf('1651.75') > 0);
t('csv: carries the TOTAL row', /\nTOTAL,/.test(csv));

/* ══ 9. the record and the learning layer still work with labour in ══ */
const snap = M.snapshot(m, rep, '2026-08-24');
t('snapshot freezes the totals including labour', snap.week === 1 && snap.totals.efc === rep.totals.efc);
t('setPoStatus moves an open PO to actual', (() => {
  M.setPoStatus(m, m.pos[0].id, 'paid');
  const r2 = M.costReport(sheet, m).rows.filter((r) => r.acct === '8000')[0];
  return c$(r2.actual) === 80519 + 80519 + 4137 + 187540;
})());
t('removeRow drops a petty line', M.removeRow(m, m.petty[0].id) === true);
delete globalThis.CLearn;
t('feedLearning is safe without CLearn', M.feedLearning(sheet, m) === 0);
let learned = null;
globalThis.CLearn = { learnBudget: (s2) => { learned = s2; return s2.categories.length; } };
t('labour actuals feed the estimator brain', M.feedLearning(sheet, m) >= 1 &&
  learned.categories.some((c2) => c2.acct === '20000'));
delete globalThis.CLearn;
t('the timecard log store is not renamed', P.LOG_KEY === 'SB_Timecards_v1');

console.log(`test_ops_money: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
