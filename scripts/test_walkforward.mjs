#!/usr/bin/env node
/* Does the learning actually learn? — finding 44.
 *
 * js/learn.js:budgetSummary() used to return `avgMult`, the n-weighted mean of
 * the corrections it had applied, and workflow/advisor-ui.js printed that to
 * the owner under the words "Self-learning". THAT NUMBER RISES AS THE SYSTEM
 * GETS MORE WRONG: it measures how much correcting has been needed, not
 * whether the correcting helped. Nothing in the platform asked the only
 * question that matters — did the calibrated estimate beat the raw one?
 *
 * This suite exists to make that question unanswerable-by-accident again:
 *
 *   1. the completion marker on the project slot (projects/lib-vault.js), and
 *      that a routine snapshot cannot silently un-wrap a finished film;
 *   2. the gate — an unwrapped, part-invoiced production teaches nothing;
 *   3. the walk-forward record — `pred` captured BEFORE the observation is
 *      folded in, which is the only moment it can be captured at all;
 *   4. THE FENCE: hold the corrections constant and flip only the walk-forward
 *      record. The headline the owner reads MUST flip with it. If anyone ever
 *      wires the "Self-learning" line back to correction magnitude, both cases
 *      produce the same sentence and this suite goes red.
 *
 * Run: node scripts/test_walkforward.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.error('  FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

/* ── harness ───────────────────────────────────────────────────────────────
   A real localStorage, installed BEFORE js/learn.js is evaluated, because the
   learning store and the completion gate both read it at load. */
const mem = () => ({
  _d: {},
  getItem(k) { return this._d[k] == null ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  key(i) { return Object.keys(this._d)[i]; },
  get length() { return Object.keys(this._d).length; },
});

global.window = global;
global.localStorage = mem();
const listeners = {};
global.addEventListener = (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); };

/* A DOM thin enough to run the one UI file this finding is about. The advisor
   panel is 166 lines that no suite has ever executed — and it is the file that
   printed the misleading label. Reading it as text would only prove what it
   says about itself; this runs it and reads what it puts on the page. */
function el() {
  const e = {
    innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {} },
    querySelectorAll: () => [], addEventListener() {}, appendChild() {}, getAttribute: () => null,
  };
  return e;
}
const mount = el();
global.document = {
  readyState: 'complete',
  head: el(),
  getElementById: (id) => (id === 'wfAdvisor' ? mount : null),
  createElement: () => el(),
  addEventListener() {},
  querySelectorAll: () => [],
};

(0, eval)(read('js/safe-url.js'));
(0, eval)(read('js/lib-money-math.js'));
(0, eval)(read('js/lib-money-sheet.js'));
(0, eval)(read('projects/lib-vault.js'));
(0, eval)(read('js/learn.js'));
(0, eval)(read('timeline/timeline-doc.js'));
(0, eval)(read('timeline/timeline-budget.js'));
(0, eval)(read('workflow/advisor.js'));
(0, eval)(read('workflow/advisor-ui.js'));

const V = global.CVault, L = global.CLearn, UI = global.CAdvisorUI;

/* ══ 1 · the completion marker ════════════════════════════════════════════
   There was no completion marker anywhere on this platform: SB_ProjLock has
   zero hits, vault slots carried only savedAt, and every workflow stage is
   derived from what happens to be in storage — which cannot tell a finished
   picture from an abandoned one. */
{
  const s = mem();
  s.setItem('SB_BudgetSheet_v1', JSON.stringify({ categories: [] }));

  t('vault: a fresh production reads as in progress', V.statusOf(s).status === 'in progress');
  t('vault: and is not wrapped', V.isWrapped(s) === false);

  V.setWrapped(s, null, '2026-08-26 11:20');
  const st = V.statusOf(s);
  t('vault: setWrapped marks the active slot', st.wrapped === true && st.status === V.WRAPPED);
  t('vault: the wrap time is the one the caller passed', st.wrappedAt === '2026-08-26 11:20');
  t('vault: the engine took no clock of its own', !/Date\s*\.\s*now|new\s+Date/.test(read('projects/lib-vault.js')));
  t('vault: and still opens no database', !/indexedDB/.test(read('projects/lib-vault.js')));

  /* saveActive/switchTo/newProject all replace the slot record wholesale. Left
     alone, the next routine snapshot would un-wrap a finished film and quietly
     re-open it to the learning layer. */
  V.saveActive(s, '2026-08-27 09:00');
  t('vault: a snapshot does not un-wrap the production', V.isWrapped(s) === true);
  t('vault: keepStatus is what carries it', V.keepStatus({ status: 'wrapped', wrappedAt: 'x' }, {}).wrappedAt === 'x');
  t('vault: keepStatus adds nothing to an unwrapped slot', V.keepStatus({}, {}).status === undefined);

  V.switchTo(s, 'Second Film', '2026-08-27 09:05');
  t('vault: switching away keeps the outgoing wrap', V.isWrapped(s, 'Project 1') === true);
  t('vault: the new production is its own, unwrapped', V.isWrapped(s, 'Second Film') === false);
  V.newProject(s, 'Third Film', '2026-08-27 09:10');
  t('vault: starting a third leaves the first wrapped', V.isWrapped(s, 'Project 1') === true);

  V.clearWrapped(s, 'Project 1');
  t('vault: a production can be re-opened for pickups', V.isWrapped(s, 'Project 1') === false);
}

/* ══ 2 · the gate ═════════════════════════════════════════════════════════
   producer/budget-sheet.js calls learnBudget on every save of the live sheet
   and finance/index.html on every render of the cost report. Mid-shoot,
   `actual` is what has been invoiced so far against a whole-picture estimate,
   so a department in week two of ten reads as an 85% underrun. */
{
  L.reset();
  localStorage._d = {};
  const midShoot = { categories: [{ acct: '23000', items: [
    { id: 'c1', desc: 'Set construction — lumber', est: 48000, actual: 6412.75 },
    { id: 'c2', desc: 'Set construction — labour', est: 92000, actual: 11380.40 },
  ] }] };

  t('gate: a production still shooting teaches nothing', L.learnBudget(midShoot) === 0);
  t('gate: and the account is untouched', L.calibration('23000').n === 0);
  t('gate: the learning layer says so', L.gate().wrapped === false);

  V.setWrapped(localStorage, null, '2026-09-30 18:00');
  t('gate: learn.js reads the vault marker without loading the vault',
    L.gate().wrapped === true && L.gate().project === 'Project 1');
  t('gate: a wrapped production teaches', L.learnBudget(midShoot) === 2);
  t('gate: re-opening it stops new learning',
    (V.clearWrapped(localStorage), L.learnBudget({ categories: [{ acct: '23000',
      items: [{ id: 'c3', est: 1000, actual: 2000 }] }] }) === 0));
}

/* ══ 3 · the walk-forward record ══════════════════════════════════════════
   `pred` is the number the platform would have put in front of the owner, from
   everything it had learned up to that instant. One instant later the
   observation is inside the multiplier and the prediction is unrecoverable —
   which is why nothing before this order could answer the accuracy question at
   all. */
{
  L.reset();
  localStorage._d = {};
  V.setWrapped(localStorage, null, '2026-10-01 12:00');

  /* Eight closed lines on one account. The truth is that construction on these
     films runs about 40% over the seeded estimate, every time. */
  const RATIOS = [1.35, 1.48, 1.42, 1.39, 1.45, 1.41, 1.38, 1.44];
  RATIOS.forEach((r, i) => {
    const est = 12000 + i * 1500.25;
    L.learnBudget({ categories: [{ acct: '23000', items: [
      { id: 'L' + i, desc: 'strike & build', est: est, actual: Math.round(est * r * 100) / 100 },
    ] }] }, { project: 'Film ' + i, t: 1_700_000_000_000 + i });
  });

  const pw = L._state().pw;
  t('walk: one record per learned line', pw.length === 8);
  t('walk: the first prediction stood on nothing', pw[0].n === 0 && pw[0].pred === pw[0].est);
  t('walk: predictions carry the priors they stood on', pw[2].n === 2 && pw[7].n === 7);
  t('walk: pred was captured before the fold, not after',
    Math.abs(pw[2].pred / pw[2].est - 1.4) < 0.06, 'pred/est ' + (pw[2].pred / pw[2].est));

  const w = L.walkForward();
  t('walk: only rows the platform had an opinion on are scored', w.n === 6);
  t('walk: below two priors is excluded', L.walkForward({ minPrior: 99 }).n === 0);
  t('walk: a consistent overrun is learned — calibrated beats raw', w.improvePct > 60,
    w.improvePct + '% (raw err ' + w.rawErr + ' vs calibrated ' + w.calErr + ')');
  t('walk: and the verdict says so', w.verdict === 'better' && w.enough === true);
  t('walk: the headline quotes the improvement and the sample',
    /beat raw by [\d.]+% across 6 closed lines in 1 account\b/.test(L.learningReport().headline),
    L.learningReport().headline);
}

/* ══ 4 · it must be able to say the calibration is not working ════════════ */
{
  L.reset();
  localStorage._d = {};
  V.setWrapped(localStorage, null, '2026-10-02 12:00');

  /* Three films where transport ran wildly over, then five where the seeded
     estimate was already right. The multiplier is now chasing history that has
     stopped being true, and the honest report has to admit it. */
  const RATIOS = [1.9, 1.85, 1.95, 1.02, 0.98, 1.03, 1.01, 0.99];
  RATIOS.forEach((r, i) => {
    const est = 20000 + i * 800.5;
    L.learnBudget({ categories: [{ acct: '31000', items: [
      { id: 'T' + i, desc: 'transport', est: est, actual: Math.round(est * r * 100) / 100 },
    ] }] }, { project: 'Film ' + i });
  });

  const w = L.walkForward();
  t('walk: a stale multiplier is reported as making things worse', w.improvePct < 0 && w.verdict === 'worse',
    w.improvePct + '%');
  t('walk: the owner is told plainly', /WORSE than raw/.test(L.learningReport().headline),
    L.learningReport().headline);
  t('walk: and the correction average would have claimed the opposite',
    L.budgetSummary().avgCorrection > 1, 'avgCorrection ' + L.budgetSummary().avgCorrection);
}

/* ══ 5 · N below the threshold ════════════════════════════════════════════ */
{
  L.reset();
  localStorage._d = {};
  const r0 = L.learningReport();
  t('N=0: nothing is claimed', r0.walk.n === 0 && r0.walk.enough === false && r0.walk.verdict === 'unproven');
  t('N=0: the word is "unproven", with the count needed',
    /unproven — 0 of 5 closed lines needed/.test(r0.headline), r0.headline);
  t('N=0: no neutral-looking number is shown instead', !/[\d.]+%/.test(r0.headline), r0.headline);
  t('N=0: the gate is explained rather than left blank', /mark it wrapped in Projects/i.test(r0.gate));
  t('N=0: activity is reported as activity', /No budget actuals folded in yet/.test(r0.activity));
}

/* ══ 6 · THE FENCE ════════════════════════════════════════════════════════
   Hold the corrections constant — a huge, unchanging ×1.95 across twelve
   observations — and change ONLY the walk-forward record. The sentence the
   owner reads must follow the accuracy, not the size of the corrections.

   If budgetSummary's correction magnitude is ever wired back into the
   "Self-learning" line, both halves below produce the same claim and this
   check fails. That is the whole point of it. */
{
  const bigCorrections = { '23000': { r: 1.95, n: 12 } };
  const est = 50000, act = 55000;                 // the estimate was 10% light

  L.reset();
  const s1 = L._state();
  s1.budget = JSON.parse(JSON.stringify(bigCorrections));
  s1.pw = [1, 2, 3, 4, 5, 6].map((i) => ({ acct: '23000', est: est, pred: 54500, act: act, n: 2 + i, t: i }));
  const helping = L.learningReport();
  const correctionsWhenHelping = L.budgetSummary().avgCorrection;

  L.reset();
  const s2 = L._state();
  s2.budget = JSON.parse(JSON.stringify(bigCorrections));
  s2.pw = [1, 2, 3, 4, 5, 6].map((i) => ({ acct: '23000', est: est, pred: 97500, act: act, n: 2 + i, t: i }));
  const hurting = L.learningReport();
  const correctionsWhenHurting = L.budgetSummary().avgCorrection;

  t('fence: the correction magnitude is identical in both halves',
    correctionsWhenHelping === correctionsWhenHurting && correctionsWhenHelping === 1.95);
  t('fence: yet the reported accuracy flips sign',
    helping.walk.improvePct > 0 && hurting.walk.improvePct < 0,
    helping.walk.improvePct + '% vs ' + hurting.walk.improvePct + '%');
  t('fence: and so does the sentence the owner reads',
    helping.headline !== hurting.headline &&
    /beat raw by/.test(helping.headline) && /WORSE than raw/.test(hurting.headline));
  t('fence: budgetSummary offers no avgMult to print as accuracy',
    !('avgMult' in L.budgetSummary()) && !('avgMult' in L.summary()));
  t('fence: the headline is built from walkForward',
    /function learningReport[\s\S]{0,400}?walkForward\(\)/.test(read('js/learn.js')));
}

/* ══ 7 · what the page actually renders ═══════════════════════════════════
   The advisor panel is executed here, not read. The exception ledger says this
   file "must not ship without a test that pins what this string claims". */
{
  const src = read('workflow/advisor-ui.js');
  /* Comments stripped: the block comment above that paragraph names the old
     key on purpose, so a reader knows what was there and why it went. The rule
     is about what the file DOES. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  t('ui: no code in the advisor panel reads avgMult any more', !/avgMult/.test(code));
  t('ui: the history is still written down next to it', /avgMult/.test(src));
  t('ui: the panel asks learn.js for the sentence', /CLearn\.learningReport\(\)/.test(src));

  L.reset();
  localStorage._d = {};
  UI.render();
  const at0 = mount.innerHTML;
  t('ui: with no evidence the panel says unproven', /Self-learning: unproven/.test(at0), at0.slice(-400));
  t('ui: and states the gate', /mark it wrapped in Projects/i.test(at0));
  t('ui: no percentage is offered as accuracy at N=0',
    !/Self-learning[^<]*[\d.]+%/.test(at0), at0.slice(-400));

  const st = L._state();
  st.budget = { '23000': { r: 1.95, n: 12 } };
  st.pw = [1, 2, 3, 4, 5, 6].map((i) => ({ acct: '23000', est: 50000, pred: 97500, act: 55000, n: 2 + i, t: i }));
  UI.render();
  const bad = mount.innerHTML;
  t('ui: a calibration that is hurting is printed as hurting', /WORSE than raw/.test(bad));
  t('ui: the correction average is labelled as correction, not accuracy',
    /average correction applied ×1\.95 \(how much correcting it has done/.test(bad), bad.slice(-500));
  t('ui: the render-speed line still reports', /Render speed not measured yet/.test(bad));
}

console.log('\ntest_walkforward: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
