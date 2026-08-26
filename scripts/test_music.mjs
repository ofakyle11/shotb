#!/usr/bin/env node
/* Node tests for music/lib-music.js (CMusic) — run: node scripts/test_music.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* the one scene model — lib-music.js reads its scenes from here */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'music/lib-music.js'), 'utf8'));
const M = globalThis.CMusic;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SCRIPT = `INT. ROADHOUSE BAR - NIGHT
A jukebox glows in the corner. "Midnight Freight" plays over the crowd.
Della carries a tray of empties past the pool table.

EXT. HIGHWAY - DAWN
Tom drives. The radio plays something twangy and half-lost to static.
He hums along, off-key.

INT. ROADHOUSE BAR - LATER
The house band plays a slow number. Della steps up to the mic and sings.

INT. MOTEL ROOM - NIGHT
Tom stares at the ceiling. Silence. A neon sign buzzes outside.`;

/* ── scan ── */
const scenes = M.splitScenes(SCRIPT);
t('splitScenes finds 4 scenes', scenes.length === 4);
const hits = M.scanScript(SCRIPT);
t('scan finds the music moments', hits.length >= 4);
t('silent scene stays silent', hits.every(h => h.scene !== 4));
const juke = hits.filter(h => h.scene === 1)[0];
t('jukebox line hit in scene 1', !!juke && /jukebox/i.test(juke.excerpt));
t('jukebox suggests background', juke.suggestedUse === 'background');
t('quoted title extracted', hits.some(h => h.title === 'Midnight Freight'));
const radio = hits.filter(h => h.scene === 2 && /radio/i.test(h.excerpt))[0];
t('radio plays → background', !!radio && radio.suggestedUse === 'background');
t('hums caught in scene 2', hits.some(h => h.scene === 2 && /hums/i.test(h.excerpt)));
const band = hits.filter(h => h.scene === 3)[0];
t('band plays / sings → featured', !!band && band.suggestedUse === 'featured');
t('scan of empty script is empty', M.scanScript('').length === 0);

/* ── cues ── */
const c = M.makeCue({});
t('makeCue defaults', c.use === 'background' && c.tier === 'indie' &&
  c.scope === 'all-media' && c.status === 'identified' && c.actualQuote === 0 && c.committedPo === false);
const fromHit = M.cueFromHit(juke);
t('cueFromHit carries scene + suggested use + title', fromHit.scene === 1 &&
  fromHit.use === 'background' && fromHit.title === 'Midnight Freight');
t('makeCue rejects bogus enums', M.makeCue({ use: 'x', tier: 'y', scope: 'z', status: 'w' }).tier === 'indie');

/* ── status flow ── */
t('setStatus valid', M.setStatus(c, 'quoted') && c.status === 'quoted');
t('setStatus invalid → null, unchanged', M.setStatus(c, 'nope') === null && c.status === 'quoted');
t('nextStatus walks the flow', M.nextStatus('identified') === 'quote requested' &&
  M.nextStatus('quote requested') === 'quoted' && M.nextStatus('quoted') === 'licensed');
t('licensed and replaced are terminal', M.nextStatus('licensed') === null && M.nextStatus('replaced') === null);

/* ── estimates ──
   indie 500–5000: mid 2750 · background (500+2750)/2 = 1625 per side
   featured (2750+5000)/2 = 3875 · main title 1.5×2750 = 4125            */
const bg = M.estimate(M.makeCue({ tier: 'indie', use: 'background', scope: 'all-media' }));
t('indie background per-side math', bg.sync === 1625 && bg.master === 1625 && bg.total === 3250);
const feat = M.estimate(M.makeCue({ tier: 'indie', use: 'featured', scope: 'all-media' }));
t('featured prices top half of range', feat.sync === 3875 && feat.total === 7750);
const mt = M.estimate(M.makeCue({ tier: 'indie', use: 'main title', scope: 'all-media' }));
t('main title = 1.5 × midpoint per side', mt.sync === 4125);
t('end credits same multiplier', M.estimate(M.makeCue({ tier: 'indie', use: 'end credits' })).sync === 4125);
const lib = M.estimate(M.makeCue({ tier: 'library', use: 'background' }));
t('library is one all-in fee', lib.master === 0 && lib.total === lib.sync &&
  lib.sync >= 50 && lib.sync <= 500);
const fest = M.estimate(M.makeCue({ tier: 'indie', use: 'background', scope: 'festival' }));
t('festival scope ≈ 15% per side', fest.sync === Math.round(1625 * 0.15) && fest.total === 2 * fest.sync);
t('festival note mentions step-up option', /step-up/.test(fest.note));
t('notes are labeled planning estimates + verify', /[Pp]lanning estimate/.test(bg.note) && /verify/i.test(bg.note));
const fam = M.estimate(M.makeCue({ tier: 'famous', use: 'background' }));
t('famous tier scales', fam.sync === Math.round((25000 + 137500) / 2) && fam.total === 2 * fam.sync);

/* ── totals + cueCost ── */
const cues = [
  M.makeCue({ tier: 'indie', use: 'background' }),                                   // est 3250
  M.makeCue({ tier: 'indie', use: 'background', actualQuote: 2000, status: 'licensed' }),
  M.makeCue({ tier: 'famous', use: 'featured', status: 'replaced', actualQuote: 99999 })
];
t('cueCost prefers actual quote', M.cueCost(cues[1]) === 2000 && M.cueCost(cues[0]) === 3250);
t('replaced cue costs nothing', M.cueCost(cues[2]) === 0);
const tot = M.totals(cues);
t('totals exclude replaced', tot.count === 2 && tot.est === 6500);
t('working blends quotes and estimates', tot.working === 3250 + 2000);
t('licensed total counts committed quotes', tot.licensed === 2000 && tot.quoted === 2000);
t('byStatus tallies everything', tot.byStatus.replaced === 1 && tot.byStatus.licensed === 1);

/* ── score comparison ── */
const sc = M.scoreComparison(30);
t('score range $100–$400/min', sc.low === 3000 && sc.high === 12000);
t('score note is honest about estimates', /[Pp]lanning estimate/.test(sc.note) && /verify/i.test(sc.note));
t('score handles junk input', M.scoreComparison('x').low === 0 && M.scoreComparison(-5).high === 0);

/* ── letter ── */
const letter = M.licenseRequest({ production: 'Night Harvest', company: 'Loam Films',
  contact: 'K. Francis', cue: M.makeCue({ title: 'Midnight Freight', artist: 'The Spur Line',
    use: 'featured', tier: 'indie', scope: 'festival', scene: 1 }) });
t('letter carries production + song + artist', /Night Harvest/.test(letter) &&
  /Midnight Freight/.test(letter) && /The Spur Line/.test(letter));
t('letter asks for sync + master', /synchronization/i.test(letter) && /master use/i.test(letter));
t('festival letter asks for step-up', /step-up option/.test(letter) && /festival/i.test(letter));
t('all-media letter states full scope', /all media, worldwide, in perpetuity/i.test(
  M.licenseRequest({ cue: M.makeCue({ scope: 'all-media' }) })));

/* ── cue sheet ── */
const sheet = M.cueSheet(cues.concat([M.makeCue({ title: 'Midnight Freight', artist: 'The Spur Line', use: 'featured' })]),
  { production: 'Night Harvest', date: '2026-08-23' });
t('sheet has header columns', /SEQ/.test(sheet) && /PUBLISHER/.test(sheet) && /MASTER OWNER/.test(sheet));
t('sheet excludes replaced cues', /3 cues/.test(sheet));
t('sheet has timing placeholders', /__:__/.test(sheet));
t('sheet carries titles + placeholder owners', /Midnight Freight/.test(sheet) && /\[publisher\]/.test(sheet));
t('sheet warns to verify before delivery', /verify/i.test(sheet));

console.log(`test_music: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
