#!/usr/bin/env node
/* Node tests for investors/lib-invest.js (CInvest) — run: node scripts/test_investors.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* money substrate — hard load order: math → accounts → sheet */
for (const f of ['js/lib-money-math.js', 'js/lib-money-accounts.js', 'js/lib-money-sheet.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
(0, eval)(readFileSync(join(ROOT, 'investors/lib-invest.js'), 'utf8'));
const I = globalThis.CInvest;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}
const eq = (a, b) => Math.abs(a - b) < 0.005;   // cent-exact

/* ── fixtures ── */
const INV = [
  { id: 'a', name: 'Bank of Elm', kind: 'debt', amount: 100000, interestPct: 10 },
  { id: 'b', name: 'GapCo', kind: 'gap', amount: 50000, interestPct: 20 },
  { id: 'c', name: 'Alice', kind: 'equity', amount: 200000 },              // premium defaults to 20
  { id: 'd', name: 'Bob', kind: 'equity', amount: 100000, premiumPct: 20 }
];
const OPTS = { salesFeePct: 15, expensesOffTop: 25000 };

/* ── normalize / owed ── */
const n = I.normalize({ name: 'X', kind: 'equity', amount: '5000' });
t('normalize defaults premium 20, backend null', n.premiumPct === 20 && n.backendPct === null && n.amount === 5000);
t('normalize bad kind → equity', I.normalize({ kind: 'weird' }).kind === 'equity');
t('debt owed = principal + simple interest', eq(I.owed(INV[0], 1).total, 110000));
t('gap owed at 2 years doubles interest', eq(I.owed(INV[1], 2).total, 70000));
t('equity owed = principal + 20% premium', eq(I.owed(INV[2], 1).total, 240000));

/* ── cap table ── */
const cap = I.capTable(INV, OPTS);
t('capTable raised total', eq(cap.raised, 450000));
t('capTable by kind', eq(cap.byKind.equity, 300000) && eq(cap.byKind.debt, 100000) && eq(cap.byKind.gap, 50000));
t('capTable owed by kind', eq(cap.owedByKind.equity, 360000) && eq(cap.owedByKind.debt, 110000) && eq(cap.owedByKind.gap, 60000));
t('capTable no explicit backend', cap.explicitBackend === false);

/* ── allocate (exact cents) ── */
const al = I.allocate(100, [1, 1, 1]);
t('allocate sums exactly to pool', eq(al[0] + al[1] + al[2], 100));
t('allocate residue lands on a share', al.filter(x => x === 33.33).length === 2 && al.some(x => eq(x, 33.34)));
t('allocate zero weights → zeros', I.allocate(100, [0, 0]).every(x => x === 0));

/* ── waterfall: full profit case, gross 1,000,000 ── */
const w = I.waterfall(INV, 1000000, OPTS);
// fee 150,000 · expenses 25,000 · net 825,000
t('fee is 15% of gross', eq(w.salesFee, 150000));
t('expenses taken off top', eq(w.expenses, 25000) && eq(w.net, 825000));
// tiers: debt 110,000 → gap 60,000 → equity 360,000 → remaining 295,000
t('debt tier paid in full', eq(w.tiers.debt.paid, 110000));
t('gap tier paid in full', eq(w.tiers.gap.paid, 60000));
t('equity tier paid in full', eq(w.tiers.equity.paid, 360000));
t('producer takes half the profit', eq(w.producerProfit, 147500));
t('investor pool is the other half', eq(w.investorPool, 147500));
const rowBy = {}; w.rows.forEach(r => { rowBy[r.id] = r; });
// pro-rata by amount over 450,000 raised
t('Alice backend pro-rata 200/450 (residue cent absorbed)', rowBy.c.profit === 65555.55);
t('pro-rata backend sums exactly to the pool', eq(w.rows.reduce((a, r) => a + r.profit, 0), 147500));
t('Bank participates pro-rata by default', eq(rowBy.a.profit, 32777.78));
t('Alice recouped principal + premium', eq(rowBy.c.recouped, 240000));
t('row totals = recouped + profit', w.rows.every(r => eq(r.total, r.recouped + r.profit)));
t('pctOfInvestment math', eq(rowBy.c.pctOfInvestment, rowBy.c.total / 200000 * 100));
t('multiple math', eq(rowBy.d.multiple, rowBy.d.total / 100000));
// THE reconciliation: everything distributed = net = gross − fee − expenses
const distributed = w.totals.total + w.producerProfit + w.undistributed;
t('waterfall reconciles to the cent', eq(distributed, w.net) && eq(w.distributed, w.net));
t('gross fully accounted', eq(w.net + w.salesFee + w.expenses, 1000000));
t('no undistributed in pro-rata mode', eq(w.undistributed, 0));

/* ── waterfall: shortfall inside the debt tier ── */
const two = [
  { id: 'a', name: 'A', kind: 'debt', amount: 60000, interestPct: 0 },
  { id: 'b', name: 'B', kind: 'debt', amount: 40000, interestPct: 0 },
  { id: 'c', name: 'C', kind: 'equity', amount: 50000 }
];
const ws = I.waterfall(two, 50000, { salesFeePct: 0, expensesOffTop: 0 });
t('short pool pays debt pro-rata by owed', eq(ws.rows[0].recouped, 30000) && eq(ws.rows[1].recouped, 20000));
t('later tiers get nothing on shortfall', eq(ws.rows[2].recouped, 0) && eq(ws.producerProfit, 0));
t('shortfall still reconciles', eq(ws.totals.total + ws.producerProfit + ws.undistributed, ws.net));

/* ── waterfall edges ── */
const wz = I.waterfall(INV, 0, OPTS);
t('zero gross → all zeros', wz.rows.every(r => r.total === 0) && wz.producerProfit === 0 && wz.net === 0);
t('expenses capped at what remains after fee', eq(I.waterfall(INV, 10000, OPTS).expenses, 8500));
t('negative gross clamped to 0', I.waterfall(INV, -500, OPTS).gross === 0);
t('empty investor list sends half to producer, half undistributed',
  (() => { const e = I.waterfall([], 100, { salesFeePct: 0 }); return eq(e.producerProfit, 50) && eq(e.undistributed, 50); })());

/* ── explicit backend percentages ── */
const exp70 = INV.map(v => ({ ...v }));
exp70[2].backendPct = 70; exp70[3].backendPct = 30;
const we = I.waterfall(exp70, 1000000, OPTS);
const eBy = {}; we.rows.forEach(r => { eBy[r.id] = r; });
t('explicit backend 70/30 honored', eq(eBy.c.profit, 147500 * 0.7) && eq(eBy.d.profit, 147500 * 0.3));
t('non-designated investors get no backend in explicit mode', eq(eBy.a.profit, 0) && eq(eBy.b.profit, 0));
const exp40 = INV.map(v => ({ ...v }));
exp40[2].backendPct = 25; exp40[3].backendPct = 15;   // only 40% claimed
const wu = I.waterfall(exp40, 1000000, OPTS);
t('under-claimed backend leaves undistributed remainder', eq(wu.undistributed, 147500 * 0.6));
t('under-claimed shares paid at face value', eq(wu.rows[2].profit, 147500 * 0.25));
const exp150 = INV.map(v => ({ ...v }));
exp150[2].backendPct = 100; exp150[3].backendPct = 50;  // 150% claimed → scaled
const wo = I.waterfall(exp150, 1000000, OPTS);
t('over-claimed backend scales to the pool', eq(wo.rows[2].profit, 147500 * 100 / 150) && eq(wo.rows[3].profit, 147500 * 50 / 150));
t('over-claimed still reconciles', eq(wo.totals.total + wo.producerProfit + wo.undistributed, wo.net));

/* ── breakeven: derived, then verified against the waterfall itself ── */
const be = I.breakeven(INV, OPTS);
// owed 530,000; gross = (530,000 + 25,000) / 0.85
t('breakeven owedTotal', eq(be.owedTotal, 530000));
t('breakeven solved directly', eq(be.gross, (530000 + 25000) / 0.85));
const wb = I.waterfall(INV, be.gross, OPTS);
t('at breakeven every tier is exactly paid',
  eq(wb.tiers.debt.paid, 110000) && eq(wb.tiers.gap.paid, 60000) && eq(wb.tiers.equity.paid, 360000));
t('at breakeven profit is ~zero', Math.abs(wb.producerProfit) < 0.02);
const wUnder = I.waterfall(INV, be.gross - 1000, OPTS);
t('just under breakeven leaves equity short', wUnder.tiers.equity.paid < 360000);
t('fee ≥ 100% → breakeven unreachable', I.breakeven(INV, { salesFeePct: 100 }).gross === null);
t('breakeven honors interest years', eq(I.breakeven(INV, { salesFeePct: 15, expensesOffTop: 25000, years: 2 }).owedTotal, 550000));
t('no investors → breakeven covers expenses only', eq(I.breakeven([], OPTS).gross, 25000 / 0.85));

/* ── statement ── */
const st = I.statement(INV[2], rowBy.c, '2026-08-23');
t('statement carries name + date', /Alice/.test(st) && /2026-08-23/.test(st));
t('statement shows invested and total', st.indexOf('$200,000') > 0 && st.indexOf(I.fmt(rowBy.c.total)) > 0);
t('statement shows multiple', new RegExp((rowBy.c.multiple).toFixed(2) + 'x').test(st));
t('statement carries verify warning', /Verify against/.test(st) && /estimate/.test(st));
t('statement omits date when none given', I.statement(INV[2], rowBy.c).indexOf('As of') < 0);

/* ── budget total + update letter ── */
const sheet = { categories: [
  { acct: '1000', name: 'ATL', items: [{ est: 120000 }, { est: 30000 }] },
  { acct: '3000', name: 'BTL', items: [{ est: 250000.5 }] }
] };
t('budgetTotal sums category est', eq(I.budgetTotal(sheet), 400000.5));
t('budgetTotal empty sheet → 0', I.budgetTotal(null) === 0 && I.budgetTotal({}) === 0);
const letter = I.updateLetter({
  production: 'Night Harvest', period: 'Q3 2026', when: '2026-08-23',
  investors: INV, opts: OPTS, budgetTotal: 400000.5, efc: 425000,
  receipts: 0, highlights: 'Wrapped principal photography\nEdit underway',
  contact: 'M. Francis', company: 'JF Films'
});
t('letter carries production + period', /Night Harvest/.test(letter) && /Q3 2026/.test(letter));
t('letter totals the raise by class', letter.indexOf('$450,000') > 0 && letter.indexOf('equity $300,000') > 0);
t('letter names modeled breakeven as estimate', letter.indexOf(I.fmt((530000 + 25000) / 0.85)) > 0 && /estimate/.test(letter));
t('letter flags EFC over budget', /projected OVER budget/.test(letter) && letter.indexOf(I.fmt(400000.5 - 425000)) > 0);
t('letter lists highlights', /- Wrapped principal photography/.test(letter) && /- Edit underway/.test(letter));
t('letter carries verify-before-relying note', /verify before relying/.test(letter));
t('letter without EFC says so', /no cost report on file/.test(I.updateLetter({ investors: [] })));

/* ── formatting ── */
t('fmt groups thousands', I.fmt(1234567.5) === '$1,234,567.50' && I.fmt(1000) === '$1,000');
t('fmt handles negatives', I.fmt(-24999.5) === '-$24,999.50');

console.log(`test_investors: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
