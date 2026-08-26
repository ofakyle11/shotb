#!/usr/bin/env node
/* One budget engine — run: node scripts/test_budget_engines.mjs
 *
 * The platform shipped TWO copies of the producer's estimate: js/budget-engine.js
 * (loaded by dashboard.html) and timeline/timeline-budget.js (loaded by the
 * Timeline, the Producer Suite and Workflow). They were 95.9% identical, both
 * exported `window.SBBudget`, and on the same documentary they disagreed 4.5x —
 * because only one of them knows documentaries exist.
 *
 * This suite ran FIRST as a two-engine agreement test (it failed, loudly, with
 * the 4.5x). js/budget-engine.js is now deleted and dashboard.html points at the
 * survivor, so what is left to assert is that the fork cannot come back:
 *   - no second copy of SBBudget ships,
 *   - every page that uses SBBudget loads the same file,
 *   - the survivor is the file the suites actually exercise,
 *   - and the doc-mode branch that caused the divergence is reachable from
 *     every page that loads it (timeline-doc.js is loaded alongside).
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENGINE = 'timeline/timeline-budget.js';

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error('  ✗', n); } };

/* ── 1 · exactly one SBBudget implementation ships ─────────────────────── */
const shipped = [];
function walk(rel) {
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (['docs', 'scripts', 'private', 'local-backend', 'netlify', 'agents',
           'netlify-git-guard', 'assets', 'static', 'css'].includes(r)) continue;
      walk(r);
    } else if (e.name.endsWith('.js')) {
      shipped.push(r);
    }
  }
}
walk('');
const defines = shipped.filter(f => /root\.SBBudget\s*=/.test(readFileSync(join(ROOT, f), 'utf8')));
t('exactly one file defines SBBudget', defines.length === 1);
t('the survivor is timeline/timeline-budget.js', defines[0] === ENGINE);
t('js/budget-engine.js is gone', !existsSync(join(ROOT, 'js/budget-engine.js')));

/* ── 2 · every page that uses SBBudget loads that one file ─────────────── */
const pages = [];
(function walkHtml(rel) {
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (['docs', 'private', 'local-backend', 'netlify', 'agents', 'node_modules',
           'netlify-git-guard'].includes(r)) continue;
      walkHtml(r);
    } else if (e.name.endsWith('.html')) pages.push(r);
  }
})('');

for (const p of pages) {
  const html = readFileSync(join(ROOT, p), 'utf8');
  if (!/\bSBBudget\b/.test(html)) continue;
  t(p + ' loads the one engine', /timeline-budget\.js/.test(html));
  t(p + ' does not load a second engine', !/budget-engine\.js/.test(html));
  /* The 4.5x came from documentary mode existing in one copy only. A page that
     loads the engine without timeline-doc.js gets the scripted number for a
     documentary and disagrees with the Timeline all over again. */
  t(p + ' loads timeline-doc.js beside it', /timeline-doc\.js/.test(html));
}

/* ── 3 · the survivor is a file the suites actually load ───────────────── */
const suites = readdirSync(join(ROOT, 'scripts')).filter(f => /^test_.*\.mjs$/.test(f));
const loadedBySuite = suites.some(s => readFileSync(join(ROOT, 'scripts', s), 'utf8').includes(ENGINE));
t('a suite loads the shipped engine', loadedBySuite);

/* ── 4 · the two surfaces agree on a documentary ───────────────────────── */
/* dashboard.html and the Timeline now run the same code; the remaining way to
   disagree is for one of them to withhold the mode. Both read SB_Budget_v1.  */
const dash = readFileSync(join(ROOT, 'dashboard.html'), 'utf8');
t('dashboard reads the shared SB_Budget_v1 prefs', /SB_Budget_v1/.test(dash));
t('dashboard passes mode into estimateProduction', /mode/.test(dash.slice(dash.indexOf('estSel'))));

/* And the engine itself must still route documentaries to SBDoc. */
const eng = readFileSync(join(ROOT, ENGINE), 'utf8');
t('engine routes documentary mode to SBDoc', /sel\.mode === 'documentary'[\s\S]{0,60}estimateDocCompat/.test(eng));

/* ── 5 · live behaviour: one engine, one answer, both modes ────────────── */
(0, eval)(readFileSync(join(ROOT, 'timeline/timeline-doc.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, ENGINE), 'utf8'));
const B = globalThis.SBBudget;

const DOC = `A WINTER IN THE VALLEY — documentary treatment

ARCHIVAL: 1974 news footage of the mill closing, black and white.

INTERVIEW — MARGARET OKONKWO, former millwright, in her kitchen.
She describes the last shift. We cut to archival photographs of the picket line.

VERITE: the empty mill floor at dawn. Handheld, available light.

INTERVIEW — DR. ELIAS REYES, labour historian, at the university.
NARRATION: The valley never recovered.

ARCHIVAL: home movies, super 8, the company picnic of 1969.
VERITE: the town council meeting, present day. Observational.
INTERVIEW — JUNE HALLORAN, mayor, on the steps of the town hall.`;

const analysis = B.analyze({ scriptText: DOC });
t('analysis carries the doc read', !!analysis.doc && analysis.doc.isDocLike === true);

const asDoc = B.estimateProduction(analysis, { mode: 'documentary', docScale: 'low', incentive: 'none' });
const asFeature = B.estimateProduction(analysis, { mode: 'scripted', scale: 'indie', incentive: 'none' });
t('documentary mode produces a documentary estimate', asDoc.mode === 'documentary');
t('documentary total is a positive number', asDoc.total.likely > 0);
/* The two modes SHOULD differ — that is the point of having a doc mode. What
   must never happen again is two files answering the same question differently
   for the same `sel`. Both numbers now come out of one file. */
t('the two modes are genuinely different products', asFeature.total.likely > asDoc.total.likely * 1.5);

console.log(`test_budget_engines: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
