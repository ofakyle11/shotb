#!/usr/bin/env node
/* Node tests for dailies/lib-dailies.js (CDailies) — run: node scripts/test_dailies.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* the one scene model — lib-dailies.js reads its scenes from here */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'dailies/lib-dailies.js'), 'utf8'));
const D = globalThis.CDailies;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SCRIPT = `INT. FARMHOUSE KITCHEN - NIGHT
Maggie sets the table.

EXT. COUNTRY ROAD - DAY
A rusted truck rattles past.

INT. STUDY - NIGHT
Tom loads the shotgun.

12 EXT. RIVER BANK - DUSK
The current takes the letter away.`;

/* ── scenes ── */
const scenes = D.sceneList(SCRIPT);
t('sceneList finds 4 sluglined scenes', scenes.length === 4);
/* The script prints "12" on the last slugline, so that scene IS 12 — the
   retired sceneList renumbered it 4 by position, which is why a take slated
   12A could never be matched back to the scene it covers. Unnumbered
   sluglines still fall back to their position. */
t('unnumbered scenes number by position', scenes[0].n === 1 && scenes[2].n === 3);
t('a printed scene number wins over the position', scenes[3].n === 12 && scenes[3].number === '12');
t('numbered slugline recognised', /RIVER BANK/.test(scenes[3].slug));
t('splitScenes ignores blank input', D.splitScenes('').length === 0);

/* ── slate arithmetic ── */
t('lettersToNum A=1 Z=26 AA=27', D.lettersToNum('A') === 1 && D.lettersToNum('Z') === 26 && D.lettersToNum('AA') === 27);
t('numToLetters round-trips', D.numToLetters(28) === 'AB' && D.numToLetters(D.lettersToNum('BC')) === 'BC');
t('parseSlate splits scene+letters', (() => { const p = D.parseSlate('12b'); return p.scene === 12 && p.letters === 'B' && p.ord === 2; })());
t('parseSlate tolerates junk', D.parseSlate('??').scene === 0 && D.parseSlate('').ord === 0);

/* ── nextSlate / nextSetup ── */
t('new scene → sceneA take 1', (() => { const n = D.nextSlate([], '7'); return n.slate === '7A' && n.take === 1 && n.fresh; })());
const takes = [];
takes.push(D.makeTake({ day: '2026-08-23', scene: '7', slate: '7A', take: 1, camera: 'a', lens: '32mm', soundRoll: 'SR01', tcIn: '10:01:00:00' }, 'k1'));
t('same scene → same slate, take+1', (() => { const n = D.nextSlate(takes, '7'); return n.slate === '7A' && n.take === 2 && !n.fresh; })());
takes.push(D.makeTake({ day: '2026-08-23', scene: '7', slate: '7A', take: 2, camera: 'B', circled: true, notes: 'the keeper' }, 'k2'));
t('nextSetup bumps letter 7A→7B', (() => { const n = D.nextSetup(takes, '7'); return n.slate === '7B' && n.take === 1; })());
t('nextSetup rolls Z→AA', D.nextSetup([D.makeTake({ scene: '3', slate: '3Z', take: 4 })], '3').slate === '3AA');
t('nextSetup on unshot scene → A', D.nextSetup(takes, '99').slate === '99A');

/* ── makeTake normalisation ── */
const mt = D.makeTake({ scene: ' 5 ', slate: '5a', take: '0', camera: 'x', notes: '  hi ' }, 'id9');
t('makeTake uppercases slate, floors take at 1', mt.slate === '5A' && mt.take === 1);
t('makeTake defaults bad camera to A', mt.camera === 'A' && D.makeTake({ camera: 'b' }).camera === 'B');
t('makeTake trims strings and keeps id', mt.notes === 'hi' && mt.id === 'id9' && mt.circled === false);

/* ── sortTakes ── */
takes.push(D.makeTake({ day: '2026-08-22', scene: '2', slate: '2A', take: 1, camera: 'A', circled: true, notes: 'walk-by' }, 'k0'));
takes.push(D.makeTake({ day: '2026-08-23', scene: '7', slate: '7B', take: 1, camera: 'A' }, 'k3'));
const sorted = D.sortTakes(takes);
t('sortTakes orders day, scene, slate, take', sorted[0].id === 'k0' && sorted[1].id === 'k1' && sorted[3].id === 'k3');
t('sortTakes does not mutate input', takes[0].id === 'k1');

/* ── circleRate ── */
const cr = D.circleRate(takes);
t('circleRate overall counts', cr.overall.total === 4 && cr.overall.circled === 2 && cr.overall.pct === 50);
t('circleRate splits per day', cr.byDay.length === 2 && cr.byDay[0].day === '2026-08-22' && cr.byDay[0].pct === 100);
t('circleRate day totals', cr.byDay[1].total === 3 && cr.byDay[1].circled === 1);
t('circleRate empty log → zero, no NaN', (() => { const z = D.circleRate([]); return z.overall.total === 0 && z.overall.pct === 0 && z.byDay.length === 0; })());

/* ── coverage ── */
const cov = D.coverageByScene([D.makeTake({ scene: '1', slate: '1A', take: 1 }), D.makeTake({ scene: '3', slate: '3A', take: 1, circled: true })], SCRIPT);
t('coverage counts per scene', cov.total === 4 && cov.covered === 2);
t('coverage lists exact gaps', cov.gaps.map(g => g.n).join(',') === '2,12');
t('coverage carries circled count', cov.scenes[2].circled === 1 && cov.scenes[0].circled === 0);
t('coverage falls back to slate scene number', D.coverageByScene([D.makeTake({ scene: '', slate: '2A', take: 1 })], SCRIPT).gaps.map(g => g.n).join(',') === '1,3,12');
t('coverage with no script → no scenes', D.coverageByScene(takes, '').total === 0);

/* ── camera report ── */
const cam = D.cameraReport(takes, '2026-08-23', { unit: 'MAIN', production: 'Night Harvest' });
t('camera report headed with day+unit+production', /CAMERA REPORT — 2026-08-23/.test(cam) && /MAIN unit/.test(cam) && /Night Harvest/.test(cam));
t('camera report has column header', /SCENE/.test(cam) && /LENS/.test(cam) && /TC IN/.test(cam));
t('camera report marks circled with ●', /● the keeper/.test(cam));
t('camera report excludes other days', cam.indexOf('walk-by') < 0);
t('camera report carries lens and tc', /32mm/.test(cam) && /10:01:00:00/.test(cam));
t('camera report tallies circles', /Takes: 3\s+Circled: 1 \(33%\)/.test(cam));
t('camera report carries verify note', /cross-check/.test(cam));
t('camera report empty day says so', /no takes logged/.test(D.cameraReport(takes, '1999-01-01')));

/* ── sound report ── */
const snd = D.soundReport(takes, '2026-08-23', { unit: 'MAIN' });
t('sound report headed and has ROLL column', /SOUND REPORT — 2026-08-23/.test(snd) && /ROLL/.test(snd));
t('sound report carries roll', /SR01/.test(snd));
t('sound report marks circled', /● the keeper/.test(snd));
t('sound report notes NG reason', /\[NG: boom in\]/.test(D.soundReport([D.makeTake({ day: 'd1', scene: '1', slate: '1A', take: 1, ngReason: 'boom in' })], 'd1')));

/* ── editor picks ── */
const picks = D.editorPicks(takes);
t('editorPicks keeps only circled takes', picks.length === 2 && picks.every(p => ['2A', '7A'].indexOf(p.slate) >= 0));
t('editorPicks sorted by scene', picks[0].scene === '2' && picks[1].scene === '7');
t('editorPicks shape for SB_DailiesPicks_v1', 'scene' in picks[0] && 'slate' in picks[0] && 'take' in picks[0] && 'notes' in picks[0]);
const pt = D.picksText(picks);
t('picksText groups by scene with notes', /Scene 2/.test(pt) && /Scene 7/.test(pt) && /the keeper/.test(pt));
t('picksText honest about circles', /not bound/.test(pt));
t('picksText empty log', /no circled takes yet/.test(D.picksText([])));

console.log(`test_dailies: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
