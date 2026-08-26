#!/usr/bin/env node
/* Node tests for wardrobe/lib-ward.js (CWard) — run: node scripts/test_wardrobe.mjs
 *
 * The fixture is the one the previous version of this suite avoided: a
 * FADE IN: preamble, printed scene numbers, an A-scene (4A) that is the only
 * place one character's second look appears, an I/E slugline, and a shooting
 * order that is not the story order. Every one of those is an input class a
 * wardrobe department meets on a real revised script, and each of them used
 * to walk straight past this suite.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* the one scene model — lib-ward.js reads its scenes from here */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'js/lib-storyday.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'wardrobe/lib-ward.js'), 'utf8'));
const W = globalThis.CWard;
const CS = globalThis.CScenes;
const SD = globalThis.CStoryDay;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SCRIPT = `FADE IN:

1  INT. FARMHOUSE KITCHEN - NIGHT

MAGGIE
Supper's getting cold.

TOM (O.S.)
Be right down.

2  EXT. COUNTRY ROAD - DAY

Rain hammers the blacktop. Tom trudges through the mud.

TOM
This weather will be the death of me.

CUT TO:

3  INT. BARN - NIGHT

Tom and the stranger fight. Blood on the straw. His shirt is torn.

TOM (CONT'D)
Get off my land!

MAGGIE
Tom! Stop!

4  INT. FARMHOUSE KITCHEN - LATER

Maggie dabs water on the cut.

MAGGIE (V.O.)
He was never the same after that night.

4A  I/E. TRUCK CAB - NEXT DAY

Tom drives off in his Sunday suit.

TOM
Not one more word.`;

const SCENES = CS.parse(SCRIPT).scenes;

/* ── scenes & characters ── */
const scenes = W.splitScenes(SCRIPT);
t('splitScenes keeps the preamble at ord 0 and finds 5 scenes',
  scenes.length === 6 && scenes[0].ord === 0 && scenes[1].label === '1');
t('the A-scene is a scene of its own', SCENES.length === 5 && SCENES[4].label === '4A');
t('the I/E slugline reads as INT/EXT', CS.byNumber(SCENES, '4A').iu === 'INT/EXT');
const chars = W.charactersFromScript(SCRIPT);
t('two speaking characters found', chars.length === 2);
const byName = {};
chars.forEach(c => { byName[c.name] = c; });
t('TOM found with scene list', byName.TOM && byName.TOM.scenes.join(',') === '1,2,3,4');
t('MAGGIE spans scenes 1,3,4', byName.MAGGIE && byName.MAGGIE.scenes.join(',') === '1,3,4');
t('cue suffixes stripped (V.O./O.S./CONT\'D merge)', byName.TOM.lines === 4 && byName.MAGGIE.lines === 3);
t('CUT TO: is not a character', chars.every(c => c.name.indexOf('CUT') < 0));
t('cueName rejects sluglines', W.cueName('INT. BARN - NIGHT') === null);
t('cueName rejects lowercase', W.cueName('Tom walks in.') === null);
/* The legacy numeric scene list cannot tell 4 from 4A — it reports both as 4.
   That is precisely why the costume plot below keys on the printed identity. */
t('the numeric character scene list collapses 4A onto 4',
  byName.TOM.scenes.indexOf(4) >= 0 && byName.TOM.scenes.length === 4);
t('the printed key list does not — TOM speaks in 4A, not in 4',
  byName.TOM.sceneKeys.join(',') === '1,2,3,4A' && byName.MAGGIE.sceneKeys.join(',') === '1,3,4');

/* ── scene number parsing ── */
t('parseSceneNums expands ranges', W.parseSceneNums('1, 4-6, 12').join(',') === '1,4,5,6,12');
t('parseSceneNums dedupes and sorts', W.parseSceneNums('5 3 5, 2-3').join(',') === '2,3,5');
t('parseSceneNums ignores junk', W.parseSceneNums('a, -2, 0, 7').join(',') === '7');
t('the legacy numeric parse DROPS A-scenes', W.parseSceneNums('4, 4A, 7').join(',') === '4,7');
t('parseSceneKeys keeps A-scenes and returns printed identities',
  W.parseSceneKeys('4, 4A, 7-9').join(',') === '4,4A,7,8,9');
t('a typed scene number resolves through the one normNum every module uses',
  CS.normNum(' sc 4a ') === '4A' && W.parseSceneKeys('sc 4a').join(',') === '4A');
t('uniqScenes dedupes, sorts and drops the impossible',
  W.uniqScenes([3, 1, 3, 0, -2, '2']).join(',') === '1,2,3');

/* ── looks, pieces, costs ── */
const lk = W.newLook({ character: 'TOM', lookName: 'Work clothes', sceneNums: [2, 3, 3] });
t('newLook defaults + scene dedupe', lk.character === 'TOM' && lk.sceneNums.join(',') === '2,3' &&
  Array.isArray(lk.pieces) && Array.isArray(lk.photoIds) && lk.id.indexOf('lk') === 0);
t('newLook mirrors scenes into printed keys', lk.sceneKeys.join(',') === '2,3');
t('newLook accepts printed keys directly', (function () {
  const a = W.newLook({ character: 'TOM', lookName: 'Suit', sceneKeys: ['4A', '4a', '5'] });
  return a.sceneKeys.join(',') === '4A,5' && a.sceneNums.join(',') === '4,5';
})());
t('lookSceneKeys falls back to the legacy numbers on an old record',
  W.lookSceneKeys({ sceneNums: [3, 1] }).join(',') === '1,3');
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

/* ── change plot (the legacy numeric grid) ── */
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

/* ── story days + the costume plot ─────────────────────────────────────────
   Story order: 1 and 2 are one night into the next day; 3 is that night;
   4 is LATER the same night; 4A says NEXT DAY on the heading.            */
const story = SD.derive(SCRIPT);
t('story days come out of the script, not out of scene order',
  SD.dayOf(story, '1') === 1 && SD.dayOf(story, '2') === 2 && SD.dayOf(story, '4A') === 3);
t('scene 4 rides on the same story day as scene 3',
  SD.dayOf(story, '4') === SD.dayOf(story, '3'));

/* A shooting order that is emphatically not the story order: the A-scene is
   shot first, the kitchen work is split across two days and scene 2 is last. */
const BOARD = { scenes: [
  { id: 'sc5', num: 5, heading: '4A  I/E. TRUCK CAB - NEXT DAY', eighths: 4, day: 0 },
  { id: 'sc1', num: 1, heading: '1  INT. FARMHOUSE KITCHEN - NIGHT', eighths: 8, day: 0 },
  { id: 'sc4', num: 4, heading: '4  INT. FARMHOUSE KITCHEN - LATER', eighths: 5, day: 1 },
  { id: 'sc3', num: 3, heading: '3  INT. BARN - NIGHT', eighths: 12, day: 1 },
  { id: 'sc2', num: 2, heading: '2  EXT. COUNTRY ROAD - DAY', eighths: 6, day: 2 },
  { id: 'scX', num: 9, heading: 'INT. A SCENE NOBODY WROTE - DAY', eighths: 2, day: -1 }
] };
const so = W.shootOrderFromBoard(BOARD, SCENES);
t('the board joins onto printed scene identities',
  so.order.map(s => s.key).join(',') === '4A,1,4,3,2');
t('shooting positions run 1..n in board order', so.order.map(s => s.pos).join(',') === '1,2,3,4,5');
t('a strip that matches no scene is reported, not silently dropped',
  so.unmatched.length === 1 && /NOBODY WROTE/.test(so.unmatched[0]));
t('a boneyard strip gets no shooting position',
  so.order.every(s => s.shootDay >= 0));

/* Looks keyed on printed identities, including the A-scene. */
const L = [
  W.newLook({ character: 'MAGGIE', lookName: 'Apron dress', sceneKeys: ['1', '4'] }),
  W.newLook({ character: 'TOM', lookName: 'Work clothes', sceneKeys: ['1', '2', '3'] }),
  W.newLook({ character: 'TOM', lookName: 'Sunday suit', sceneKeys: ['4A'] })
];
const cp = W.costumePlot({ looks: L, scenes: SCENES, story: story, shootOrder: so.order });
t('costume plot names its characters', cp.characters.join(',') === 'MAGGIE,TOM');
t('the plot is grouped by story day, in story order',
  cp.days.map(d => d.day).join(',') === '1,2,3');
t('day 1 holds scene 1, day 2 holds 2,3,4 and day 3 holds the A-scene',
  cp.days[0].scenes.map(s => s.key).join(',') === '1' &&
  cp.days[1].scenes.map(s => s.key).join(',') === '2,3,4' &&
  cp.days[2].scenes.map(s => s.key).join(',') === '4A');
t('change numbers are assigned per character in story order', (function () {
  const tom = cp.changes.filter(c => c.character === 'TOM');
  return tom.length === 2 && tom[0].lookName === 'Work clothes' && tom[0].changeNo === 1 &&
    tom[1].lookName === 'Sunday suit' && tom[1].changeNo === 2;
})());
t('a change carries the story days and shooting days it spans', (function () {
  const c = cp.changes.filter(x => x.lookName === 'Work clothes')[0];
  return c.days.join(',') === '1,2' && c.shootDays.join(',') === '0,1,2' && c.mustMatch === true;
})());
t('a change shot out of story order says so', (function () {
  const c = cp.changes.filter(x => x.lookName === 'Work clothes')[0];
  return c.outOfOrder === true && /shot over 3 shooting days/.test(c.note);
})());
t('a single-scene change needs no match', (function () {
  const c = cp.changes.filter(x => x.lookName === 'Sunday suit')[0];
  return c.mustMatch === false && c.shootDays.join(',') === '0';
})());
t('the grid carries the shooting position on every scene row',
  cp.days[0].scenes[0].shootPos === 2 && cp.days[2].scenes[0].shootPos === 1);
t('cells carry the change number a supervisor calls out', (function () {
  const row = cp.days[1].scenes.filter(s => s.key === '3')[0];
  const tom = row.cells.filter(c => c.character === 'TOM')[0];
  return tom.worn.length === 1 && tom.worn[0].changeNo === 1;
})());
t('a quick change is measured inside the story day', (function () {
  const q = cp.quickChanges.filter(x => x.character === 'MAGGIE');
  return cp.quickChanges.length === 0 && q.length === 0;
})());
t('MAGGIE keeps one change across two story-day scenes', (function () {
  const m = cp.changes.filter(c => c.character === 'MAGGIE');
  return m.length === 1 && m[0].scenes.join(',') === '1,4' && m[0].days.join(',') === '1,2';
})());
t('the same plot is also available in shooting order',
  cp.shootOrdered.map(r => r.key).join(',') === '4A,1,4,3,2' &&
  cp.shootOrdered[0].day === 3);
t('a look pinned to a scene the script does not have is reported', (function () {
  const p = W.costumePlot({ looks: L.concat([W.newLook({ character: 'TOM', lookName: 'Ghost', sceneKeys: ['77'] })]),
                            scenes: SCENES, story: story, shootOrder: so.order });
  return p.unplaced.length === 1 && p.unplaced[0].scene === '77';
})());
t('two looks in one scene is still a conflict', (function () {
  const p = W.costumePlot({ looks: L.concat([W.newLook({ character: 'TOM', lookName: 'Slicker', sceneKeys: ['2'] })]),
                            scenes: SCENES, story: story });
  return p.conflicts.length === 1 && p.conflicts[0].scene === '2' && p.conflicts[0].character === 'TOM';
})());
t('without story days the plot says so rather than inventing day 1', (function () {
  const p = W.costumePlot({ looks: L, scenes: SCENES });
  return p.storyDerived === false && p.days.length === 1 && p.days[0].day === 0 &&
    p.uncertainScenes.length === SCENES.length &&
    p.changes.every(c => c.dayUncertain === true);
})());
t('an uncertain story day is carried onto the change', (function () {
  const s2 = SD.derive(SCRIPT);
  const p = W.costumePlot({ looks: L, scenes: SCENES, story: s2 });
  const c = p.changes.filter(x => x.lookName === 'Work clothes')[0];
  return s2.uncertain.length > 0 && c.dayUncertain === (s2.uncertain.indexOf('2') >= 0 ||
    s2.uncertain.indexOf('3') >= 0 || s2.uncertain.indexOf('1') >= 0);
})());
t('an empty costume plot is safe', (function () {
  const p = W.costumePlot({});
  return p.characters.length === 0 && p.days.length === 0 && p.changes.length === 0;
})());

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
/* The numeric hazard map cannot separate 4 from 4A; the keyed one can. */
const hzk = W.sceneHazardsByKey(SCRIPT);
t('hazards by printed key keep 4 and 4A apart',
  hzk['4'] && hzk['4'].indexOf('water') >= 0 && hzk['4A'] === undefined);
t('multiplesFor works off printed keys', (function () {
  const a = W.multiplesFor(L[1], hzk);            /* TOM work clothes: 1,2,3 */
  return a.multiples === 4 && a.scenes.join(',') === '2,3';
})());
t('multiplesFor on a clean look is 1', W.multiplesFor(L[2], hzk).multiples === 1);

/* ── continuity photos: project namespacing and orphans ──────────────────
   The bytes live in IndexedDB and the vault snapshots localStorage only, so
   these are the numbers the page reports rather than a fix for that.      */
t('projectSlug is stable and safe as a key prefix',
  W.projectSlug('The Long Night (2026)') === 'the-long-night-2026' && W.projectSlug('') === 'project-1');
const recA = W.photoRecord({ project: 'The Long Night', lookId: L[0].id, dataUrl: 'data:image/jpeg;base64,AAA', date: '2026-08-20' });
t('a photo record is stamped with its project and prefixed id',
  recA.project === 'The Long Night' && recA.id.indexOf('the-long-night:ph') === 0 && recA.bytes === 26);
const recB = W.photoRecord({ project: 'Second Film', lookId: 'lkOther', dataUrl: 'data:image/jpeg;base64,BBBB' });
const recOrphan = W.photoRecord({ project: 'The Long Night', lookId: 'lkGone', dataUrl: 'data:image/jpeg;base64,CC' });
const recLegacy = { id: 'ph-legacy-1', lookId: L[0].id, dataUrl: 'data:image/jpeg;base64,DD', date: '' };

const wardrobeA = { looks: [{ id: L[0].id, character: 'MAGGIE', lookName: 'Apron dress', photoIds: [recA.id, 'ph-missing-9'] }] };
const wardrobeB = { looks: [{ id: 'lkOther', character: 'ANN', lookName: 'Coat', photoIds: [recB.id] }] };
const refs = W.referencedPhotoIds({ 'The Long Night': wardrobeA, 'Second Film': JSON.stringify(wardrobeB) });
t('references are read from every project the vault holds, JSON or object',
  refs['The Long Night'].length === 2 && refs['Second Film'].join(',') === recB.id);
const scan = W.orphanScan([recA, recB, recOrphan, recLegacy], refs, 'The Long Night');
t('this project\'s photos are separated from the other project\'s',
  scan.mine.length === 1 && scan.mine[0].id === recA.id &&
  scan.foreign.length === 1 && scan.foreign[0].id === recB.id);
t('a photo no project references is an orphan, with its bytes counted',
  scan.orphans.length === 2 && scan.orphanBytes > 0 &&
  scan.orphans.some(r => r.id === recOrphan.id) && scan.orphans.some(r => r.id === recLegacy.id));
t('a reference with no bytes on this device is reported as missing',
  scan.missing.join(',') === 'ph-missing-9');
t('an unstamped legacy record is listed as legacy', scan.legacy.length === 1 &&
  scan.legacy[0].id === recLegacy.id);
t('the scan totals every record it was given',
  scan.total === 4 && scan.bytes === 26 + 27 + 25 + 25 && scan.projects.join(',') === 'Second Film,The Long Night');

/* ── the portable pack (the bytes the vault cannot carry) ── */
const pack = W.photoPack('The Long Night', wardrobeA.looks, [recA, recOrphan], '2026-08-26');
t('a pack carries only the photos its looks still reference',
  pack.photos.length === 1 && pack.photos[0].id === recA.id && pack.format === W.PACK_FORMAT);
t('a pack is deterministic — the timestamp comes from the caller',
  pack.savedAt === '2026-08-26' && pack.project === 'The Long Night' && pack.looks.length === 1);
t('a pack round-trips through JSON', (function () {
  const back = W.readPhotoPack(JSON.stringify(pack));
  return back.photos.length === 1 && back.project === 'The Long Night' && back.dropped === 0;
})());
t('readPhotoPack refuses anything that is not a pack', (function () {
  let threw = 0;
  try { W.readPhotoPack('{"format":"nope"}'); } catch (e) { threw++; }
  try { W.readPhotoPack('not json at all'); } catch (e) { threw++; }
  try { W.readPhotoPack({ format: W.PACK_FORMAT, photos: [] }); } catch (e) { threw++; }
  return threw === 3;
})());
t('readPhotoPack drops a photo whose dataUrl is not an image', (function () {
  let threw = false;
  try {
    W.readPhotoPack({ format: W.PACK_FORMAT, project: 'x', photos: [
      { id: 'a', dataUrl: 'javascript:alert(1)' }, { id: 'b', dataUrl: 'data:image/png;base64,AA' }] });
  } catch (e) { threw = true; }
  const ok = W.readPhotoPack({ format: W.PACK_FORMAT, project: 'x', photos: [
    { id: 'a', dataUrl: 'javascript:alert(1)' }, { id: 'b', dataUrl: 'data:image/png;base64,AA' }] });
  return !threw && ok.photos.length === 1 && ok.photos[0].id === 'b' && ok.dropped === 1;
})());

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
