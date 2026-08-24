#!/usr/bin/env node
/* Node checks for the learning layer (js/learn.js) and its estimator hook. */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'js/learn.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'timeline/timeline-doc.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'timeline/timeline-budget.js'), 'utf8'));
const L = globalThis.CLearn, B = globalThis.SBBudget;

let failed = 0;
function ok(cond, name) {
  if (cond) console.log('  ok ', name);
  else { console.error('  FAIL', name); failed = 1; }
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps;

L.reset();

/* ── budget calibration ── */
{
  const sheet = { categories: [
    { acct: '11000', items: [
      { desc: 'Director', est: 100000, actual: 150000 },
      { desc: 'Producer', est: 200000, actual: 260000 },
      { desc: 'No actual yet', est: 50000, actual: 0 }
    ] },
    { acct: '20000', items: [{ desc: 'Cast', est: 300000, actual: 240000 }] }
  ] };
  ok(L.learnBudget(sheet) === 3, 'learn: three rows with actuals learned');
  ok(L.learnBudget(sheet) === 0, 'learn: idempotent — same sheet learns nothing new');
  const c = L.calibration('11000');
  ok(c.n === 2 && near(c.mult, 1.5 * 0.7 + 1.3 * 0.3), 'learn: EWMA calibration (' + c.mult + ')');
  ok(L.calibration('20000').mult === 1 && L.calibration('20000').n === 1, 'learn: one data point stays anecdotal');
  ok(L.calibration('99999').mult === 1, 'learn: unknown account neutral');
  // clamp: a wild overage cannot more than double future estimates
  const wild = { categories: [{ acct: '30000', items: [
    { desc: 'a', est: 100, actual: 10000 }, { desc: 'b', est: 100, actual: 10000 }
  ] }] };
  L.learnBudget(wild);
  ok(L.calibration('30000').mult === 2, 'learn: correction clamped at 2x');
  const s = L.budgetSummary();
  ok(s.lines === 5 && s.avgMult > 1, 'learn: summary aggregates');
}

/* ── render-speed learning ── */
{
  ok(!L.recordRender(5, 1), 'render: sub-3s (cached/instant) rejected');
  ok(!L.recordRender(5, 4000), 'render: stalls rejected');
  ok(L.genSecPerClip(90) === 90, 'render: falls back to shipped default with no data');
  L.recordRender(5, 40); L.recordRender(5, 30);
  ok(L.genSecPerClip(90) === 90, 'render: still default below 3 samples');
  L.recordRender(4, 32);
  ok(L.genSecPerClip(90) === 32, 'render: learned median after 3 samples');
  const st = L.renderStats();
  ok(st.n === 3 && st.wallPerClip === 32, 'render: stats median');
  // trend: 8 samples, second half faster
  L.reset();
  [60, 58, 61, 59, 40, 38, 41, 39].forEach(w => L.recordRender(5, w));
  ok(L.renderStats().trend === 'faster', 'render: improving machine detected as faster');
}

/* ── estimator hook: the Studio schedule uses the measured speed ── */
{
  L.reset();
  const st = { global: { model: 'local-comfy', clipDuration: 5 } };
  const analysis = { clips: 12, scenes: 4 };
  const lb = B.estimateAI(st, analysis, {}).rows.find(r => r.id === 'local-comfy');
  [25, 30, 28].forEach(w => L.recordRender(5, w));
  const la = B.estimateAI(st, analysis, {}).rows.find(r => r.id === 'local-comfy');
  ok(lb && la, 'hook: local model present in estimate');
  ok(la.wallMinutes < lb.wallMinutes, 'hook: learned speed shortens the schedule (' + lb.wallMinutes + ' → ' + la.wallMinutes + ' min)');
  const cloud = B.estimateAI(st, analysis, {}).rows.find(r => r.id === 'seedance-2.0-turbo');
  ok(cloud.wallMinutes === B.estimateAI(st, analysis, {}).rows.find(r => r.id === 'seedance-2.0-turbo').wallMinutes, 'hook: cloud models untouched by local learning');
}

/* ── research cache ── */
{
  L.reset();
  const now = 1000000;
  L.cachePut('k1', { a: 1 }, 5000, now);
  ok(L.cacheGet('k1', now + 1000).a === 1, 'cache: hit inside TTL');
  ok(L.cacheGet('k1', now + 9000) === null, 'cache: expired after TTL');
  for (let i = 0; i < 65; i++) L.cachePut('x' + i, i, 1e9, now + i);
  ok(Object.keys(L._state().cache).length <= 60, 'cache: eviction keeps the store bounded');
  ok(L.cacheGet('x64', now + 100) === 64, 'cache: newest entries survive eviction');
}

/* ── persistence shape ── */
{
  const snap = JSON.parse(JSON.stringify(L._state()));
  ok(snap.render && snap.cache && snap.budget, 'state: serializes clean');
  ok(L.KEY === 'CIN_Learn_v1', 'state: global key outside the per-project namespace');
}

L.reset();
if (failed) { console.error('\nLearn checks FAILED'); process.exit(1); }

/* The research cache holds replies from TMDB and Wikidata for a week and
   lives outside the SB_* namespace the vault sanitiser covers — deliberately,
   so learning survives project switches. That makes this the only place the
   cleaning can happen. */
{
  const hostile = {
    name: '<img src=x onerror=alert(1)>',
    nested: { bio: 'a"b<script>alert(1)</script>' },
    list: ['<b>x</b>', "it's fine"],
    '<key>': 'v',
  };
  L.cachePut('tmdb:hostile', hostile);
  const back = L.cacheGet('tmdb:hostile');
  const bad = [];
  (function walk(n, path) {
    if (typeof n === 'string') { if (/[<>"']/.test(n)) bad.push(path + ' = ' + n); return; }
    if (n && typeof n === 'object') {
      for (const k of Object.keys(n)) {
        if (/[<>"']/.test(k)) bad.push('KEY ' + path + '.' + k);
        walk(n[k], path + '.' + k);
      }
    }
  })(back, '');
  ok(bad.length === 0, 'cache: a third-party reply is neutralised on the way in' +
    (bad.length ? ' — ' + bad.join('; ') : ''));
  ok(back && back.name === 'img src=x onerror=alert(1)' && back.list.length === 2,
    'cache: the reply is still usable after cleaning');
  ok(back && !Object.prototype.hasOwnProperty.call(back, '<key>') &&
     Object.prototype.hasOwnProperty.call(back, 'key'),
    'cache: a hostile object key is cleaned, not kept');

  L.cachePut('proto', JSON.parse('{"__proto__":{"polluted":1}}'));
  ok({}.polluted === undefined, 'cache: a __proto__ key does not pollute Object.prototype');

  let deep = {}, cur = deep;
  for (let i = 0; i < 300; i++) { cur.child = {}; cur = cur.child; }
  let threw = false;
  try { L.cachePut('deep', deep); } catch (e) { threw = true; }
  ok(!threw, 'cache: a deeply nested reply is bounded, not thrown on');
}

/* This used to print the success line unconditionally and never call
   process.exit, so the suite reported "All learn checks passed" and exited 0
   even with failures on the screen — a green light nobody could rely on, and
   the runner could not tell the difference. */
if (failed) {
  console.error('\nlearn checks FAILED — see the FAIL lines above.');
  process.exit(1);
}
console.log('\nAll learn checks passed.');
process.exit(0);
