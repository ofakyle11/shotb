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
ai.rows.forEach(r => check('rate defined for ' + r.id, r.usdPerSec > 0, r.usdPerSec));

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
