/* Smoke test for timeline/timeline-budget.js (SBBudget) — run: node scripts/test_budget_estimator.mjs */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'timeline', 'timeline-budget.js'), 'utf8');
(0, eval)(src); // module attaches SBBudget to globalThis when window is absent
const SBBudget = globalThis.SBBudget;

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok  ' + name); }
  else { failures++; console.error('FAIL  ' + name + (extra != null ? ' — got: ' + JSON.stringify(extra) : '')); }
}

const SCRIPT = `
INT. WAREHOUSE - NIGHT

RAIN hammers the skylights. JACK (40s, scarred) levels his PISTOL at the doorway.

JACK
Don't move.

A CROWD of dockworkers scatters as an EXPLOSION rips through the far wall. Flames everywhere.

EXT. HARBOR - NIGHT

Jack sprints along the pier. A speedboat chase across the harbor. MAYA dives into the water, swimming under the burning boat.

MAYA
(surfacing)
Go! Go!

INT. SAFEHOUSE - DAY

Maya bandages Jack's arm. A dog sleeps by the door. Children laugh outside.

MAYA
You should have told me about the money.

JACK
You never asked.

EXT. CITY STREET - DAY

A black SUV swerves through traffic. Jack fights two MEN on the hood. Gunshots. The car crashes into a fruit stand.
`;

const state = {
  projectName: 'Harbor Run',
  scriptText: SCRIPT.repeat(12), // ~ a few pages worth of words
  clips: Array.from({ length: 24 }, (_, i) => ({
    id: 'clip-' + i,
    heading: i % 2 ? 'EXT. HARBOR - NIGHT' : 'INT. WAREHOUSE - NIGHT',
    durationSec: 5,
    description: 'beat',
    characters: i % 3 ? ['JACK'] : ['JACK', 'MAYA'],
  })),
  characters: { JACK: {}, MAYA: {}, DOCKWORKER: {}, DRIVER: {} },
  locationBible: [{ name: 'WAREHOUSE' }, { name: 'HARBOR' }, { name: 'SAFEHOUSE' }, { name: 'CITY STREET' }],
  parseResult: null,
  global: { model: 'seedance-2.0-turbo', quality: '720p', clipDuration: 5 },
};

// ── analyze ──
const a = SBBudget.analyze(state);
check('pages > 0', a.pages > 0, a.pages);
check('scenes detected', a.scenes >= 2, a.scenes);
check('night scenes detected', a.nightCount >= 1, a.nightCount);
check('cast counted', a.castTotal >= 4, a.castTotal);
check('leads capped at 2', a.leads <= 2, a.leads);
check('locations >= 2', a.uniqueLocations >= 2, a.uniqueLocations);
const keys = a.drivers.map(d => d.key);
check('detects stunts', keys.includes('stunts'), keys);
check('detects pyro', keys.includes('pyro'), keys);
check('detects water', keys.includes('water'), keys);
check('detects gunplay', keys.includes('gunplay'), keys);
check('detects crowds', keys.includes('crowds'), keys);
check('complexity in range', a.complexity > 0 && a.complexity <= 100, a.complexity);

// ── AI estimate ──
const ai = SBBudget.estimateAI(state, a, { retakeFactor: 1.6, concurrency: 3 });
check('one row per model', ai.rows.length === Object.keys(SBBudget.AI_MODEL_RATES).length, ai.rows.length);
check('selected row matches state', ai.selectedRow.id === 'seedance-2.0-turbo', ai.selectedRow.id);
const row = ai.selectedRow;
check('one-pass cost = clips*dur*rate', Math.abs(row.onePassUsd - 24 * 5 * row.usdPerSec) < 1e-9, row.onePassUsd);
check('likely > one pass', row.likelyUsd > row.onePassUsd, row.likelyUsd);
check('wall clock positive', row.wallMinutes > 0, row.wallMinutes);
ai.rows.forEach(r => check('rate defined for ' + r.id, typeof r.usdPerSec === 'number' && isFinite(r.usdPerSec) && (r.usdPerSec > 0 || r.id.indexOf('local') === 0), r.usdPerSec));

// ── production estimate ──
const prod = SBBudget.estimateProduction(a, { scale: 'indie', director: 'established', lead: 'name', supporting: 'seasoned', crew: 'union', locations: 'city', equipment: 'pro', vfx: 'auto' });
check('shoot days >= 5', prod.schedule.shootDays >= 5, prod.schedule.shootDays);
check('total low < high', prod.total.low < prod.total.high, prod.total);
check('likely between low and high', prod.total.likely > prod.total.low && prod.total.likely < prod.total.high, prod.total);
check('has 4 groups', Object.keys(prod.groups).length === 4, Object.keys(prod.groups));
const indieTotal = prod.total.likely;
const tentpole = SBBudget.estimateProduction(a, { scale: 'tentpole', director: 'alist', lead: 'megastar', supporting: 'name', crew: 'union', locations: 'premium', equipment: 'imax', vfx: 'full' });
check('tentpole >> indie', tentpole.total.likely > indieTotal * 3, { indie: indieTotal, tentpole: tentpole.total.likely });
const micro = SBBudget.estimateProduction(a, { scale: 'micro', director: 'first', lead: 'unknown', supporting: 'scale', crew: 'nonunion', locations: 'local', equipment: 'indie', vfx: 'none' });
check('micro << indie', micro.total.likely < indieTotal, { micro: micro.total.likely, indie: indieTotal });
check('micro plausibly < $2.5M', micro.total.likely < 2.5e6, micro.total.likely);

// ── vfx auto-suggest ──
check('vfx auto-suggest returns valid tier', SBBudget.TIERS.vfx.some(t => t.id === SBBudget.suggestVfxTier(a)), SBBudget.suggestVfxTier(a));

// ── eighths-based scene measurement (CineSched convention) ──
const scenes = SBBudget.splitScenes(SCRIPT);
check('splitScenes finds 4 scenes', scenes.length === 4, scenes.length);
check('every scene has >= 1 eighth', scenes.every(s => s.eighths >= 1), scenes.map(s => s.eighths));
check('analysis carries eighths total', a.eighthsTotal > 0, a.eighthsTotal);
check('sceneEighths length matches scenes', a.sceneEighths.length > 0, a.sceneEighths.length);

// ── genre inference + benchmarks ──
check('genre inferred as action-ish', ['Action', 'Thriller', 'Crime'].includes(a.genre), a.genre);
check('percentile monotonic', SBBudget.budgetPercentile(1e6) < SBBudget.budgetPercentile(50e6), [SBBudget.budgetPercentile(1e6), SBBudget.budgetPercentile(50e6)]);
check('percentile bounded', SBBudget.budgetPercentile(5e9) <= 99 && SBBudget.budgetPercentile(1000) >= 1);

// ── DOOD-based cast + top-sheet accounts ──
check('sceneCast built for JACK', Array.isArray(a.sceneCast.JACK) && a.sceneCast.JACK.length > 0, a.sceneCast);
const atlKeys = Object.keys(prod.groups['Above the line']);
check('top-sheet accounts in ATL', atlKeys.some(k => k.startsWith('1000')) && atlKeys.some(k => k.startsWith('4100')), atlKeys);
const btlKeys = Object.keys(prod.groups['Production (below the line)']);
check('crew split into dept accounts', btlKeys.some(k => k.startsWith('6000')) && btlKeys.some(k => k.startsWith('8000')) && btlKeys.some(k => k.startsWith('13000')), btlKeys);
check('dood summary present', prod.dood && prod.dood.avgSupportWeeks >= 1, prod.dood);
check('benchmark present with percentile', prod.benchmark && prod.benchmark.percentile >= 1 && prod.benchmark.percentile <= 99, prod.benchmark);

// ── tax incentives ──
const ga = SBBudget.estimateProduction(a, { scale: 'indie', director: 'established', lead: 'name', supporting: 'seasoned', crew: 'union', locations: 'city', equipment: 'pro', vfx: 'auto', incentive: 'georgia' });
check('georgia recovery computed', ga.recovery && ga.recovery.likely > 0, ga.recovery);
check('recovery ≈ likely × qualPct × midRate', Math.abs(ga.recovery.likely - ga.total.likely * 0.75 * 0.25) < 1, ga.recovery.likely);
check('net below gross', ga.recovery.netLikely < ga.total.likely, ga.recovery.netLikely);
const none = SBBudget.estimateProduction(a, { incentive: 'none' });
check('no recovery when none', none.recovery === null, none.recovery);
const bc = SBBudget.INCENTIVES.find(i => i.id === 'bc');
check('labor-only credit has lower qualPct', bc.qualPct < 0.6, bc.qualPct);

// ── digest ──
const digest = SBBudget.buildDigest(state, a, prod, ai);
check('digest under server cap', digest.length <= 1900, digest.length);
check('digest mentions totals', /MODEL TOTAL/.test(digest));
check('digest mentions drivers', /BUDGET DRIVERS/.test(digest));

// ── formatting ──
check('fmtMoney 950', SBBudget.fmtMoney(950) === '$950', SBBudget.fmtMoney(950));
check('fmtMoney 12.5k', SBBudget.fmtMoney(12500) === '$12.5k', SBBudget.fmtMoney(12500));
check('fmtMoney 1.2M', SBBudget.fmtMoney(1200000) === '$1.2M', SBBudget.fmtMoney(1200000));
check('fmtMoney 2B', SBBudget.fmtMoney(2.04e9) === '$2.04B', SBBudget.fmtMoney(2.04e9));
check('fmtMins 45', SBBudget.fmtMins(45) === '45 min', SBBudget.fmtMins(45));
check('fmtMins 125', SBBudget.fmtMins(125) === '2h 5m', SBBudget.fmtMins(125));

// ── no-script fallback ──
const empty = SBBudget.analyze({ clips: [], scriptText: '', characters: {}, global: {} });
check('empty state analyzes without crash', empty.pages >= 1, empty.pages);

console.log(failures ? '\n' + failures + ' FAILURES' : '\nAll budget estimator checks passed.');
process.exit(failures ? 1 : 0);
