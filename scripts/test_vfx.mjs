#!/usr/bin/env node
/* Node tests for vfx/lib-vfx.js (CVfx) — run: node scripts/test_vfx.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* the one scene model — lib-vfx.js reads its scenes from here */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
/* the money substrate — the bid→final loop carries integer cents, and the page
   loads this before lib-vfx.js for the same reason */
(0, eval)(readFileSync(join(ROOT, 'js/lib-money-math.js'), 'utf8'));
/* the real Money Room, so the PO join is tested against the store the page
   actually writes rather than a hand-shaped stand-in */
(0, eval)(readFileSync(join(ROOT, 'finance/lib-money.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'vfx/lib-vfx.js'), 'utf8'));
const V = globalThis.CVfx, CMoney = globalThis.CMoney;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SCRIPT = `INT. LAB - NIGHT
A hologram flickers over the console. Sparks fly as the reactor
begins to detonate — the explosion rips through the far wall.

EXT. CITY STREET - DAY
A taxi crashes through the barricade. Above, the sky darkens as
a storm rolls in. Maya is hurled across the intersection.

EXT. MOUNTAIN PASS - DUSK
The dragon soars over the ridge, then disappears into the clouds.

INT. CHAPEL - NIGHT
Candles gutter. A ghost drifts down the aisle.`;

/* ── scene split & detection ── */
const scenes = V.splitScenes(SCRIPT);
t('splitScenes finds 4 scenes', scenes.length === 4);
const sugg = V.detectShots(SCRIPT);
t('detectShots returns suggestions', sugg.length >= 8);
t('every suggestion has scene/hint/complexity', sugg.every(s =>
  s.scene >= 1 && s.hint && V.COMPLEXITIES.indexOf(s.complexity) >= 0));
const inScene = n => sugg.filter(s => s.scene === n);
t('explosion detected in scene 1 as complex', inScene(1).some(s => /Explosion/.test(s.hint) && s.complexity === 'complex'));
t('hologram detected in scene 1 as medium', inScene(1).some(s => /Hologram/.test(s.hint) && s.complexity === 'medium'));
t('crash detected in scene 2 as complex', inScene(2).some(s => /Crash/.test(s.hint)));
t('storm + sky + wire cues all found in scene 2', inScene(2).some(s => /Storm/.test(s.hint)) &&
  inScene(2).some(s => /Sky/.test(s.hint) && s.complexity === 'simple') &&
  inScene(2).some(s => /Wire removal/.test(s.hint)));
t('dragon detected in scene 3 as hero', inScene(3).some(s => /dragon/i.test(s.hint) && s.complexity === 'hero'));
t('disappearance detected in scene 3', inScene(3).some(s => /Disappearance/.test(s.hint)));
t('ghost detected in scene 4', inScene(4).some(s => /Ghost/.test(s.hint) && s.complexity === 'medium'));
t('one suggestion per cue per scene (no dupes)',
  new Set(sugg.map(s => s.scene + '|' + s.hint)).size === sugg.length);
t('empty script → no suggestions', V.detectShots('').length === 0);

/* ── shot codes & creation ── */
t('first code is VFX-010', V.nextCode([]) === 'VFX-010');
const shots = [];
shots.push(V.makeShot(shots, { scene: 1, desc: 'Reactor explosion', complexity: 'complex', bid: 0 }));
shots.push(V.makeShot(shots, { scene: 2, desc: 'Taxi crash takeover', complexity: 'complex' }));
shots.push(V.makeShot(shots, { scene: 3, desc: 'Dragon flyover', complexity: 'hero' }));
t('codes increment by 10', shots[0].code === 'VFX-010' && shots[1].code === 'VFX-020' && shots[2].code === 'VFX-030');
t('nextCode skips past highest', V.nextCode([{ code: 'VFX-090' }, { code: 'VFX-040' }]) === 'VFX-100');
t('new shot defaults', shots[0].status === 'briefed' && shots[0].version === 'v001' &&
  shots[0].committedPo === false && shots[0].bid === 0);
t('bad complexity falls back to medium', V.makeShot([], { complexity: 'insane' }).complexity === 'medium');
t('statusRank orders lifecycle', V.statusRank('briefed') < V.statusRank('awarded') &&
  V.statusRank('awarded') < V.statusRank('approved'));

/* ── planning estimates & bids ── */
t('rate bands match spec', V.RATES.simple.lo === 500 && V.RATES.simple.hi === 1500 &&
  V.RATES.medium.lo === 1500 && V.RATES.medium.hi === 6000 &&
  V.RATES.complex.lo === 6000 && V.RATES.complex.hi === 20000 &&
  V.RATES.hero.lo === 20000 && V.RATES.hero.hi === 80000);
t('internalEst labelled as planning estimate', V.internalEst('hero').label === 'planning estimate');
t('internalEst unknown complexity → medium band', V.internalEst('weird').lo === 1500);
t('bidVsEst no-bid', V.bidVsEst({ complexity: 'simple', bid: 0 }).status === 'no-bid');
t('bidVsEst within', V.bidVsEst({ complexity: 'medium', bid: 3000 }).status === 'within');
const above = V.bidVsEst({ complexity: 'simple', bid: 2000 });
t('bidVsEst above with delta', above.status === 'above' && above.delta === 500);
const below = V.bidVsEst({ complexity: 'hero', bid: 12000 });
t('bidVsEst below with negative delta', below.status === 'below' && below.delta === -8000);

/* ── plate checklist scaling ── */
const pSimple = V.plateChecklist('simple'), pMed = V.plateChecklist('medium'),
      pCx = V.plateChecklist('complex'), pHero = V.plateChecklist('hero');
t('checklist grows with complexity', pSimple.length < pMed.length && pMed.length < pCx.length && pCx.length < pHero.length);
t('simple always has lens data + stills', pSimple.some(x => /Lens/.test(x)) && pSimple.some(x => /Reference stills/.test(x)));
t('medium adds clean plate + markers', pMed.some(x => /Clean plate/.test(x)) && pMed.some(x => /Tracking markers/.test(x)));
t('complex adds HDRI + chrome/grey balls', pCx.some(x => /HDRI/.test(x)) && pCx.some(x => /Chrome ball/.test(x)));
t('hero adds witness cam + survey', pHero.some(x => /Witness cam/.test(x)) && pHero.some(x => /survey/i.test(x)));
t('unknown complexity → medium checklist', V.plateChecklist('??').length === pMed.length);

/* ── board & awarded money ── */
shots[0].bid = 15000; shots[0].status = 'awarded';
shots[1].bid = 9000;  shots[1].status = 'bid';
shots[2].bid = 45000; shots[2].status = 'final'; shots[2].committedPo = true;
const b = V.board(shots);
t('board counts per status', b.counts.awarded === 1 && b.counts.bid === 1 && b.counts.final === 1 && b.counts.briefed === 0);
t('board total shots', b.total === 3);
t('totalBid sums all bids', b.totalBid === 69000);
t('totalAwarded only status ≥ awarded', b.totalAwarded === 60000);
t('uncommitted flags awarded-but-no-PO', b.uncommitted === 1);
t('est range totals sum bands', b.estLo === 6000 + 6000 + 20000 && b.estHi === 20000 + 20000 + 80000);
t('empty board is calm', V.board([]).total === 0 && V.board([]).totalAwarded === 0);

/* ── versions & day sheet ── */
t('versionName composes slug_code_status_version',
  V.versionName('Night Harvest!', shots[0], 'temp') === 'NIGHTHARVEST_VFX-010_temp_v001');
t('versionName defaults survive blanks', V.versionName('', {}, '') === 'PROJECT_VFX-000_temp_v001');
t('bumpVersion pads', V.bumpVersion('v001') === 'v002' && V.bumpVersion('v099') === 'v100');
t('bumpVersion tolerates junk', V.bumpVersion('garbage') === 'v001');
const sheet = V.daySheet(shots, 'Night Harvest');
t('day sheet groups by scene', sheet.indexOf('SCENE 1') >= 0 && sheet.indexOf('SCENE 2') >= 0 && sheet.indexOf('SCENE 3') >= 0);
t('day sheet lists shot codes + desc', sheet.indexOf('VFX-010') >= 0 && sheet.indexOf('Reactor explosion') >= 0);
t('day sheet scales plates to scene max complexity',
  sheet.split('SCENE 3')[1].indexOf('Witness cam') >= 0);
t('day sheet carries verify note', /planning aid, not a vendor spec/.test(sheet));
t('empty day sheet says so', /no VFX shots/.test(V.daySheet([], 'X')));

console.log(`test_vfx: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
