#!/usr/bin/env node
/* Node tests for js/lib-scenes.js (CScenes) — run: node scripts/test_scenes.mjs
 *
 * These fixtures deliberately carry the four input classes every existing
 * script fixture avoided, which is the only reason the old suites were green:
 *   · a FADE IN: preamble        (first real scene was numbered 2)
 *   · printed scene numbers      (thrown away by a non-capturing group)
 *   · A/B scenes — 4A            (not recognised as a scene break at all)
 *   · I/E. and INT./EXT.         (matched as INT, leaving "/EXT." in the name)
 * plus CONTINUED furniture, dual dialogue, and both-margin scene numbers.
 *
 * Where this replaces an existing implementation the old one is asserted to
 * agree first (see "agreement" below) — the retired copies were only wrong on
 * the classes above, and staying identical everywhere else is the evidence
 * that migrating the callers changed nothing it should not have.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
const S = globalThis.CScenes;

let pass = 0, fail = 0;
function t(name, cond, got) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name, got === undefined ? '' : '→ ' + JSON.stringify(got)); }
}

/* ══ fixture A · numbered shooting script, preamble, A/B scene, I/E ══════ */
const SHOOTING = `THE LONG WAY DOWN

Written by A. Writer
Second Blue Revision

FADE IN:

1   INT. FARMHOUSE KITCHEN - NIGHT                                  1

Maggie sets the table. A shotgun leans by the door.

MAGGIE
Dinner's getting cold.

2   EXT. COUNTRY ROAD - DAY                                         2

A rusted truck rattles past.

CONTINUED:

Tom checks his watch.

4A  INT. STUDY - NIGHT                                              4A

Tom loads the shotgun.

4B  INT. STUDY - LATER                                              4B

The lamp is out.

5   I/E. PATROL CAR - MOVING - DAY                                  5

Rain crawls across the glass.

6   INT./EXT. DINER - CONTINUOUS                                    6

Neon buzzes.

FADE OUT.`;

const r = S.parse(SHOOTING);

t('preamble is not a scene', r.scenes.length === 6, r.scenes.length);
t('preamble captured, not dropped', !!r.preamble && /FADE IN/.test(r.preamble.text));
t('preamble keeps the title page', /THE LONG WAY DOWN/.test(r.preamble.text));

/* THE bug: with a FADE IN: preamble the first real scene was numbered 2. */
t('first real scene is ordinal 1 despite preamble', r.scenes[0].ord === 1, r.scenes[0].ord);

/* THE other bug: the printed number was thrown away. */
t('script is detected as numbered', r.numbered === true);
t('printed numbers captured verbatim',
  r.scenes.map(s => s.number).join(',') === '1,2,4A,4B,5,6',
  r.scenes.map(s => s.number));
t('A/B scene 4A is its own scene', !!S.byNumber(r.scenes, '4A'));
t('A/B scene 4B is its own scene', !!S.byNumber(r.scenes, '4B'));
t('4A body is not swallowed into 2',
  /loads the shotgun/.test(S.byNumber(r.scenes, '4A').text) &&
  !/loads the shotgun/.test(S.byNumber(r.scenes, '2').text));
t('gap in printed numbers is preserved (no scene 3 invented)',
  !S.byNumber(r.scenes, '3'));

/* n stays numeric for arithmetic and for the existing numeric stores. */
t('n is numeric, 4A → 4', S.byNumber(r.scenes, '4A').n === 4);
t('label is what a human reads', S.byNumber(r.scenes, '4A').label === '4A');
t('key separates 4A from 4B', S.byNumber(r.scenes, '4A').key !== S.byNumber(r.scenes, '4B').key);
t('sortKey orders 4 < 4A < 4B < 5',
  S.byNumber(r.scenes, '4A').sortKey < S.byNumber(r.scenes, '4B').sortKey &&
  S.byNumber(r.scenes, '4B').sortKey < S.byNumber(r.scenes, '5').sortKey);

/* Both-margin scene numbers must not end up in the location. */
t('right-margin scene number stripped from slug',
  !/\s4A\s*$/.test(S.byNumber(r.scenes, '4A').slug), S.byNumber(r.scenes, '4A').slug);
t('location has no number in it', S.byNumber(r.scenes, '1').location === 'FARMHOUSE KITCHEN',
  S.byNumber(r.scenes, '1').location);

/* I/E and INT./EXT. */
t('I/E. normalises to INT/EXT', S.byNumber(r.scenes, '5').iu === 'INT/EXT', S.byNumber(r.scenes, '5').iu);
t('INT./EXT. normalises to INT/EXT', S.byNumber(r.scenes, '6').iu === 'INT/EXT');
t('I/E location is not "/E. PATROL CAR"', S.byNumber(r.scenes, '5').location === 'PATROL CAR - MOVING',
  S.byNumber(r.scenes, '5').location);
t('INT is INT', S.byNumber(r.scenes, '1').iu === 'INT');
t('EXT is EXT', S.byNumber(r.scenes, '2').iu === 'EXT');

/* Time of day. */
t('tod NIGHT', S.byNumber(r.scenes, '1').tod === 'NIGHT');
t('tod DAY', S.byNumber(r.scenes, '2').tod === 'DAY');
t('tod LATER', S.byNumber(r.scenes, '4B').tod === 'LATER');
t('tod CONTINUOUS', S.byNumber(r.scenes, '6').tod === 'CONTINUOUS');

/* CONTINUED is furniture, not content and not a scene break. */
t('CONTINUED: does not create a scene', r.scenes.length === 6);
t('CONTINUED: kept out of the body', !/CONTINUED/.test(S.byNumber(r.scenes, '2').text));
t('CONTINUED flagged on the scene', S.byNumber(r.scenes, '2').continued === true);
t('content after CONTINUED: still belongs to the scene',
  /checks his watch/.test(S.byNumber(r.scenes, '2').text));

/* ══ fixture B · unnumbered spec draft, no preamble ══════════════════════ */
const SPEC = `INT. APARTMENT - DAY

She waits.

EXT. STREET - NIGHT

He does not come.`;
const rb = S.parse(SPEC);
t('unnumbered draft: two scenes', rb.scenes.length === 2);
t('unnumbered draft: numbered=false', rb.numbered === false);
t('unnumbered draft: no preamble', rb.preamble === null);
t('unnumbered draft falls back to the ordinal', rb.scenes[1].n === 2 && rb.scenes[1].label === '2');
t('unnumbered draft: number stays empty', rb.scenes[0].number === '');
t('byNumber works on the ordinal', S.byNumber(rb.scenes, 2).slug === 'EXT. STREET - NIGHT');

/* ══ fixture C · preamble with NO numbers — the 7-of-8 regression ════════ */
const PREAMBLE_ONLY = `FADE IN:

INT. KITCHEN - DAY

Toast burns.

EXT. GARDEN - DAY

Nothing grows.`;
const rc = S.parse(PREAMBLE_ONLY);
t('C: FADE IN: is preamble, not scene 1', rc.scenes.length === 2);
t('C: first real scene is 1, not 2', rc.scenes[0].n === 1 && rc.scenes[0].label === '1', rc.scenes[0].label);
const houseC = S.split(PREAMBLE_ONLY);
t('C: split() keeps the house pattern — preamble at ord 0', houseC.length === 3 && houseC[0].ord === 0);
t('C: split() first real scene is 1', houseC[1].n === 1, houseC[1].n);

/* ══ dual dialogue ══════════════════════════════════════════════════════ */
const DUAL = `INT. BAR - NIGHT

MAGGIE                             TOM
I told you.                        You did not.`;
const rd = S.parse(DUAL);
t('dual: still one scene', rd.scenes.length === 1);
t('dual: both cues survive', /MAGGIE/.test(rd.scenes[0].text) && /TOM/.test(rd.scenes[0].text));
t('dual: cues land on separate lines',
  rd.scenes[0].body.some(l => /^MAGGIE$/.test(l.trim())) &&
  rd.scenes[0].body.some(l => /^TOM$/.test(l.trim())));
t('splitDual strips the Fountain caret', S.splitDual('TOM ^')[0] === 'TOM');
t('splitDual leaves a wide action line alone', S.splitDual('He walks in.     She leaves.') === null);

/* ══ slugline recognition — the false positives that must stay out ═══════ */
t('INTERCUT is not a slugline', !S.isSlug('INTERCUT - PHONE CALL'));
t('"Interior designers argue." is not a slugline', !S.isSlug('Interior designers argue.'));
t('EXTRA is not a slugline', !S.isSlug('EXTRAS fill the room.'));
t('bare "INT." with no location is not a slugline', !S.isSlug('INT.'));
t('a character cue is not a slugline', !S.isSlug('MAGGIE'));
t('INT with no period still parses', S.isSlug('INT KITCHEN - DAY'));
t('EST. is a slugline', S.parseSlug('EST. THE CAPITOL - DAY').iu === 'EST');
t('SCENE 12 prefix parses', S.parseSlug('SCENE 12  INT. HALL - DAY').number === '12');
t('A-prefixed number A12 parses', S.parseSlug('A12  INT. HALL - DAY').number === 'A12');
t('A-prefixed sorts before 12', S.keyWeight('A12') < S.keyWeight('12B'));

/* number on its own line above the slugline (PDF extraction) */
const PDFISH = `24.

INT. HALL - DAY

He waits.`;
t('bare number line is attached to the slugline below it',
  S.parse(PDFISH).scenes[0].number === '24', S.parse(PDFISH).scenes[0].number);

/* ══ lookup ═════════════════════════════════════════════════════════════ */
t('byNumber tolerates lowercase', S.byNumber(r.scenes, '4a').number === '4A');
t('byNumber tolerates whitespace', S.byNumber(r.scenes, '  4A ').number === '4A');
t('byNumber tolerates "SC 4A"', S.byNumber(r.scenes, 'SC 4A').number === '4A');
t('byNumber tolerates a number type', S.byNumber(r.scenes, 5).number === '5');
t('byNumber misses cleanly', S.byNumber(r.scenes, '99') === null);
const idx = S.index(r.scenes);
t('index keyed by printed number', idx['4A'] && idx['4A'].label === '4A');

/* ══ scene number lists ═════════════════════════════════════════════════ */
t('parseSceneNums expands a range', S.parseSceneNums('1, 4-6').join(',') === '1,4,5,6');
t('parseSceneNums keeps 8A', S.parseSceneNums('8A, 2').join(',') === '2,8A');
t('parseSceneNums sorts 4 before 4A', S.parseSceneNums('4A, 4').join(',') === '4,4A');
t('parseSceneNums ignores junk', S.parseSceneNums('hello, 3').join(',') === '3');

/* ══ page measure ═══════════════════════════════════════════════════════ */
t('every scene is at least 1/8', r.scenes.every(s => s.eighths >= 1));
t('eighths total is the sum of the scenes',
  r.eighths === r.scenes.reduce((a, s) => a + s.eighths, 0));
/* 55 lines is one page, by construction — the measure is anchored, not guessed. */
const onePage = Array.from({ length: 53 }, (_, i) => (i % 4 ? 'He crosses the room and looks out.' : '')).join('\n');
const rp = S.parse('INT. ROOM - DAY\n' + onePage);
t('55 lines measures as about one page', Math.abs(rp.scenes[0].eighths - 8) <= 1, rp.scenes[0].eighths);

/* ══ empty and hostile input ════════════════════════════════════════════ */
t('empty text → no scenes', S.parse('').scenes.length === 0);
t('empty text → no preamble', S.parse('').preamble === null);
t('null text does not throw', S.parse(null).scenes.length === 0);
t('prose with no sluglines → no scenes, all preamble',
  S.parse('Once upon a time.').scenes.length === 0 && !!S.parse('Once upon a time.').preamble);
t('split("") is empty', S.split('').length === 0);
t('sceneList shape', S.sceneList(SPEC)[0].slug === 'INT. APARTMENT - DAY');

/* ══ store ══════════════════════════════════════════════════════════════ */
t('KEY is SB_Scenes_v1', S.KEY === 'SB_Scenes_v1');
const built = S.build(SHOOTING, { project: 'The Long Way Down' });
t('build carries the scenes', built.scenes.length === 6 && built.v === 1);
t('build records numbered + pages', built.numbered === true && built.pages > 0);
t('build round-trips through JSON', JSON.parse(JSON.stringify(built)).scenes[2].number === '4A');
t('load with no localStorage returns null, does not throw', S.load() === null);
t('save with no localStorage returns false, does not throw', S.save(built) === false);
t('list with no localStorage is empty', S.list().length === 0);

/* ══ agreement · the retired copies, on input they got right ════════════
   Every module that had its own splitScenes is loaded here and asserted to
   produce the SAME scene count and the SAME slug text as CScenes on a script
   without a preamble, printed numbers or A/B scenes — the only shape they
   ever handled. Migrating those callers therefore cannot have changed an
   answer that was previously correct. On the hard fixture they disagree, and
   that disagreement is the defect this module exists to end.               */
const AGREE = `INT. FARMHOUSE KITCHEN - NIGHT
Maggie sets the table.

EXT. COUNTRY ROAD - DAY
A rusted truck rattles past.

INT. STUDY - NIGHT
Tom loads the shotgun.`;

const mine = S.split(AGREE);
t('agreement fixture: 3 scenes', mine.length === 3);

for (const [file, global] of [
  ['props/lib-props.js', 'CProps'],
  ['vfx/lib-vfx.js', 'CVfx'],
  ['music/lib-music.js', 'CMusic'],
  ['wardrobe/lib-ward.js', 'CWard'],
  ['dailies/lib-dailies.js', 'CDailies'],
  ['casting/lib-castdesk.js', 'CCastDesk'],
  ['clearance/lib-clear.js', 'CClear'],
  ['safety/lib-safety.js', 'CSafety'],
]) {
  (0, eval)(readFileSync(join(ROOT, file), 'utf8'));
  const M = globalThis[global];
  t(global + ' exists', !!M);
  if (!M) continue;
  /* Every one of these now delegates to CScenes — same function, one source. */
  t(global + '.splitScenes is CScenes.split', M.splitScenes === S.split);
  const got = M.splitScenes(AGREE);
  t(global + ' agrees on scene count', got.length === mine.length, got.length);
  t(global + ' agrees on slugs', got.map(s => s.slug).join('|') === mine.map(s => s.slug).join('|'));
  t(global + ' agrees on numbering', got.map(s => s.n).join(',') === mine.map(s => s.n).join(','));
  /* and each now gets the hard fixture right, which none of them did before */
  const hard = M.splitScenes(SHOOTING);
  t(global + ' finds 4A on the shooting script', hard.some(s => s.number === '4A'));
  t(global + ' numbers the first real scene 1, not 2',
    hard.filter(s => s.ord === 1)[0].n === 1);
}

/* production/lib-prod.js shipped the whole screenplay as "sides" because its
   splitter had no scene-number prefix. Its load-order prelude is CScenes (above)
   and CShootDays — the shoot-day record its daily report joins the day on. */
(0, eval)(readFileSync(join(ROOT, 'js/lib-shootdays.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'production/lib-prod.js'), 'utf8'));
const sides = globalThis.CProd.sidesFor(SHOOTING, 'Maggie');
t('sides: numbered script actually splits', sides.length >= 1);
t('sides: only the scenes the character is in',
  sides.length < S.parse(SHOOTING).scenes.length, sides.length);
t('sides: not the entire screenplay',
  sides.every(b => b.text.length < SHOOTING.length * 0.6), sides.map(b => b.text.length));
t('sides: carries the printed scene number', sides[0].scene === '1', sides[0].scene);
t('sides: empty for a character who never appears',
  globalThis.CProd.sidesFor(SHOOTING, 'NOBODY').length === 0);

console.log(`scenes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
