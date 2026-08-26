#!/usr/bin/env node
/* EDL field injection — run: node scripts/test_edl_injection.mjs
 *
 * WHY THIS SUITE EXISTS
 *
 * CSV injection has been pinned since test_csv_injection.mjs. The other
 * line-oriented export format was not pinned at all, and it was broken in all
 * three exporters at once.
 *
 * An EDL is a sequence of records separated by newlines, and every exporter
 * built one by concatenation:
 *
 *     '* FROM CLIP NAME: ' + c.label + '\n'
 *
 * So a label carrying a newline does not produce a long label — it ENDS that
 * comment and begins a record. The reviewer who found this proved the whole
 * path: a hostile .cinamate archive survives CVault.restore() with
 * projectName = "Heist\nFCM: DROP FRAME", because projectName is neither PROSE
 * nor URLISH in the vault scrubber, so only <>"' are stripped and \n lives.
 * The finished EDL then carries FCM: DROP FRAME *above* the real
 * FCM: NON-DROP FRAME — and a CMX reader takes the first, so an entire reel
 * conforms at the wrong timecode base. A label of "Clip\n002  BX  V  C ..."
 * forges an event that was never cut.
 *
 * The existing suites could not have caught it: test_cut.mjs:83-98 and
 * test_timeline_export.mjs:125-161 assert timecode arithmetic only.
 *
 * The three exporters are checked through their REAL entry points, not through
 * the helper — a correct helper that some site forgets to call is exactly the
 * failure mode here, and testing the helper alone would report success.
 *
 * All original code, written for Cinamate.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); if (detail) console.error('     ', detail); }
}

/* The payloads. Each is a real EDL construct, not a generic "bad string": the
   point is that the field content becomes STRUCTURE. */
const FCM_FLIP = 'Heist\nFCM: DROP FRAME';
const FORGED_EVENT = 'Clip\n002  BX       V     C        00:00:00:00 00:00:04:00 00:00:00:00 00:00:04:00';
const FAKE_SOURCE = 'https://ok.test/x.mp4\n* SOURCE FILE: /etc/passwd';
const CR_ONLY = 'Title\rFCM: DROP FRAME';

/* An EDL line beginning with a digit is a record; one beginning with * is a
   comment. Both are structure, and neither may come from a field. */
function structuralLines(edl) {
  return String(edl).split('\n').map((l) => l.trim())
    .filter((l) => /^\d{3}\s/.test(l) || /^(FCM|TITLE):/.test(l));
}
function fcmCount(edl) {
  return String(edl).split('\n').filter((l) => /^FCM:/.test(l.trim())).length;
}

/* Both exporters hang themselves off `window`, and one reaches CinUrl through
   `window` while the other reaches it through the `root` its IIFE is handed.
   A single shared object satisfies both, exactly as test_timeline_export does. */
globalThis.window = globalThis.window || globalThis;

/* ── the helper ─────────────────────────────────────────────────────── */
(0, eval)(readFileSync(join(ROOT, 'js/safe-url.js'), 'utf8'));
const E = globalThis.CinUrl.edlField;

t('edlField exists and is a function', typeof E === 'function');
t('edlField folds a newline to a space', E('a\nb') === 'a b');
t('edlField folds a carriage return', E('a\rb') === 'a b');
t('edlField folds CRLF to ONE space', E('a\r\nb') === 'a b');
t('edlField folds U+2028/U+2029', E('a\u2028b\u2029c') === 'a b c');
t('edlField strips control bytes', E('a\u0000\u001Fb') === 'ab');
t('edlField caps length', E('x'.repeat(500)).length === 200);
t('edlField honours a custom cap', E('x'.repeat(500), 40).length === 40);
t('edlField leaves an ordinary label alone', E('Scene 12 - wide') === 'Scene 12 - wide');
t('edlField maps null/undefined to empty', E(null) === '' && E(undefined) === '');
/* A defanged payload must still be READABLE — a sanitiser that returns '' for
   everything would pass every assertion above and destroy real clip names. */
t('edlField preserves the text either side of the break',
  E(FCM_FLIP).includes('Heist') && E(FCM_FLIP).includes('DROP FRAME'));

/* ── exporter 1 · editor/lib-cut.js (CCut.edl) ──────────────────────── */
{
  (0, eval)(readFileSync(join(ROOT, 'editor/lib-cut.js'), 'utf8'));
  const CCut = globalThis.CCut;
  t('CCut is loaded', !!(CCut && CCut.edl));

  const out = CCut.edl({
    name: FCM_FLIP, fps: 24,
    video: [{ in: 0, out: 2, label: FORGED_EVENT },
            { in: 0, out: 2, label: 'Ordinary clip' }],
  });
  t('cut EDL: exactly one FCM line survives a project name that forges one',
    fcmCount(out) === 1, fcmCount(out) + ' FCM lines');
  t('cut EDL: the forged event does not become a record',
    structuralLines(out).filter((l) => /^002\s+BX/.test(l)).length === 0);
  t('cut EDL: the real events are still there',
    structuralLines(out).filter((l) => /^\d{3}\s+AX/.test(l)).length === 2);
  t('cut EDL: the ordinary label is untouched', out.includes('Ordinary clip'));
  t('cut EDL: no field smuggled a raw newline through',
    !/FROM CLIP NAME: [^\n]*\n[^*\d\n]/.test(out));
}

/* ── exporter 2 · timeline/timeline-export.js (SBExport.buildEDL) ───── */
{
  (0, eval)(readFileSync(join(ROOT, 'timeline/timeline-export.js'), 'utf8'));
  const SBExport = globalThis.window.SBExport;
  t('SBExport is loaded', !!(SBExport && SBExport.buildEDL));

  const out = SBExport.buildEDL([
    { num: 1, durationSec: 2, label: FORGED_EVENT, videoUrl: FAKE_SOURCE, description: FCM_FLIP },
    { num: 2, durationSec: 2, label: 'Ordinary clip', description: 'fine' },
  ], 24);
  t('timeline EDL: exactly one FCM line', fcmCount(out) === 1, fcmCount(out) + ' FCM lines');
  t('timeline EDL: the forged event does not become a record',
    structuralLines(out).filter((l) => /^002\s+BX/.test(l)).length === 0);
  /* LINES, not occurrences — and the distinction is the whole point of the fix.
     The folded payload yields ONE line reading
       * SOURCE FILE: https://ok.test/x.mp4 * SOURCE FILE: /etc/passwd
     so the marker text appears twice while the record does not. An EDL parser
     reads line by line, so text inside a value is inert; a second LINE is the
     forgery. Counting occurrences failed here and would have sent me to
     "fix" code that was already correct. */
  const sourceLines = out.split('\n').filter((l) => /^\* SOURCE FILE:/.test(l.trim()));
  t('timeline EDL: a second SOURCE FILE line cannot be smuggled in',
    sourceLines.length === 1, sourceLines.length + ' SOURCE FILE lines');
  t('timeline EDL: the smuggled path stays inside the value, not on its own line',
    sourceLines[0] && sourceLines[0].includes('/etc/passwd')
      && !/^\* SOURCE FILE: \/etc\/passwd$/m.test(out));
  t('timeline EDL: a description cannot forge an FCM',
    !/^FCM: DROP FRAME$/m.test(out));
  t('timeline EDL: the real clips are still there',
    structuralLines(out).filter((l) => /^\d{3}\s+CLIP_/.test(l)).length === 2);
}

/* ── exporter 3 · editor/timeline-engine.js ─────────────────────────── */
{
  /* This one builds its EDL inside a DOM-bound closure, so rather than boot a
     browser the file is checked structurally: every interpolated field must be
     wrapped, which is the property the other two prove behaviourally. */
  const src = readFileSync(join(ROOT, 'editor/timeline-engine.js'), 'utf8');
  const edlBlock = src.slice(src.indexOf('function exportEdl()'),
                            src.indexOf('function exportEdl()') + 1200);
  t('engine EDL: a title is wrapped', /TITLE: ' \+ E\(/.test(edlBlock));
  t('engine EDL: a clip name is wrapped', /FROM CLIP NAME: ' \+ E\(/.test(edlBlock));
  t('engine EDL: a source path is wrapped', /SOURCE FILE: ' \+ E\(/.test(edlBlock));
  t('engine EDL: no bare field interpolation remains',
    !/(?:TITLE|FROM CLIP NAME|SOURCE FILE): ' \+ (?!E\()/.test(edlBlock));
}

/* ── the scope trap, which cost a real bug during this fix ──────────── */
{
  /* timeline-export.js is window-scoped and has no `root`; lib-cut.js is
     (function (root) and has no bare `window`. The first patch used the wrong
     global in one of them, which would have thrown a ReferenceError and broken
     EDL export outright rather than failing safe. Pin both. */
  const te = readFileSync(join(ROOT, 'timeline/timeline-export.js'), 'utf8');
  const lc = readFileSync(join(ROOT, 'editor/lib-cut.js'), 'utf8');
  t('timeline-export reaches CinUrl through window (it has no `root`)',
    /window\.CinUrl/.test(te) && !/\broot\.CinUrl/.test(te));
  t('lib-cut reaches CinUrl through root (it is an IIFE taking root)',
    /root\.CinUrl/.test(lc) && /^\(function \(root\)/m.test(lc));
}

/* Every exporter keeps a local fallback so a missing safe-url.js degrades to a
   defanged field rather than a raw one. Being a fallback, nothing exercises it
   in normal runs — so it is asserted to exist. */
for (const f of ['timeline/timeline-export.js', 'editor/lib-cut.js', 'editor/timeline-engine.js']) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  t(f + ' carries an inline fallback that still folds newlines',
    /\[\\r\\n\\u2028\\u2029\]\+/.test(src));
}

console.log(`test_edl_injection: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
