#!/usr/bin/env node
/* Can the self-learning layer be reached at all? — the wrap gate.
 *
 * Both closed loops on this platform are gated on a wrap, and both libraries
 * that implement the gate were written, tested and then left without a caller:
 *
 *   · js/learn.js:learnBudget() returns 0 on its second line unless the ACTIVE
 *     project slot in CIN_Projects_v1 carries status:'wrapped'. Nothing in the
 *     shipped tree set it, so every call — producer/budget-sheet.js on every
 *     save, finance/index.html on every render — returned 0. Forever.
 *   · producer/schedule-board.js:paceRowsModel() only counts a shoot day whose
 *     record in SB_ShootDays_v1 says wrapped:true. js/lib-shootdays.js:wrapDay
 *     is the only writer of that flag and had zero call sites outside its own
 *     suite, so the board shipped its hardcoded 4.5 pages/day on every film
 *     while its own comment claimed "/today/ wraps the day".
 *
 * A library nobody calls is not a feature. So this suite tests the two things
 * the per-library suites structurally cannot:
 *
 *   1. the LOOP — a marker set through the vault is read back by learn.js and
 *      turns a 0 into a real number on a real sheet; a wrapped day turns the
 *      shipped default pace into a learned one; and both reverse;
 *   2. the CALL SITE — that some shipped page actually makes those calls. It
 *      walks the tree for callers rather than naming one file, because the
 *      failure being fenced off is "the UI stopped calling it", which a
 *      library test can never see.
 *
 * Money fixtures carry cents: the Producer Suite writes Amt x Units x Rate and
 * leaves `est` at 0, which is exactly the "real sheet" a whole-dollar fixture
 * would not have caught.
 *
 * Run: node scripts/test_wrapgate.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.error('  FAIL ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}

/* ── harness ──────────────────────────────────────────────────────────────
   A real localStorage installed BEFORE js/learn.js is evaluated: the learning
   store and the completion gate both read it at load time. */
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

(0, eval)(read('js/lib-money-math.js'));
(0, eval)(read('js/lib-money-sheet.js'));
(0, eval)(read('projects/lib-vault.js'));
(0, eval)(read('js/learn.js'));
(0, eval)(read('js/lib-shootdays.js'));
(0, eval)(read('producer/schedule-board.js'));

const V = global.CVault, L = global.CLearn, S = global.CBudgetSheet,
      SD = global.CShootDays, SB = global.SBScheduleBoard;

/* ══ 1 · the marker, in the exact shape the consumer reads ════════════════
   gate() does not load the vault engine — the pages that learn (the Producer
   Suite, the money room, props) do not carry it. It parses CIN_Projects_v1
   itself and reads slot.status and slot.wrappedAt off the ACTIVE slot. Those
   two field names are therefore fixed by an existing consumer, not by
   whoever writes the setter, and this pins them from the reader's side. */
{
  L.reset();
  localStorage._d = {};
  const WHEN = '2026-11-02 21:15';

  t('marker: a fresh production reads as in progress',
    L.gate().wrapped === false && L.gate().status === 'in progress');

  V.setWrapped(localStorage, null, WHEN);
  const raw = JSON.parse(localStorage.getItem('CIN_Projects_v1'));
  const slot = raw.slots[raw.active];
  t('marker: it is a status on the ACTIVE slot of CIN_Projects_v1',
    slot.status === 'wrapped' && slot.status === V.WRAPPED, JSON.stringify(slot));
  t('marker: the timestamp is stored as wrappedAt — the name gate() reads',
    slot.wrappedAt === WHEN, JSON.stringify(slot));
  t('marker: the engine still takes no clock of its own',
    !/Date\s*\.\s*now|new\s+Date/.test(read('projects/lib-vault.js')));

  const g = L.gate();
  t('marker: learn.js reads it back across the two stores',
    g.wrapped === true && g.status === 'wrapped' && g.wrappedAt === WHEN && g.project === raw.active,
    JSON.stringify(g));

  V.clearWrapped(localStorage, null);
  const after = JSON.parse(localStorage.getItem('CIN_Projects_v1')).slots[raw.active];
  t('marker: un-wrapping removes both fields rather than blanking one',
    after.status === undefined && after.wrappedAt === undefined, JSON.stringify(after));
  t('marker: and the gate closes again', L.gate().wrapped === false);
}

/* ══ 2 · the budget loop, on a sheet the Producer Suite would actually write ══
   Amt x Units x Rate with `est` left at 0 — the shape five readers used to
   sum to nothing. Every figure carries cents, because the rounding lives
   there and a whole-dollar fixture proves nothing about this arithmetic. */
function realSheet() {
  return {
    categories: [{
      acct: '23000', name: 'Set construction', items: [
        { id: 'c1', desc: 'Lumber package',      amt: '3', units: '5',  rate: '1061.64', est: 0, actual: 18234.55 },
        { id: 'c2', desc: 'Construction labour', amt: '2', units: '12', rate: '742.19',  est: 0, actual: 21877.30 },
        { id: 'c3', desc: 'Paint & finish',      amt: '1', units: '9',  rate: '318.75',  est: 0, actual: 3402.18 },
      ],
    }],
  };
}
{
  L.reset();
  localStorage._d = {};
  const sheet = realSheet();
  const items = sheet.categories[0].items;

  t('sheet: this is the shape that stores nothing in `est`',
    items.reduce((a, it) => a + (+it.est || 0), 0) === 0);
  t('sheet: the line is worth Amt x Units x Rate, in exact cents',
    S.itemEstCents(items[0]) === 1592460 && S.itemEstCents(items[1]) === 1781256 &&
    S.itemEstCents(items[2]) === 286875,
    items.map((it) => S.itemEstCents(it)).join(','));
  t('sheet: and the actuals carry their cents too',
    S.itemActualCents(items[0]) === 1823455 && S.itemActualCents(items[2]) === 340218);

  /* THE DEFECT, stated as an assertion. */
  const before = L.learnBudget(sheet);
  t('loop: an unwrapped production teaches nothing from this sheet', before === 0);
  t('loop: and no account has formed an opinion', L.calibration('23000').n === 0);

  V.setWrapped(localStorage, null, '2026-11-02 21:15');
  const after = L.learnBudget(sheet);
  t('loop: the same sheet teaches every closed line once the wrap is marked',
    before === 0 && after === 3, 'before ' + before + ', after ' + after);
  t('loop: re-reading the sheet does not double-learn', L.learnBudget(realSheet()) === 0);

  const cal = L.calibration('23000');
  t('loop: the account now carries a correction built from three lines',
    cal.n === 3 && cal.mult > 1 && cal.mult < 1.3, JSON.stringify(cal));
  t('loop: and the walk-forward record kept what was predicted first',
    L._state().pw.length === 3 && L._state().pw[0].n === 0 &&
    L._state().pw[0].est === 15924.6 && L._state().pw[0].act === 18234.55,
    JSON.stringify(L._state().pw[0]));

  /* Reversible: re-opened for pickups, nothing NEW is folded in. */
  const pickup = { categories: [{ acct: '23000', items: [
    { id: 'c9', desc: 'Pickup build', amt: '1', units: '2', rate: '844.37', est: 0, actual: 2213.09 },
  ] }] };
  V.clearWrapped(localStorage, null);
  t('loop: re-opening the production closes the gate again', L.learnBudget(pickup) === 0);
  t('loop: what was already learned stays learned', L.calibration('23000').n === 3);
  t('loop: and the owner is told which switch to throw',
    /mark it wrapped in Projects/i.test(L.learningReport().gate), L.learningReport().gate);

  V.setWrapped(localStorage, null, '2026-12-01 09:00');
  t('loop: wrapping again re-opens the gate', L.learnBudget(pickup) === 1);
  t('loop: the pickup landed on the same account', L.calibration('23000').n === 4);
}

/* ══ 3 · the shoot day round-trips through the store ══════════════════════
   The record, not the returned array: wrapDay's whole job is to persist. */
{
  const ls = mem();
  SD.save(ls, [
    { dayIdx: 0, date: '2026-09-14', unit: 'MAIN', sceneIds: ['1', '1A'] },
    { dayIdx: 1, date: '2026-09-15', unit: 'MAIN', sceneIds: ['2'] },
    { dayIdx: 2, date: '2026-09-16', unit: 'MAIN', sceneIds: ['3', '4'] },
  ]);
  const stored = () => JSON.parse(ls.getItem('SB_ShootDays_v1'));

  t('day: nothing is wrapped to begin with', stored().every((d) => d.wrapped === false));

  SD.wrapDay(ls, 0, true);
  t('day: wrapDay writes through to SB_ShootDays_v1', stored()[0].wrapped === true);
  t('day: and reads back through load()', SD.load(ls)[0].wrapped === true);
  t('day: it marks that day only', stored().filter((d) => d.wrapped).length === 1);
  t('day: the rest of the record is untouched',
    stored()[0].date === '2026-09-14' && stored()[0].unit === 'MAIN' &&
    stored()[0].sceneIds.join() === '1,1A');

  SD.wrapDay(ls, 0, false);
  t('day: un-wrapping reverses it in the store', stored()[0].wrapped === false);

  /* A rebuild recomputes the derived halves. What a person stated must survive
     it, or the wrap would be undone by the next page load. */
  SD.wrapDay(ls, 2, true);
  ls.setItem('SB_ScheduleBoard_v1', JSON.stringify({ scenes: [
    { id: '1', num: '1', day: 0, eighths: 16 }, { id: '2', num: '2', day: 1, eighths: 24 },
    { id: '3', num: '3', day: 2, eighths: 20 },
  ] }));
  SD.sync(ls);
  t('day: a rebuild keeps what a person marked', SD.load(ls)[2].wrapped === true);
  t('day: and does not invent wraps on the others',
    SD.load(ls).filter((d) => d.wrapped).length === 1);
}

/* ══ 4 · the schedule loop, end to end ════════════════════════════════════
   4.5 pages/day is the shipped default and the only place that number
   appears. It is replaced by the median of what wrapped days actually
   achieved — so with no way to wrap a day it could never be replaced at all.
   This drives the board's own model with days wrapped through the library. */
{
  const ls = mem();
  const board = { scenes: [
    { id: '1',  num: '1',  day: 0, eighths: 16 },
    { id: '1A', num: '1A', day: 0, eighths: 10 },
    { id: '2',  num: '2',  day: 1, eighths: 24 },
    { id: '3',  num: '3',  day: 2, eighths: 20 },
    { id: '4',  num: '4',  day: 2, eighths: 14 },
  ] };
  ls.setItem('SB_ScheduleBoard_v1', JSON.stringify(board));
  SD.sync(ls);
  const TAKES = {
    0: [{ scene: '1', take: 1 }, { scene: '1', take: 2 }, { scene: '1A', take: 1 }],
    1: [{ scene: '2', take: 1 }, { scene: '2', take: 2 }],
    2: [{ scene: '3', take: 1 }, { scene: '4', take: 1 }],
  };
  const model = () => SB.paceRowsModel({
    board: board, shootDays: SD.load(ls),
    takesFor: (rec) => TAKES[rec.dayIdx] || [],
  });

  const cold = SB.learnedPace(model());
  t('pace: with no wrapped day the board has nothing to learn from',
    model().length === 0 && cold.learnedN === 0 && cold.learned === false);
  t('pace: so it offers the shipped default', cold.pagesPerDay === 4.5 && cold.source === 'default');
  t('pace: and says so rather than dressing it up as learned',
    /nothing learned yet \(no wrapped days\)/.test(SB.paceLabel(SB.resolvePace(board, model()))),
    SB.paceLabel(SB.resolvePace(board, model())));

  [0, 1, 2].forEach((d) => SD.wrapDay(ls, d, true));
  const rows = model();
  t('pace: every wrapped day becomes one row of evidence', rows.length === 3);
  t('pace: each row carries the eighths that day actually achieved',
    rows.map((r) => r.achievedEighths).join() === '26,24,34',
    rows.map((r) => r.achievedEighths).join());

  const hot = SB.learnedPace(rows);
  t('pace: three wrapped days replace the default with a learned median',
    hot.learned === true && hot.learnedN === 3 && hot.source === 'wrapped days');
  t('pace: the learned number is the median of what was shot, not 4.5',
    hot.pagesPerDay === 3.25 && hot.pagesPerDay !== hot.defaultPace, hot.pagesPerDay);
  t('pace: and the board schedules at it',
    SB.resolvePace(board, rows).pace === 3.25 && SB.resolvePace(board, rows).userSet === false);

  /* Un-wrapping is not cosmetic: the evidence has to leave with it. */
  SD.wrapDay(ls, 1, false);
  const back = SB.learnedPace(model());
  t('pace: un-wrapping a day withdraws its evidence', model().length === 2 && back.learnedN === 2);
  t('pace: below the threshold the default returns, honestly labelled',
    back.learned === false && back.pagesPerDay === 4.5,
    JSON.stringify(back));
}

/* ══ 5 · the call site ════════════════════════════════════════════════════
   The half no library suite can see. Both flags were reachable only from a
   test runner, and the fix is not "a function exists" — it is that a page a
   human can open makes the call. Walked, not hardcoded to one filename, so
   deleting the control anywhere reads as a failure here.

   The two libraries themselves and this scripts/ directory are excluded: a
   module calling its own setter, and a suite calling anything, is exactly the
   evidence that misled everyone into thinking this shipped. */
const SKIP_DIR = new Set(['.git', 'node_modules', 'static', 'assets', 'private',
  'local-backend', 'netlify-git-guard', 'docs', 'agents', 'scripts', 'netlify']);
const OWN_LIB = /(^|[\\/])(js[\\/]lib-shootdays\.js|projects[\\/]lib-vault\.js)$/;

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIR.has(e) || e.charAt(0) === '.') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(js|html)$/.test(p)) acc.push(p);
  }
  return acc;
}
const PAGES = walk(ROOT).filter((p) => !OWN_LIB.test(p));
function callers(re) {
  return PAGES.filter((p) => re.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p).replace(/\\/g, '/'));
}
{
  const wrapDayCallers = callers(/\.wrapDay\s*\(/);
  t('reach: a shipped page calls CShootDays.wrapDay', wrapDayCallers.length > 0,
    'no page outside js/lib-shootdays.js and scripts/ calls wrapDay');
  t('reach: /today/ is one of them — the day is wrapped on set',
    wrapDayCallers.indexOf('today/index.html') >= 0, wrapDayCallers.join(' '));

  const wrapCallers = callers(/\b(V|CVault)\.setWrapped\s*\(/);
  t('reach: a shipped page marks a production wrapped', wrapCallers.length > 0,
    'no page outside projects/lib-vault.js and scripts/ calls setWrapped');
  t('reach: /projects/ is one of them — the vault owns the slot',
    wrapCallers.indexOf('projects/index.html') >= 0, wrapCallers.join(' '));
  t('reach: and the same page can un-wrap it',
    callers(/\b(V|CVault)\.clearWrapped\s*\(/).indexOf('projects/index.html') >= 0);

  /* Deliberate, confirmed and reversible — a wrap teaches every future film,
     so it may not be a switch somebody brushes past. */
  const proj = read('projects/index.html'), today = read('today/index.html');
  t('reach: the production wrap asks first',
    /confirm\(\s*['"]Mark "/.test(proj) && /confirm\(\s*['"]Re-open "/.test(proj));
  t('reach: the day wrap asks first', /if \(!confirm\(ask\)\) return;/.test(today));
  t('reach: the day control retracts through the same call',
    /wrapDay\([^)]*!rec\.wrapped\s*\)/.test(today));
  t('reach: /today/ loads the library it calls',
    /<script src="\/js\/lib-shootdays\.js/.test(today));
  t('reach: the day control interpolates nothing into markup',
    !/tdWrap[^\n]*innerHTML/.test(today));
}

console.log('\ntest_wrapgate: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
