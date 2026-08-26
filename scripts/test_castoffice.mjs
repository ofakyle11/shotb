#!/usr/bin/env node
/* Node tests for casting/lib-castdesk.js (CCastDesk) — run: node scripts/test_castoffice.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* the one scene model — lib-castdesk.js reads its scenes from here */
(0, eval)(readFileSync(join(ROOT, 'js/lib-scenes.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'casting/lib-castdesk.js'), 'utf8'));
const C = globalThis.CCastDesk;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

const SCRIPT = `FADE IN:

INT. FARMHOUSE KITCHEN - NIGHT
Maggie sets the table. A DOOR SLAMS SOMEWHERE UPSTAIRS.

MAGGIE
Dinner's getting cold.

TOM (V.O.)
I'm not hungry.

MAGGIE (CONT'D)
Suit yourself.

EXT. COUNTRY ROAD - DAY
A rusted truck rattles past.

TOM
Pull over.

CUT TO:

INT. STUDY - NIGHT
Bookshelves line the wall.

SHERIFF DANE
Evening, folks.

TOM (O.S.)
Sheriff.

THE END`;

/* ── scenes ── */
const scenes = C.splitScenes(SCRIPT);
t('splitScenes: preamble + 3 scenes (house pattern)', scenes.length === 4 && scenes[0].n === 0);
/* The first real scene is 1, not 2. This fixture opens on a FADE IN:
   preamble; the retired splitter pushed the preamble as scene 0 and then
   took `n = scenes.length + 1` = 2 for the scene after it, so the whole
   platform numbered a screenplay's opening scene 2. This assertion used to
   require that. See js/lib-scenes.js and scripts/test_scenes.mjs. */
t('slug preserved', /FARMHOUSE/.test(scenes[1].slug) && scenes[1].n === 1);

/* ── cue detection ── */
t('cueName plain', C.cueName('  MAGGIE  ') === 'MAGGIE');
t('cueName strips (V.O.)', C.cueName('TOM (V.O.)') === 'TOM');
t("cueName strips (CONT'D)", C.cueName("MAGGIE (CONT'D)") === 'MAGGIE');
t('cueName strips (O.S.)', C.cueName('TOM (O.S.)') === 'TOM');
t('cueName rejects slugline', C.cueName('INT. FARMHOUSE KITCHEN - NIGHT') === null);
t('cueName rejects transition', C.cueName('CUT TO:') === null);
t('cueName rejects FADE OUT', C.cueName('FADE OUT.') === null);
t('cueName rejects mixed case', C.cueName('Maggie sets the table.') === null);
t('cueName rejects 1-char', C.cueName('A') === null);
t('cueName rejects >30 chars', C.cueName('A DOOR SLAMS SOMEWHERE UPSTAIRS AND ECHOES') === null);
t('cueName allows two-word names', C.cueName('SHERIFF DANE') === 'SHERIFF DANE');

/* ── charactersFromScript ── */
const chars = C.charactersFromScript(SCRIPT);
t('finds exactly 3 speaking roles', chars.length === 3);
const byName = {};
chars.forEach(c => { byName[c.name] = c; });
t('TOM has 3 dialogue cues', byName.TOM && byName.TOM.lines === 3);
t('TOM speaks in 3 scenes', byName.TOM.scenes === 3 && byName.TOM.sceneList.join(',') === '1,2,3');
t('MAGGIE has 2 cues in one scene', byName.MAGGIE && byName.MAGGIE.lines === 2 && byName.MAGGIE.scenes === 1);
t('SHERIFF DANE 1 cue, last scene', byName['SHERIFF DANE'] && byName['SHERIFF DANE'].lines === 1 && byName['SHERIFF DANE'].sceneList.join(',') === '3');
t('sorted by lines desc', chars[0].name === 'TOM' && chars[chars.length - 1].name === 'SHERIFF DANE');
t('THE END not a character', !byName['THE END']);
t('shouted action line not a character', !byName['A DOOR SLAMS SOMEWHERE UPSTAIRS.']);
t('empty script → no roles', C.charactersFromScript('').length === 0);
/* a lone ALL-CAPS line with no dialogue after it is not a cue */
t('cue requires following dialogue', C.charactersFromScript('INT. HALL - DAY\nMAGGIE\n\nEXT. YARD - DAY\nBirds.').length === 0);

/* ── hold conflicts ── */
const cands = [
  { id: '1', name: 'Ana Reyes', role: 'MAGGIE', status: 'hold',   holdFrom: '2026-10-01', holdTo: '2026-10-20' },
  { id: '2', name: 'ANA REYES', role: 'NURSE',  status: 'booked', holdFrom: '2026-10-15', holdTo: '2026-10-25' },
  { id: '3', name: 'Ana Reyes', role: 'CLERK',  status: 'hold',   holdFrom: '2026-11-01', holdTo: '2026-11-05' },
  { id: '4', name: 'Ben Cho',   role: 'TOM',    status: 'hold',   holdFrom: '2026-10-01', holdTo: '2026-10-20' },
  { id: '5', name: 'Ben Cho',   role: 'DEPUTY', status: 'submitted', holdFrom: '2026-10-01', holdTo: '2026-10-20' },
  { id: '6', name: 'Ben Cho',   role: 'MAYOR',  status: 'hold',   holdFrom: '', holdTo: '' }
];
const conflicts = C.holdConflicts(cands);
t('one conflict found', conflicts.length === 1);
t('conflict matches names case-insensitively', conflicts[0] && conflicts[0].name.toLowerCase() === 'ana reyes');
t('conflict carries both roles', conflicts[0].a.role === 'MAGGIE' && conflicts[0].b.role === 'NURSE');
t('non-overlapping ranges pass', !conflicts.some(k => k.a.role === 'CLERK' || k.b.role === 'CLERK'));
t('submitted status never conflicts', !conflicts.some(k => k.name === 'Ben Cho'));
t('missing dates skipped safely', C.holdConflicts([cands[3], cands[5]]).length === 0);
t('touching endpoints do overlap', C.rangesOverlap('2026-10-01', '2026-10-10', '2026-10-10', '2026-10-20') === true);
t('disjoint ranges do not overlap', C.rangesOverlap('2026-10-01', '2026-10-09', '2026-10-10', '2026-10-20') === false);
t('empty candidate list → no conflicts', C.holdConflicts([]).length === 0 && C.holdConflicts(null).length === 0);

/* ── sides ── */
const sidesM = C.sidesFor(SCRIPT, 'maggie');
t('sides found case-insensitively', /AUDITION SIDES — MAGGIE/.test(sidesM));
t('sides include slugline + dialogue', /FARMHOUSE KITCHEN/.test(sidesM) && /Dinner's getting cold/.test(sidesM));
t('sides exclude scenes without the role', !/COUNTRY ROAD/.test(sidesM) && !/STUDY/.test(sidesM));
t('sides carry scene numbers', /SCENE 1/.test(sidesM));
t('sides carry verify note', /verify against the current draft/i.test(sidesM));
const sidesT = C.sidesFor(SCRIPT, 'TOM');
t('TOM sides span all 3 scenes', /SCENE 1/.test(sidesT) && /SCENE 2/.test(sidesT) && /SCENE 3/.test(sidesT));
t('unknown character → empty sides', C.sidesFor(SCRIPT, 'NOBODY') === '');
t('blank character → empty sides', C.sidesFor(SCRIPT, '') === '');

/* ── offer memo ── */
const memo = C.offerLetter({ production: 'Night Harvest', actor: 'Ana Reyes', role: 'MAGGIE',
  startDate: '2026-10-06', endDate: '2026-10-24', rate: '3500', rateUnit: 'weekly',
  billing: 'Main titles, 2nd position', contact: 'K. Francis', date: '2026-08-23' });
t('memo carries production/actor/role', /Night Harvest/.test(memo) && /Ana Reyes/.test(memo) && /MAGGIE/.test(memo));
t('memo carries dates and rate unit', /2026-10-06 through 2026-10-24/.test(memo) && /3500 per week/.test(memo));
t('memo carries billing', /Main titles, 2nd position/.test(memo));
t('memo has counsel-review note', /production counsel/.test(memo) && /not a binding agreement/.test(memo));
t('daily unit prints per day', /per day/.test(C.offerLetter({ rate: '900', rateUnit: 'daily' })));
const bare = C.offerLetter({});
t('empty memo never invents — TBDs', /Date: TBD/.test(bare) && /TBD through TBD/.test(bare) && /Compensation:\s+TBD/.test(bare));

/* ── board summary ── */
const roles = [
  { name: 'MAGGIE', candidates: [
    { status: 'booked' }, { status: 'released' }, { status: 'callback' }] },
  { name: 'TOM', candidates: [
    { status: 'submitted' }, { status: 'submitted' }, { status: 'hold' }, { status: 'offer' }, { status: 'test' }] },
  { name: 'SHERIFF DANE', candidates: [] }
];
const sum = C.boardSummary(roles);
t('summary counts every status', sum.booked === 1 && sum.released === 1 && sum.callback === 1 &&
  sum.submitted === 2 && sum.hold === 1 && sum.offer === 1 && sum.test === 1);
t('summary totals', sum.candidates === 8 && sum.roles === 3 && sum.rolesCast === 1);
t('summary of nothing is zeros', C.boardSummary([]).candidates === 0 && C.boardSummary(null).roles === 0);

console.log(`test_castoffice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
