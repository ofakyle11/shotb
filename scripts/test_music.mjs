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

/* ── the PRO cue sheet ──
   A performing-rights society pays from this document. It cannot pay from one
   `composer` and one `publisher` text field: it needs each writer and each
   publisher named with a SHARE totalling 100% per side, a PRO affiliation, a
   use code, a timing and a DURATION. */
const PRO_CUE = M.makeCue({
  title: 'Midnight Freight', artist: 'The Spur Line', status: 'licensed', use: 'featured',
  tcIn: '00:04:12:00', tcOut: '00:05:44:12', iswc: 'T-070.240.101-2', isrc: 'USRC17607839',
  recordLabel: 'Spur Line Recordings',
  writers: [{ name: 'R. Hart', role: 'C', pro: 'ASCAP', ipi: '00123456789', share: 50 },
            { name: 'J. Vane', role: 'A', pro: 'BMI', share: 50 }],
  publishers: [{ name: 'Loam Songs', pro: 'ASCAP', share: 100 }]
});
t('cue carries writers, publishers, ISWC, ISRC and timings',
  PRO_CUE.writers.length === 2 && PRO_CUE.publishers.length === 1 &&
  PRO_CUE.iswc === 'T-070.240.101-2' && PRO_CUE.isrc === 'USRC17607839');
t('a bogus writer role falls back to composer', M.normWriter({ name: 'X', role: 'ZZ' }).role === 'C');
t('shares are numbers, never strings, and never negative',
  M.normPublisher({ share: '33.333' }).share === 33.33 && M.normWriter({ share: -5 }).share === 0);
t('shareTotals reads both sides', (() => {
  const s = M.shareTotals(PRO_CUE);
  return s.writers === 100 && s.publishers === 100 && s.ok === true;
})());
t('shares that do not total 100 are not ok', !M.shareTotals(M.makeCue({
  writers: [{ name: 'A', pro: 'BMI', share: 60 }], publishers: [{ name: 'P', pro: 'BMI', share: 100 }] })).ok);
t('timings parse and format', M.timingSec('00:04:12:00') === 252 && M.timingSec('4:12') === 252 &&
  M.timingSec('') === 0 && M.timingTc(252, 24) === '00:04:12:00');
t('duration comes from the timings when not entered', M.cueDuration(PRO_CUE) === 92.5 &&
  M.cueDuration(M.makeCue({ durSec: 30 })) === 30 && M.cueDuration(M.makeCue({})) === 0);
t('mmss reads like a cue sheet', M.mmss(92.5) === '1:33' && M.mmss(5) === '0:05');
t('use codes follow the use, and can be overridden',
  M.useCodeFor(M.makeCue({ use: 'main title' })) === 'MT' &&
  M.useCodeFor(M.makeCue({ use: 'end credits' })) === 'ET' &&
  M.useCodeFor(M.makeCue({ use: 'background' })) === 'BI' &&
  M.useCodeFor(PRO_CUE) === 'VV' &&
  M.useCodeFor(M.makeCue({ use: 'background', useCode: 'LOGO' })) === 'LOGO' &&
  M.USE_CODE_IDS.length === M.USE_CODES.length && M.PROS.indexOf('SOCAN') >= 0 &&
  M.WRITER_ROLES.indexOf('CA') >= 0);

/* the pre-submission read */
t('a complete cue has no issues', M.cueSheetIssues([PRO_CUE]).length === 0);
const issues = M.cueSheetIssues([M.makeCue({ title: 'Bar Band', status: 'licensed' })]);
const fields = issues.map(i => i.field);
t('a bare cue is reported field by field', fields.indexOf('timing') >= 0 &&
  fields.indexOf('writers') >= 0 && fields.indexOf('publishers') >= 0 && fields.indexOf('iswc') >= 0);
t('a share that does not total 100 is named', M.cueSheetIssues([M.makeCue({
  title: 'X', status: 'licensed', durSec: 60, iswc: 'T-1',
  writers: [{ name: 'A', pro: 'BMI', share: 60 }],
  publishers: [{ name: 'P', pro: 'BMI', share: 100 }] })])
  .some(i => /total 60%/.test(i.msg)));
t('a writer with no PRO is named — the society cannot route the royalty',
  M.cueSheetIssues([M.makeCue({ title: 'X', status: 'licensed', durSec: 60, iswc: 'T-1',
    writers: [{ name: 'A', share: 100 }], publishers: [{ name: 'P', pro: 'BMI', share: 100 }] })])
    .some(i => /no PRO affiliation/.test(i.msg)));
t('an unlicensed cue is flagged for a delivered sheet, unless the caller waives it',
  M.cueSheetIssues([Object.assign({}, PRO_CUE, { status: 'quoted' })]).some(i => i.field === 'status') &&
  M.cueSheetIssues([Object.assign({}, PRO_CUE, { status: 'quoted' })], { requireLicensed: false })
    .every(i => i.field !== 'status'));
t('issues carry the cue back so a UI can point at it',
  M.cueSheetIssues([M.makeCue({ title: 'Bar Band', status: 'licensed' })])[0].cueId !== undefined);

/* rows + CSV */
const rows = M.cueSheetRows([PRO_CUE, M.makeCue({ title: 'Cut', status: 'replaced' })]);
t('rows exclude replaced cues and number from 1', rows.length === 1 && rows[0].seq === 1);
t('row carries the PRO columns', rows[0].useCode === 'VV' && rows[0].durSec === 92.5 &&
  rows[0].duration === '1:33' && rows[0].iswc === 'T-070.240.101-2' && rows[0].writers.length === 2);
const csv = M.cueSheetCsv([PRO_CUE]);
const csvLines = csv.split('\n');
t('csv header names the PRO columns', /ISWC/.test(csvLines[0]) && /Share %/.test(csvLines[0]) &&
  /IPI/.test(csvLines[0]) && /ISRC/.test(csvLines[0]));
t('csv writes one line per writer and publisher share', csvLines.length === 4 &&
  /"C","R\. Hart","ASCAP"/.test(csvLines[1]) && /"A","J\. Vane","BMI"/.test(csvLines[2]) &&
  /"P","Loam Songs","ASCAP"/.test(csvLines[3]));
t('csv repeats the cue columns only on its first line',
  /^"1","Midnight Freight","VV"/.test(csvLines[1]) && /^"","",""/.test(csvLines[2]));
t('csv neutralises a formula cell', (() => {
  const line = M.cueSheetCsv([M.makeCue({ title: '=cmd|calc', status: 'licensed', durSec: 10,
    writers: [{ name: '+A', pro: 'BMI', share: 100 }], publishers: [{ name: 'P', pro: 'BMI', share: 100 }] })]);
  return /"'=cmd\|calc"/.test(line) && /"'\+A"/.test(line);
})());
t('a cue with no parties still emits its row', M.cueSheetCsv([M.makeCue({ title: 'Orphan' })]).split('\n').length === 2);

/* the readable sheet */
const sheet = M.cueSheet([PRO_CUE].concat(cues), { production: 'Night Harvest', date: '2026-08-23' });
t('sheet has the PRO header columns', /SEQ/.test(sheet) && /ISWC/.test(sheet) && /WRITERS \/ PUBLISHERS/.test(sheet));
t('sheet excludes replaced cues', /3 cues/.test(sheet));
t('sheet prints shares and affiliations', /R\. Hart \(C\) · ASCAP 50%/.test(sheet) && /Loam Songs · ASCAP 100%/.test(sheet));
t('sheet refuses to look ready when it is not', /NOT READY TO SUBMIT/.test(sheet));
t('a complete sheet says so', /Every cue carries a duration/.test(M.cueSheet([PRO_CUE], { production: 'X' })));
t('sheet explains the use codes', /BI=Background instrumental/.test(sheet));

/* seeding: the cut, and the old office register */
const fromCut = M.cuesFromCut({ project: { fps: 24, audio: [
  { label: 'Main Title', start: 0, in: 0, out: 90 },
  { label: 'Bar Source', start: 300, in: 10, out: 40 }] } });
t('cuesFromCut reads the Editor audio track with real timings', fromCut.length === 2 &&
  fromCut[0].tcIn === '00:00:00:00' && fromCut[0].tcOut === '00:01:30:00' && fromCut[0].durSec === 90);
t('cuesFromCut keeps the duration instead of throwing it away',
  fromCut[1].durSec === 30 && fromCut[1].tcIn === '00:05:00:00' && M.cueDuration(fromCut[1]) === 30);
t('cuesFromCut is safe on an empty cut', M.cuesFromCut(null).length === 0 && M.cuesFromCut({}).length === 0);
const imported = M.importCueRows([{ title: 'Old Cue', tcIn: '00:01:00:00', tcOut: '00:01:30:00',
  use: 'BI', composer: 'A. Composer', publisher: 'Old Publishing', society: 'SOCAN' }]);
t('the office register imports without losing a name', imported.length === 1 &&
  imported[0].writers[0].name === 'A. Composer' && imported[0].publishers[0].name === 'Old Publishing' &&
  imported[0].publishers[0].pro === 'SOCAN' && imported[0].useCode === 'BI');
t('an imported cue is honest that its shares are missing',
  M.cueSheetIssues(imported).some(i => /total 0%/.test(i.msg)));
t('sharesText reads back what a human typed', /A\. Composer \(C\) 0%/.test(M.sharesText(imported[0].writers)));

console.log(`test_music: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
