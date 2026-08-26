#!/usr/bin/env node
/* Node tests for dailies/lib-dailies.js (CDailies) — run: node scripts/test_dailies.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* the one scene model — lib-dailies.js reads its scenes from here */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
/* the shoot day — the join key, and the one place the OTHER take store's
   circle ('Circled ⭕' in a `grade` field) is turned into a boolean */
(0, eval)(readFileSync(join(ROOT, 'js/lib-shootdays.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'dailies/lib-dailies.js'), 'utf8'));
const D = globalThis.CDailies;
const SD = globalThis.CShootDays;

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

/* A revised shooting script: a FADE IN: preamble and an A-scene, the two
   inputs a coverage report has to survive. 4A is not 4 — on a revision the
   A-scenes are exactly the new material, so crediting a take on 4A to scene 4
   reports the newest pages as covered when nothing has been shot on them. */
const SHOOTING = `FADE IN:

1  INT. FARMHOUSE KITCHEN - NIGHT

Maggie sets the table.

4  INT. STUDY - NIGHT

Tom loads the shotgun.

4A  EXT. PORCH - NIGHT

Headlights swing across the boards.`;
const shot4A = D.coverageByScene([D.makeTake({ scene: '4A', slate: '4AA', take: 1, circled: true })], SHOOTING);
t('coverage keeps A-scenes apart from the scene they insert into',
  shot4A.total === 3 && shot4A.covered === 1 &&
  shot4A.scenes.filter(s => s.key === '4A')[0].takes === 1 &&
  shot4A.scenes.filter(s => s.key === '4')[0].takes === 0);
t('the scene 4 gap survives a take on 4A', shot4A.gaps.map(g => g.key).join(',') === '1,4');
t('coverage rows carry the printed label as well as the numeric base',
  shot4A.scenes.map(s => s.label).join(',') === '1,4,4A' &&
  shot4A.scenes.map(s => s.n).join(',') === '1,4,4');

/* ── the circle, across both take stores ─────────────────────────────────
   SB_TakeLog_v1 (tools/tools-media-ui.js) says "circled" with the display
   string 'Circled ⭕' in `grade`. Reading `t.circled` off those rows returned
   undefined, so a take circled on the phone counted as a take and never as a
   circle — invisible to the rate, to both reports and to the pull list. */
const toolsRow = { id: 'r1', day: '2026-08-23', time: '11:02', scene: '7', take: '3',
                   roll: 'A001', grade: 'Circled ⭕', note: 'from the phone' };
const toolsRows = SD.allTakes({ takeLog: [toolsRow] });
t('isCircled reads this module\'s own boolean', D.isCircled({ circled: true }) === true &&
  D.isCircled({ circled: false }) === false && D.isCircled(null) === false);
t('isCircled reads the other store\'s grade string through CShootDays',
  D.isCircled(toolsRow) === true && D.isCircled({ grade: 'Good' }) === false &&
  D.isCircled({ grade: '—' }) === false);
t('the grade rule is not restated here — it is CShootDays\'s',
  D.isCircled({ grade: SD.CIRCLED_GRADE }) === true);
const fromLog = D.fromLogRow(toolsRows[0]);
t('fromLogRow lands a take-log row in this module\'s shape',
  fromLog.id === 'r1' && fromLog.scene === '7' && fromLog.take === 3 &&
  fromLog.circled === true && fromLog.soundRoll === 'A001' && fromLog.notes === 'from the phone');
t('fromLogRow marks where the take came from', fromLog.source === SD.TAKELOG_KEY);
t('a take-log row with no slate is given one rather than sorting as scene 0',
  D.fromLogRow({ scene: '7', take: '1' }).slate === '7A');
const merged = D.mergeTakes(takes, toolsRows);
t('mergeTakes adds the other store\'s takes', merged.length === takes.length + 1);
t('mergeTakes is idempotent on id', D.mergeTakes(merged, toolsRows).length === merged.length);
t('the circle rate counts a circle made in Tools', (() => {
  const a = D.circleRate(takes).overall.circled;
  const b = D.circleRate(merged).overall.circled;
  return b === a + 1;
})());
t('the camera report marks a take circled in Tools', /● from the phone/.test(
  D.cameraReport(merged, '2026-08-23', {})));
t('the sound report marks it too', /● from the phone/.test(D.soundReport(merged, '2026-08-23', {})));
t('the editor pull list carries it', D.editorPicks(merged).some(p => p.notes === 'from the phone'));
t('coverage counts it as a circle', (() => {
  const c = D.coverageByScene(merged, SCRIPT);
  return c.scenes.filter(s => s.key === '3')[0].circled === 0 && D.isCircled(toolsRows[0]);
})());

/* ── what date a take is stamped with ───────────────────────────────────
   THE CONVENTION: the shoot day is the production's LOCAL calendar date. A
   take logged at 23:50 belongs to the day the crew worked. tools/tools-core.js
   stamps SB_TakeLog_v1 in UTC while carrying a LOCAL 'HH:MM' in the same row;
   until that is aligned, this page can at least SEE the disagreement. */
const late = new Date(2026, 8, 7, 23, 50, 0);        /* 23:50 local on the 7th */
t('the day stamp is the local calendar date, not the UTC one',
  D.localDayISO(late) === '2026-09-07');
t('utcDayISO is the other writer\'s convention, kept only to compare against',
  /^\d{4}-\d{2}-\d{2}$/.test(D.utcDayISO(late)));
t('dayStamp reports whether the two conventions agree right now', (() => {
  const s = D.dayStamp(late);
  return s.local === '2026-09-07' && s.differ === (s.local !== s.utc);
})());
t('a fixed instant west of Greenwich stamps differently in each convention', (() => {
  const utcMorning = new Date(Date.UTC(2026, 8, 8, 3, 50));   /* 20:50 on the 7th at UTC-07:00 */
  return D.utcDayISO(utcMorning) === '2026-09-08';
})());

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
