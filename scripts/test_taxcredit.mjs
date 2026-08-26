#!/usr/bin/env node
/* Node tests for taxcredit/lib-taxcred.js (CTaxCred) — run: node scripts/test_taxcredit.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* CMoneyMath first: the credit model carries integer cents when it is there. */
(0, eval)(readFileSync(join(ROOT, 'js/lib-money-math.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'taxcredit/lib-taxcred.js'), 'utf8'));
const T = globalThis.CTaxCred;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

/* ── JURIS mirrors the Advisor's curated INCENTIVES table verbatim ── */
const ADV = (() => {
  // Pull INCENTIVES straight out of timeline-budget.js and compare.
  const src = readFileSync(join(ROOT, 'timeline/timeline-budget.js'), 'utf8');
  const m = src.match(/var INCENTIVES = (\[[\s\S]*?\n  \]);/);
  return m ? (0, eval)('(' + m[1] + ')') : null;
})();
t('advisor INCENTIVES table located', Array.isArray(ADV) && ADV.length >= 20);
t('JURIS same length as Advisor table', T.JURIS.length === ADV.length);
t('JURIS entries verbatim (deep equal)', JSON.stringify(T.JURIS) === JSON.stringify(ADV));

const geo = T.jurisById('georgia');
t('georgia entry intact', geo.rate[0] === 0.20 && geo.rate[1] === 0.30 && geo.qualPct === 0.75 && geo.minSpend === 5e5);
t('ukiftc carries budgetCap', T.jurisById('ukiftc').budgetCap === 30e6);
t('bc is labor-only low qualPct', T.jurisById('bc').qualPct === 0.45);
t('jurisById unknown → none', T.jurisById('atlantis').id === 'none');
t('jurisById case-insensitive', T.jurisById('GEORGIA').id === 'georgia');

/* ── midpoint ── */
t('midpoint of georgia band = 25%', T.midpoint(geo.rate) === 0.25);
t('midpoint of flat band = the rate', T.midpoint(T.jurisById('newyork').rate) === 0.30);
t('midpoint of empty → 0', T.midpoint(null) === 0 && T.midpoint([]) === 0);

/* ── qualifiedGuess heuristic ── */
t('plain vendor guessed qualified', T.qualifiedGuess({ vendor: 'Grip & Electric Co', desc: 'lighting package' }, geo) === true);
t('travel guessed non-qualified', T.qualifiedGuess({ vendor: 'Delta', desc: 'Travel — crew flights' }, geo) === false);
t('insurance guessed non-qualified', T.qualifiedGuess({ vendor: 'Front Row Insurance', desc: 'production package' }, geo) === false);
t('bond guessed non-qualified', T.qualifiedGuess({ vendor: 'Film Finances', desc: 'completion bond fee' }, geo) === false);
t('legal guessed non-qualified', T.qualifiedGuess({ vendor: 'Smith LLP', desc: 'legal clearance review' }, geo) === false);
t('financing guessed non-qualified', T.qualifiedGuess({ vendor: 'Bridge Capital', desc: 'gap financing fee' }, geo) === false);
t('out-of-jurisdiction guessed non-qualified', T.qualifiedGuess({ vendor: 'Rental Co', desc: 'out-of-state camera package' }, geo) === false);
t('hotel/lodging guessed non-qualified', T.qualifiedGuess({ vendor: 'Marriott', desc: 'hotel block' }, geo) === false);
t('petty who field also scanned', T.qualifiedGuess({ who: 'Travel desk', desc: 'taxi' }, geo) === false);

/* ── rowsFromMoney ── */
const money = {
  pos: [
    { id: 'a', num: 'PO-1001', vendor: 'Grip Co', desc: 'lights', acct: '8000', amount: 100000.37, status: 'open', date: '2026-08-01' },
    { id: 'b', num: 'PO-1002', vendor: 'Camera House', desc: 'camera package', acct: '6000', amount: 200000.45, status: 'paid', date: '2026-08-02' },
    { id: 'c', num: 'PO-1003', vendor: 'Ghost', desc: 'cancelled', acct: '6000', amount: 999999.99, status: 'void', date: '2026-08-03' },
    { id: 'd', num: 'PO-1004', vendor: 'Delta', desc: 'travel — crew flights', acct: '13500', amount: 50000.11, status: 'invoiced', date: '2026-08-04' }
  ],
  petty: [
    { id: 'e', who: 'PA', desc: 'gaff tape', acct: '8500', amount: 500.49, date: '2026-08-05' }
  ]
};
const rows = T.rowsFromMoney(money);
t('void POs excluded', rows.length === 4 && !rows.some(r => r.id === 'c'));
t('open PO is committed', rows.find(r => r.id === 'a').bucket === 'committed');
t('paid/invoiced POs are actual', rows.find(r => r.id === 'b').bucket === 'actual' && rows.find(r => r.id === 'd').bucket === 'actual');
t('petty cash is actual with PC ref', rows.find(r => r.id === 'e').bucket === 'actual' && rows.find(r => r.id === 'e').ref === 'PC');
t('rowsFromMoney safe on empty', T.rowsFromMoney(null).length === 0);

/* ── isQualified: explicit tags beat guesses ── */
t('untagged falls to guess', T.isQualified(rows.find(r => r.id === 'd'), {}, geo) === false);
t('tag true overrides guess-false', T.isQualified(rows.find(r => r.id === 'd'), { d: true }, geo) === true);
t('tag false overrides guess-true', T.isQualified(rows.find(r => r.id === 'a'), { a: false }, geo) === false);

/* ── creditModel ── */
/* New Mexico (no minSpend): qualified = a+b+e = 300,501.31; the travel row is
   guessed out. qualPct belongs to the whole-budget advisorModel ONLY — the
   ledger has already dropped each exempt row by name, so charging the same
   haircut again against qualifiedSpend understates the credit by (1 − qualPct).
   Pinned to the cent: NM mid rate = (0.25 + 0.40) / 2 = 0.325. */
const nm = T.jurisById('newmexico');
const BUDGET = 2000000.75;
const cm = T.creditModel(nm, {}, money, BUDGET);
t('qualifiedSpend sums actual+committed qualified rows, to the cent', cm.qualifiedSpend === 300501.31);
t('totalSpend includes non-qualified rows, to the cent', cm.totalSpend === 350501.42);
t('estCredit = qualifiedSpend × midpoint, no second qualPct haircut', cm.estCredit === 97662.93);
t('advisorModel = budget × qualPct × midpoint', cm.advisorModel === 455000.17);
t('delta = est − advisor, to the cent', cm.delta === -357337.24);
t('counts: 4 rows, 3 qualified, 4 guessed', cm.rowCount === 4 && cm.qualifiedCount === 3 && cm.guessedCount === 4);
const cmTag = T.creditModel(nm, { d: true, a: false }, money, BUDGET);
t('tags reshape qualified spend', cmTag.qualifiedSpend === 250501.05 && cmTag.guessedCount === 2);

// Georgia minSpend: total 350,501.42 < 500,000 floor → warning, credit 0, raw kept.
const cmGeo = T.creditModel(geo, {}, money, BUDGET);
t('below minSpend → belowMin + credit 0', cmGeo.belowMin === true && cmGeo.estCredit === 0);
t('raw credit still reported for context', cmGeo.rawCredit === 75125.33);
const bigMoney = { pos: [{ id: 'z', num: 'PO-1', vendor: 'Stage Co', desc: 'stage rental', acct: '13000', amount: 600000.55, status: 'open' }], petty: [] };
t('above minSpend → credit flows, to the cent', T.creditModel(geo, {}, bigMoney, BUDGET).estCredit === 150000.14);

// ukiftc budgetCap: budget over ~$30M flags overCap.
t('over budgetCap flagged', T.creditModel(T.jurisById('ukiftc'), {}, money, 40e6).overCap === true);
t('under budgetCap not flagged', T.creditModel(T.jurisById('ukiftc'), {}, money, 20e6).overCap === false);
t('none jurisdiction models zero', T.creditModel(T.jurisById('none'), {}, money, BUDGET).estCredit === 0);
t('creditModel safe on null money/budget', T.creditModel(geo, null, null, null).rowCount === 0);

/* ── checklist ── */
const clGeo = T.checklist(geo);
t('checklist has core steps', clGeo.items.length >= 6);
const ids = cl => cl.items.map(i => i.id);
t('registration before photography present', ids(clGeo).indexOf('register') === 0);
t('CPA audit + final cost report present', ids(clGeo).includes('audit') && ids(clGeo).includes('costreport'));
t('minSpend item only where the program has a floor', ids(clGeo).includes('minspend') && !ids(T.checklist(nm)).includes('minspend'));
t('cultural test for uk/ireland/australia', ['ukavec', 'ukiftc', 'ireland', 'australia'].every(j => ids(T.checklist(T.jurisById(j))).includes('cultural')));
t('no cultural test for georgia', !ids(clGeo).includes('cultural'));
t('checklist flag defers to the accountant', /accountant/i.test(clGeo.flag));
t('residency + apply-window items present', ids(clGeo).includes('residency') && ids(clGeo).includes('window') && ids(clGeo).includes('apply'));

console.log(`test_taxcredit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
