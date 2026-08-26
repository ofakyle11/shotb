/* timeline/parser.js ⇄ js/lib-scenes.js — slugline agreement.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * timeline/parser.js delegates every ANCHORED slugline decision to
 * CScenes.parseSlug, but it cannot delegate the UNANCHORED ones: a flattened
 * PDF paste runs several sluglines into a single line, and CScenes.SLUG_RE is
 * ^-anchored with a tail group that runs to end-of-line. So parser.js keeps
 * one unanchored copy of the interior/exterior token (IU_ALT) for its
 * flatten/unflatten scanners.
 *
 * A copy that nothing checks is how the first defect got in: the scanners
 * knew INT. EXT. INT/EXT. I/E. and nothing else, while CScenes had already
 * grown EST., E/I and the period-less "INT KITCHEN - DAY". Those scenes were
 * not scene breaks at all on a PDF paste — their pages were swallowed into
 * the scene above, silently.
 *
 * This suite pins the two implementations to each other on one shared corpus:
 *   1. every line CScenes calls a slugline, parser.js must call a slugline —
 *      at line start AND in the middle of a run-together blob;
 *   2. the number / location / time-of-day they report must be identical;
 *   3. every line CScenes rejects, parser.js must also reject as a slugline
 *      (the three timeline-only heading forms are named and excluded, and the
 *      suite asserts CScenes really does reject those three, which is the
 *      whole justification for keeping them local);
 *   4. the fixtures the old suites avoided: a FADE IN: preamble, A/B scene
 *      numbers, I/E sluglines, and a numbered shooting script.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const sandbox = { window: {}, console };
/* Load order is the runtime contract: the scene model first. */
vm.runInNewContext(readFileSync(join(ROOT, 'js', 'lib-scenes.js'), 'utf8'), sandbox);
vm.runInNewContext(readFileSync(join(ROOT, 'timeline', 'parser.js'), 'utf8'), sandbox);
const CS = sandbox.window.CScenes;
const P = sandbox.window.SBParser;

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) passed++;
  else failures.push(msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

/* ── the shared corpus ────────────────────────────────────────────────────
   Every form CScenes accepts, including the ones the retired local regexes
   never knew about. */
const SLUGS = [
  'INT. KITCHEN - DAY',
  'EXT. ROOFTOP - NIGHT',
  'INT KITCHEN - DAY',                 /* no period — CScenes allows it */
  'EST. THE CAPITOL - DAY',            /* establishing shot */
  'I/E. PATROL CAR - DAY',             /* the I/E family */
  'I/E PATROL CAR - NIGHT',
  'I / E PATROL CAR - DUSK',           /* spaced, as PDF extraction leaves it */
  'E/I. AMBULANCE - NIGHT',
  'INT/EXT. TRAIN - CONTINUOUS',
  'EXT/INT. VAN - DAY',
  '24 INT. FARMHOUSE KITCHEN - NIGHT', /* numbered shooting script */
  '4A INT. STUDY - NIGHT',             /* an A/B revision scene */
  '12B EXT. LOADING DOCK - DAWN',
  'A4 EXT. ROOF - DUSK',               /* prefixed A/B form */
  'SCENE 12 INT. BAR - NIGHT',
  'INT. PARIS - LEFT BANK - NIGHT',    /* dashes inside the location */
];

/* Lines that are NOT sluglines to either implementation. */
const NON_SLUGS = [
  'INTERIOR DESIGNER walks in.',
  'EXTRA CREW arrive on set.',
  'John pushes the door open.',
  'FADE OUT.',
  'THE END',
];

/* The three heading forms parser.js keeps on purpose. The old file header
   claimed ALL its local regexes were deliberate; only these three are. */
const TIMELINE_ONLY = [
  'MONTAGE - THE TRAINING',
  'FLASHBACK - 1974',
  'SCENE 12 - KITCHEN',
  '1. KITCHEN - DAY',
  'INTERCUT WITH:',
];

/* ── 1 · anchored agreement ───────────────────────────────────────────── */
for (const line of SLUGS) {
  const c = CS.parseSlug(line);
  ok(!!c, `CScenes must accept ${JSON.stringify(line)}`);
  if (!c) continue;
  const p = P.parseSceneHeading(line);
  eq(p.number, c.number, `number for ${JSON.stringify(line)}`);
  eq(p.name, c.location, `location for ${JSON.stringify(line)}`);
  eq(p.timeOfDay, c.tod, `tod for ${JSON.stringify(line)}`);
  eq(p.iu, c.iu, `iu for ${JSON.stringify(line)}`);
  /* and the whole-text scanner sees it too */
  const locs = P.extractLocationsFromText(line + '\n\nSomething happens here.\n');
  ok(Object.prototype.hasOwnProperty.call(locs, c.location),
    `extractLocationsFromText should key ${JSON.stringify(line)} under ${JSON.stringify(c.location)} — got ${JSON.stringify(Object.keys(locs))}`);
}

/* ── 2 · UNANCHORED agreement — the reason the local copy exists ───────── */
for (const line of SLUGS) {
  const c = CS.parseSlug(line);
  if (!c) continue;
  /* One run-together line, exactly what a PDF paste delivers. */
  const blob = 'The door slams shut. ' + line + ' Rain hammers the tin roof.';
  const un = P.unflattenScreenplay(blob);
  const rebuilt = un.split('\n').map(s => s.trim()).filter(Boolean)
    .map(s => CS.parseSlug(s)).filter(Boolean);
  ok(rebuilt.some(r => r.location === c.location && r.iu === c.iu),
    `unflattenScreenplay must break out ${JSON.stringify(line)} mid-line — got ${JSON.stringify(un)}`);
  const locs = P.extractLocationsFromText(blob);
  ok(Object.prototype.hasOwnProperty.call(locs, c.location),
    `mid-line scan must find ${JSON.stringify(c.location)} in a flattened blob — got ${JSON.stringify(Object.keys(locs))}`);
  /* isClipReconstruction counts sluglines with the same token; a blob that
     genuinely carries one must never be mistaken for pasted clip metadata. */
  ok(P.isClipReconstruction(blob) === false,
    `a blob containing ${JSON.stringify(line)} is not clip metadata`);
}

/* ── 3 · negative agreement ───────────────────────────────────────────── */
for (const line of NON_SLUGS) {
  eq(CS.parseSlug(line), null, `CScenes must reject ${JSON.stringify(line)}`);
  const p = P.parseSceneHeading(line);
  eq(p.key, '', `parser must not read ${JSON.stringify(line)} as a heading`);
  const locs = P.extractLocationsFromText('INT. HALL - DAY\n\n' + line + '\n');
  eq(Object.keys(locs).join('|'), 'HALL', `${JSON.stringify(line)} must not add a location`);
}

/* ── 4 · the three timeline-only forms, and why they stay local ────────── */
for (const line of TIMELINE_ONLY) {
  eq(CS.parseSlug(line), null,
    `CScenes must NOT claim ${JSON.stringify(line)} — that is why parser.js keeps it`);
  const r = P.parse(line + '\n\nSomeone crosses the room.\n', 5);
  eq(r.scenes.length, 1, `parser must open a scene on ${JSON.stringify(line)}`);
}

/* ── 5 · the fixtures the old suites avoided ──────────────────────────── */

/* FADE IN: preamble — the first real scene is 1, not 2. */
const FADE_IN = `FADE IN:

INT. FARMHOUSE KITCHEN - DAWN

Mercer pours coffee.

EXT. YARD - DAY

The truck will not start.`;
{
  const r = P.parse(FADE_IN, 5);
  eq(r.scenes.length, 2, 'FADE IN: preamble must not become a scene');
  eq(r.scenes[0].label, '1', 'first real scene after FADE IN: is labelled 1');
  eq(r.scenes[0].ord, 1, 'first real scene after FADE IN: is ordinal 1');
  eq(r.scenes[0].location, 'FARMHOUSE KITCHEN', 'FADE IN: scene 1 location');
  eq(r.scenes[1].label, '2', 'second scene after FADE IN: is labelled 2');
  /* and the shared model agrees */
  const cs = CS.parse(FADE_IN);
  eq(cs.scenes.length, r.scenes.length, 'scene count agrees with CScenes');
  eq(cs.scenes[0].label, r.scenes[0].label, 'first label agrees with CScenes');
}

/* A numbered shooting script with A/B scenes and an I/E heading. The printed
   number is the identity; the ordinal is not. */
const SHOOTING = `4   INT. STUDY - NIGHT                              4

Mercer opens the safe.

4A  INT. STUDY - CONTINUOUS                        4A

The safe is empty.

4B  EXT. STUDY WINDOW - NIGHT                      4B

A shadow crosses the glass.

5   I/E. PATROL CAR - NIGHT                        5

Sarah watches the house.`;
{
  const r = P.parse(SHOOTING, 5);
  eq(r.scenes.length, 4, 'A/B scenes are real scene breaks');
  eq(r.scenes.map(s => s.label).join(','), '4,4A,4B,5', 'printed numbers survive');
  eq(r.scenes.map(s => s.n).join(','), '4,4,4,5', 'numeric base for arithmetic');
  eq(r.scenes[0].location, 'STUDY', 'right-margin number is not part of the location');
  eq(r.scenes[3].location, 'PATROL CAR', 'I/E heading location');
  const cs = CS.parse(SHOOTING);
  eq(cs.numbered, true, 'CScenes sees a numbered script');
  eq(cs.scenes.map(s => s.label).join(','), r.scenes.map(s => s.label).join(','),
    'labels agree with CScenes on a numbered shooting script');
  eq(cs.scenes.map(s => s.location).join('|'), r.scenes.map(s => s.location).join('|'),
    'locations agree with CScenes on a numbered shooting script');
}

/* The same shooting script flattened, as a PDF paste arrives. */
{
  const blob = SHOOTING.replace(/\s*\n\s*/g, ' ').trim();
  const locs = P.extractLocationsFromText(blob);
  for (const want of ['STUDY', 'STUDY WINDOW', 'PATROL CAR']) {
    ok(Object.prototype.hasOwnProperty.call(locs, want),
      `flattened shooting script must still yield ${want} — got ${JSON.stringify(Object.keys(locs))}`);
  }
}

/* A/B scenes must not be swallowed by the scene above them. */
{
  const r = P.parse(SHOOTING, 5);
  const study = r.scenes.find(s => s.label === '4A');
  ok(!!study, 'scene 4A exists');
  ok(JSON.stringify(r.scenes[0].shots).indexOf('safe is empty') < 0,
    "4A's content must not be swallowed into scene 4");
}

if (failures.length) {
  failures.forEach(f => console.error('  ✗ ' + f));
  console.error(`test_parser_slug_agreement: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`test_parser_slug_agreement: ${passed} passed, 0 failed`);
