#!/usr/bin/env node
/* Node tests for wardrobe/lib-ward.js (CWard) — run: node scripts/test_wardrobe.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'wardrobe/lib-ward.js'), 'utf8'));
const W = globalThis.CWard;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SCRIPT = `INT. FARMHOUSE KITCHEN - NIGHT

MAGGIE
Supper's getting cold.

TOM (O.S.)
Be right down.

EXT. COUNTRY ROAD - DAY
Rain hammers the blacktop. Tom trudges through the mud.

TOM
This weather will be the death of me.

CUT TO:

INT. BARN - NIGHT
Tom and the stranger fight. Blood on the straw. His shirt is torn.

TOM (CONT'D)
Get off my land!

MAGGIE
Tom! Stop!

INT. FARMHOUSE KITCHEN - LATER
Maggie dabs water on the cut.

MAGGIE (V.O.)
He was never the same after that night.`;

/* ── scenes & characters ── */
const scenes = W.splitScenes(SCRIPT);
t('splitScenes finds 4 scenes', scenes.length === 4);
const chars = W.charactersFromScript(SCRIPT);
t('two speaking characters found', chars.length === 2);
const byName = {};
chars.forEach(c => { byName[c.name] = c; });
t('TOM found with scene list', byName.TOM && byName.TOM.scenes.join(',') === '1,2,3');
t('MAGGIE spans scenes 1,3,4', byName.MAGGIE && byName.MAGGIE.scenes.join(',') === '1,3,4');
t('cue suffixes stripped (V.O./O.S./CONT\'D merge)', byName.TOM.lines === 3 && byName.MAGGIE.lines === 3);
t('CUT TO: is not a character', chars.every(c => c.name.indexOf('CUT') < 0));
t('cueName rejects sluglines', W.cueName('INT. BARN - NIGHT') === null);
t('cueName rejects lowercase', W.cueName('Tom walks in.') === null);

/* ── scene number parsing ── */
t('parseSceneNums expands ranges', W.parseSceneNums('1, 4-6, 12').join(',') === '1,4,5,6,12');
t('parseSceneNums dedupes and sorts', W.parseSceneNums('5 3 5, 2-3').join(',') === '2,3,5');
t('parseSceneNums ignores junk', W.parseSceneNums('a, -2, 0, 7').join(',') === '7');

/* ── looks, pieces, costs ── */
const lk = W.newLook({ character: 'TOM', lookName: 'Work clothes', sceneNums: [2, 3, 3] });
t('newLook defaults + scene dedupe', lk.character === 'TOM' && lk.sceneNums.join(',') === '2,3' &&
  Array.isArray(lk.pieces) && Array.isArray(lk.photoIds) && lk.id.indexOf('lk') === 0);
lk.pieces.push(W.makePiece({ item: 'Chore coat', source: 'buy', cost: 120 }));
lk.pieces.push(W.makePiece({ item: 'Boots', source: 'rent', cost: 35.5 }));
lk.pieces.push(W.makePiece({ item: 'Own jeans', source: 'cast-own', cost: 0 }));
t('makePiece validates source', W.makePiece({ source: 'steal' }).source === 'buy');
t('lookCost sums pieces', W.lookCost(lk) === 155.5);
t('lookCost of empty look is 0', W.lookCost(W.newLook({})) === 0);

const lk2 = W.newLook({ character: 'MAGGIE', lookName: 'Apron dress', sceneNums: [1, 4] });
lk2.pieces.push(W.makePiece({ item: 'Dress', source: 'build', cost: 300 }));
const lk3 = W.newLook({ character: 'TOM', lookName: 'Sunday suit', sceneNums: [4] });
lk3.pieces.push(W.makePiece({ item: 'Suit', source: 'rent', cost: 80 }));
const looks = [lk, lk2, lk3];
const tot = W.totalsBySource(looks);
t('totalsBySource splits by source', tot.buy === 120 && tot.rent === 115.5 && tot.build === 300 && tot['cast-own'] === 0);
t('totalsBySource grand total', tot.total === 535.5);
const roll = W.rollupByCharacter(looks);
t('rollupByCharacter sums per character', roll.length === 2 &&
  roll[0].character === 'MAGGIE' && roll[0].cost === 300 &&
  roll[1].character === 'TOM' && roll[1].looks === 2 && roll[1].cost === 235.5);

/* ── change plot ── */
const plot = W.changePlot(looks, 4);
t('plot covers all scenes and characters', plot.sceneCount === 4 && plot.characters.join(',') === 'MAGGIE,TOM');
t('grid places looks in scenes', plot.grid[0].wearing.some(w => w.lookName === 'Apron dress') &&
  plot.grid[2].wearing.some(w => w.lookName === 'Work clothes'));
t('quick change: TOM sc3→4 different looks', plot.quickChanges.length === 1 &&
  plot.quickChanges[0].character === 'TOM' && plot.quickChanges[0].fromScene === 3 &&
  plot.quickChanges[0].toScene === 4 && plot.quickChanges[0].toLook === 'Sunday suit');
t('continuity span: MAGGIE look returns after a gap', plot.continuitySpans.length === 1 &&
  plot.continuitySpans[0].character === 'MAGGIE' && plot.continuitySpans[0].scenes.join(',') === '1,4' &&
  plot.continuitySpans[0].note === 'photograph it');
t('no conflicts in clean plot', plot.conflicts.length === 0);
const dup = W.newLook({ character: 'TOM', lookName: 'Rain slicker', sceneNums: [2] });
const plot2 = W.changePlot(looks.concat([dup]), 4);
t('conflict flagged when two looks share a scene', plot2.conflicts.length === 1 &&
  plot2.conflicts[0].character === 'TOM' && plot2.conflicts[0].scene === 2);
t('same look adjacent scenes is NOT a quick change', (function () {
  const a = W.newLook({ character: 'ANN', lookName: 'Coat', sceneNums: [1, 2] });
  return W.changePlot([a], 2).quickChanges.length === 0;
})());
t('plot extends sceneCount to highest worn scene', W.changePlot([W.newLook({ character: 'A', lookName: 'X', sceneNums: [9] })], 4).sceneCount === 9);
t('empty plot is safe', W.changePlot([], 0).grid.length === 0 && W.changePlot([], 0).quickChanges.length === 0);

/* ── hazards & multiples ── */
const hz = W.sceneHazards(SCRIPT);
t('scene 2 flags rain + mud, no water', hz[2] && hz[2].indexOf('rain') >= 0 && hz[2].indexOf('mud') >= 0 && hz[2].indexOf('water') < 0);
t('scene 3 flags blood + tear + fight', hz[3] && hz[3].indexOf('blood') >= 0 && hz[3].indexOf('tear') >= 0 && hz[3].indexOf('fight') >= 0);
t('scene 4 flags water ("dabs water")', hz[4] && hz[4].indexOf('water') >= 0);
t('clean scene 1 not flagged', hz[1] === undefined);
const adv = W.multiplesAdvice(lk, hz);            /* worn in hazard scenes 2 and 3 */
t('multiples: 2 hazard scenes → buy 4', adv.multiples === 4 && adv.scenes.join(',') === '2,3');
t('multiples note is labeled an estimate', /estimate/i.test(adv.note) && /buy 4 multiples/.test(adv.note));
const clean = W.newLook({ character: 'MAGGIE', lookName: 'House dress', sceneNums: [1] });
t('no hazards → 1, no note', W.multiplesAdvice(clean, hz).multiples === 1 && W.multiplesAdvice(clean, hz).note === '');
t('multiples cap at 6', W.multiplesAdvice({ sceneNums: [2, 3, 5, 6, 7, 8] },
  { 2: ['rain'], 3: ['blood'], 5: ['mud'], 6: ['water'], 7: ['fight'], 8: ['tear'] }).multiples === 6);

/* ── photo sizing ── */
t('fitWithin shrinks to max edge', (function () {
  const f = W.fitWithin(4000, 3000, 1024);
  return f.w === 1024 && f.h === 768;
})());
t('fitWithin never upscales', (function () {
  const f = W.fitWithin(640, 480, 1024);
  return f.w === 640 && f.h === 480 && f.scale === 1;
})());

console.log(`test_wardrobe: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
