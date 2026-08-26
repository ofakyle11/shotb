#!/usr/bin/env node
/* Node tests for the editor assist engine + deepened budget sheet.
   Run: node scripts/test_assist.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
globalThis.SBBudget = { fmtMoney: (n) => '$' + Math.round(n).toLocaleString() };
(0, eval)(readFileSync(join(ROOT, 'editor/lib-cut.js'), 'utf8'));
/* money substrate — hard load order: math → accounts → sheet */
for (const f of ['js/lib-money-math.js', 'js/lib-money-accounts.js', 'js/lib-money-sheet.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
(0, eval)(readFileSync(join(ROOT, 'producer/budget-sheet.js'), 'utf8'));
const C = globalThis.CCut, B = globalThis.SBBudgetSheet;

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.error('  ✗', n); } };

/* ══ assemble ══ */
const p = C.blank('x');
const n = C.assemble(p, [
  { id: 'a', dur: 8, scene: 1, label: 'Sc1 A' },
  { id: 'b', dur: 6, scene: 1, label: 'Sc1 B' },
  { id: 'c', dur: 10, scene: 2, label: 'Sc2 A' },
  { id: 'd', dur: 0.2, scene: 2, label: 'too short' }
]);
t('assemble: keeps usable clips, drops sub-half-second', n === 3 && p.video.length === 3);
t('assemble: handles trimmed off head/tail', p.video[0].in === 0.25 && p.video[0].out === 7.75);
t('assemble: cut within a scene, crossfade on scene change',
  p.video[1].trans.type === 'cut' && p.video[2].trans.type === 'crossfade' && p.video[2].trans.dur === 0.75);

/* ══ silences + tighten ══ */
const rate = 50;
const env = [];
for (let i = 0; i < rate * 10; i++) {
  const sec = i / rate;
  env.push(sec < 1.0 || sec > 8.6 ? 0.01 : 0.4);   // quiet first 1.0s and last 1.4s
}
const sil = C.silences(env, rate, {});
t('silences: finds head and tail regions', sil.length === 2 && sil[0].start === 0 && Math.abs(sil[0].end - 1.0) < 0.05);
t('silences: ignores sub-minDur gaps', C.silences([0.4, 0.01, 0.4], 50, {}).length === 0);
const p2 = C.blank('y');
p2.video = [{ id: 'v1', srcId: 's1', label: '', in: 0, out: 10, speed: 1, trans: { type: 'cut', dur: 0 } }];
const removed = C.tighten(p2, { s1: sil }, {});
t('tighten: trims lead and tail keeping a breath',
  p2.video[0].in > 0.8 && p2.video[0].in < 1.0 && p2.video[0].out > 8.6 && p2.video[0].out < 8.9 && removed > 2);

/* ══ beats + cutToBeats ══ */
const benv = [];
for (let i = 0; i < rate * 8; i++) {
  benv.push(i % rate === 0 ? 0.9 : 0.1);            // a hit every second
}
const bts = C.beats(benv, rate, {});
t('beats: one per second detected', bts.length >= 6 && Math.abs(bts[1] - bts[0] - 1) < 0.1);
const p3 = C.blank('z');
p3.video = [
  { id: 'c1', srcId: 's1', label: 'A', in: 0, out: 5, speed: 1, trans: { type: 'cut', dur: 0 } },
  { id: 'c2', srcId: 's2', label: 'B', in: 1, out: 4, speed: 1, trans: { type: 'cut', dur: 0 } }
];
const cuts = C.cutToBeats(p3, bts, { s1: 6, s2: 5 });
t('beat cut: one clip per beat interval, cycling sources', cuts === bts.length - 1 && p3.video[0].srcId === 's1' && p3.video[1].srcId === 's2');
t('beat cut: every slice ≈ one beat long', p3.video.every(c => Math.abs((c.out - c.in) - 1) < 0.15));

/* ══ color ══ */
t('color: neutral → none', C.cssFilter(null) === 'none' && C.cssFilter({ ex: 1, ct: 1, sat: 1, tw: 0 }) === 'none');
t('color: warm uses sepia, cool uses hue-rotate',
  /sepia/.test(C.cssFilter({ tw: 0.5 })) && /hue-rotate\(-/.test(C.cssFilter({ tw: -0.5 })));
const darkHist = new Array(256).fill(0); darkHist[40] = 500; darkHist[80] = 500;
const ac = C.autoColor(darkHist);
t('auto color: dark frame gets lifted + stretched', ac.ex > 1.2 && ac.ct > 1.1);
t('auto color: empty histogram neutral', C.autoColor(new Array(256).fill(0)).ex === 1);

/* ══ budget sheet deepening ══ */
const sh = B.blankSheet();
sh.categories.forEach(c => { c.items = []; });
const put = (acct, est) => { const c = sh.categories.find(x => x.acct === acct); const it = { id: 'x' + acct, desc: 'd', amt: '', units: '', rate: '', est, actual: 0, notes: '' }; c.items.push(it); };
put('4000', 100000);   // cast (labor)
put('6000', 50000);    // camera (labor)
put('15000', 40000);   // post (not labor for fringes)
sh.contingencyPct = 10; sh.fringesPct = 0; sh.bondPct = 0; sh.insurancePct = 0;
let tot = B.sheetTotals(sh);
t('budget: zero extras keeps legacy math', tot.subtotal === 190000 && tot.grand === 209000 && tot.fringes === 0);
sh.fringesPct = 25; sh.bondPct = 2; sh.insurancePct = 2.5;
tot = B.sheetTotals(sh);
t('budget: fringes on labor only', tot.fringes === Math.round(150000 * 0.25));
t('budget: bond+insurance on subtotal', tot.bond === 3800 && tot.insurance === 4750);
t('budget: contingency applies after extras', Math.round(tot.grand) === Math.round((190000 + 37500 + 3800 + 4750) * 1.1));
const nr = B.norms(sh);
const cast = nr.find(x => x.acct === '4000');
t('norms: cast ~41% flags high vs 8–30 band', cast.flag === 'high' && cast.pct > 30);
t('norms: silent categories stay ok', nr.find(x => x.acct === '7000').flag === 'ok');
const cf = B.cashflow(sh);
t('cashflow: post-heavy account lands in post', cf.post > cf.prep);
t('cashflow: phases sum to grand', Math.abs(cf.prep + cf.shoot + cf.post - tot.grand) < 2);
const ex = B.extras(sh);
t('extras: mirror of totals', ex.fringes === tot.fringes && ex.laborBase === 150000);

console.log(`test_assist: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
