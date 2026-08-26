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
t('board flags a legacy boolean committedPo as unjoinable', b.legacyPo === 1 && b.estLearned === 0);
t('empty board is calm', V.board([]).total === 0 && V.board([]).totalAwarded === 0);

/* ── bid → final: the closed loop ──────────────────────────────────────────
   The board bids the work and commits a PO; the Money Room settles it. The
   only thing joining the two is the PO NUMBER on the shot, and the only thing
   worth learning from is a PO the owner has marked paid. Amounts carry cents
   throughout — a VFX invoice is not a round number, and the observation is
   stored as integer cents.                                                */
{
  const M = globalThis.CMoneyMath;
  const money = CMoney.blank();
  const shots2 = [];
  const mk = (f) => { const s = V.makeShot(shots2, f); shots2.push(s); return s; };
  const award = (sh, when) => {
    const po = CMoney.addPO(money, { vendor: sh.vendor, desc: sh.code + ' — ' + sh.desc,
      acct: V.ACCT, amount: sh.bid, date: when });
    sh.committedPo = po.num;          // the number, never `true`
    return po;
  };
  const pay = (po, amount) => { po.amount = amount; CMoney.setPoStatus(money, po.id, 'paid'); return po; };

  const over  = mk({ scene: 1, desc: 'Reactor bloom', complexity: 'complex', vendor: 'Nova FX', bid: 12000.50 });
  const under = mk({ scene: 2, desc: 'Wire removal pass', complexity: 'complex', vendor: 'Nova FX', bid: 9000.25 });
  const open  = mk({ scene: 3, desc: 'Crowd tile', complexity: 'complex', vendor: 'Nova FX', bid: 15000.75 });
  const hero  = mk({ scene: 4, desc: 'Dragon flyover', complexity: 'hero', vendor: 'Riven', bid: 30000.10 });
  const lost  = mk({ scene: 5, desc: 'Sky replace', complexity: 'simple', vendor: 'Nova FX', bid: 700.40 });

  t('awarding stores the PO number, not a boolean',
    /^PO-\d+$/.test(award(over, '2026-03-01').num) && V.poRef(over) === over.committedPo);
  const poUnder = award(under, '2026-03-02');
  const poOpen  = award(open, '2026-03-04');
  t('poRef ignores a boolean committedPo', V.poRef({ committedPo: true }) === '' && V.poRef({ committedPo: false }) === '');

  /* the legacy pair: both committed before the number was kept */
  const poHero = CMoney.addPO(money, { vendor: 'Riven', desc: hero.code + ' — ' + hero.desc,
    acct: V.ACCT, amount: hero.bid, date: '2026-03-03' });
  hero.committedPo = true;            // what an old board wrote
  lost.committedPo = true;            // committed, and no PO in the store matches it

  const mig = V.migratePoRefs(shots2, money);
  t('legacy boolean recovered from the Money Room by shot code',
    mig.migrated === 1 && hero.committedPo === poHero.num && !hero.poUnjoinable);
  t('legacy boolean with no matching PO is marked, not dropped',
    mig.unjoinable === 1 && lost.committedPo === true && lost.poUnjoinable === true);
  t('migration is idempotent', V.migratePoRefs(shots2, money).migrated === 0);
  t('board counts the still-unjoinable one', V.board(shots2).legacyPo === 1);

  /* settle three invoices; the fourth stays open */
  pay(V.poRef(over) && money.pos.filter((p) => p.num === over.committedPo)[0], 14400.60);   // 1.20x
  pay(poUnder, 7200.20);                                                                    // 0.80x
  pay(poHero, 45000.15);                                                                    // 1.50x
  t('the open PO is still open', poOpen.status === 'open');

  const obs = V.observeFinals(shots2, money, []);
  t('one observation per settled PO, none for the open one', obs.length === 3);
  t('the open shot is not among them', !obs.some((o) => o.po === poOpen.num));
  const oOver = obs.filter((o) => o.shot === over.code)[0];
  t('observation carries the loop fields',
    !!oOver && oOver.acct === V.ACCT && oOver.complexity === 'complex' &&
    oOver.vendor === 'Nova FX' && oOver.t === '2026-03-01');
  t('bid and final are integer cents, and bid is the RAW bid',
    oOver.bid === M.cents(over.bid) && oOver.bid === 1200050 && oOver.final === 1440060 &&
    oOver.bid % 1 === 0 && oOver.final % 1 === 0);
  t('observing again with the same record learns nothing new',
    V.observeFinals(shots2, money, obs).length === 0);
  const finals = V.mergeFinals([], obs);
  t('mergeFinals bounds the list', V.mergeFinals(new Array(260).fill(obs[0]), obs).length === 200);

  /* ── suppression: one observation is an anecdote ── */
  t('MIN_FINALS is the props threshold', V.MIN_FINALS === 2);
  const heroCal = V.calibrateEst(finals, 'hero');
  t('one hero final does not calibrate, but the count is visible',
    heroCal.n === 1 && heroCal.mult === 1 && heroCal.learned === false && heroCal.basis === 'none');
  const heroEst = V.internalEst('hero', { finals: finals });
  t('a suppressed tier keeps the shipped band exactly',
    heroEst.lo === 20000 && heroEst.hi === 80000 && heroEst.learnedN === 0 && heroEst.evidenceN === 1);
  t('the note says how far off the threshold it is',
    /^1 hero shot finalled so far — 2 needed/.test(V.finalNote(finals, 'hero')));
  t('at zero evidence the note says nothing at all',
    V.finalNote(finals, 'simple') === '' && V.finalNote([], 'complex') === '' &&
    V.calibrateEst([], 'complex').n === 0);

  /* ── two observations: the band moves ── */
  const cx = V.calibrateEst(finals, 'complex');
  t('EWMA over 1.20x then 0.80x → 1.08x on two complex finals',
    cx.n === 2 && cx.mult === 1.08 && cx.learned === true && cx.basis === 'complexity');
  const cxEst = V.internalEst('complex', { finals: finals });
  t('the corrected band is the shipped band times the multiplier',
    cxEst.lo === Math.round(6000 * 1.08) && cxEst.hi === Math.round(20000 * 1.08) &&
    cxEst.rawLo === 6000 && cxEst.rawHi === 20000 && cxEst.learnedN === 2 && cxEst.mult === 1.08);
  t('internalEst with no finals is untouched',
    V.internalEst('complex').lo === 6000 && V.internalEst('complex').learnedN === 0 &&
    V.internalEst('complex').mult === 1);
  t('bidVsEst compares against the corrected band, not the shipped one',
    V.bidVsEst({ complexity: 'complex', bid: 21000 }, { finals: finals }).status === 'within' &&
    V.bidVsEst({ complexity: 'complex', bid: 21000 }).status === 'above' &&
    V.bidVsEst({ complexity: 'complex', bid: 25000 }, { finals: finals }).delta === 25000 - cxEst.hi);
  t('the sentence names N and the multiplier',
    V.finalNote(finals, 'complex') === 'Your last 2 complex shots finalled at 1.08× bid.');

  /* ── vendor before tier, and case does not matter ── */
  const byVendor = V.calibrateEst(finals, 'complex', 'nova fx');
  t('two finals from one vendor calibrate on the vendor',
    byVendor.basis === 'vendor' && byVendor.n === 2 && byVendor.vendor === 'Nova FX');
  t('a vendor with no history falls back to the tier',
    V.calibrateEst(finals, 'complex', 'Someone New').basis === 'complexity');

  /* ── the tier flips on at exactly MIN_FINALS ── */
  const hero2 = mk({ scene: 6, desc: 'Second dragon', complexity: 'hero', vendor: 'Riven', bid: 20000.40 });
  pay(award(hero2, '2026-03-05'), 24000.48);                                                // 1.20x
  const finals2 = V.mergeFinals(finals, V.observeFinals(shots2, money, finals));
  const heroCal2 = V.calibrateEst(finals2, 'hero');
  t('the second hero final turns the correction on (1.50 then 1.20 → 1.41)',
    heroCal2.n === 2 && heroCal2.learned === true && heroCal2.mult === 1.41);
  /* three complex shots and two hero ones stand on evidence; the one simple
     shot on the board has none, so its band is left exactly as shipped */
  t('board totals use the corrected bands only where there is evidence',
    V.board(shots2, { finals: finals2 }).estLearned === 5 &&
    V.board(shots2, { finals: finals2 }).estHi >
      V.board(shots2).estHi &&
    V.board(shots2).estLearned === 0);

  /* a wild single result cannot run away with the next film's band */
  const wild = [{ complexity: 'simple', vendor: 'X', bid: 100000, final: 9000000, t: '2026-01-01' },
                { complexity: 'simple', vendor: 'X', bid: 100000, final: 9000000, t: '2026-01-02' }];
  t('the correction is clamped at 2x', V.calibrateEst(wild, 'simple').mult === 2);
  t('and at 0.5x the other way', V.calibrateEst(
    wild.map((w) => ({ ...w, final: 1000 })), 'simple').mult === 0.5);
}

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
