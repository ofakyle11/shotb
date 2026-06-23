import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const parserPath = join(__dirname, '..', 'timeline', 'parser.js');
const code = readFileSync(parserPath, 'utf8');
const sandbox = { window: {}, console };
vm.runInNewContext(code, sandbox);
const SBParser = sandbox.window.SBParser;

const SAMPLE = `FADE IN:

INT. ABANDONED WAREHOUSE - NIGHT

Rain hammers the tin roof. Water drips through cracks in the ceiling.

JOHN MERCER (40s, weathered, ex-military) steps through a rusted door, pistol drawn.

JOHN
(whispering)
Sarah... you in here?

SARAH COLE (30s, sharp eyes, athletic) emerges from behind crates, hands raised.

SARAH
Took you long enough.

JOHN
Who did this?

SARAH
(bitter laugh)
Volkov's men. Three of them.

DMITRI VOLKOV (50s, silver hair, tailored suit) steps into light from a skylight.

VOLKOV
Mr. Mercer. I was hoping you'd come.

John pushes Sarah behind him, raising the pistol.

FADE OUT.`;

const VIKING = `INT. CLIFFTOP - DAY

BRANT
(to the warriors)
We ride at dawn.

RAMSEY launches himself off the cliff.

CRUMB (40s, weathered)
What are you doing?

VOLKOV
Stop them!

JOHN MERCER (40s, weathered)
Everyone calm down.`;

const NOISE = `INT. FIELD - DAY

RAIN hammers the shields. GERMAN soldiers advance. STOP Look out!`;

const TITLE_PAGE = `OPENING SEQUENCE

INT. AIRPORT - DAY

A large jet zooms overhead.

BRANT
We ride.`;

function assertChars(label, result, expected, forbidden) {
  const found = new Set(Object.keys(result.characters));
  const missing = expected.filter(n => !found.has(n));
  const bad = [...found].filter(n => forbidden.some(rx => rx.test(n)));
  console.log(`[${label}] Found:`, [...found].sort());
  if (missing.length) {
    console.error(`FAIL [${label}] missing:`, missing);
    process.exit(1);
  }
  if (bad.length) {
    console.error(`FAIL [${label}] false positives:`, bad);
    process.exit(1);
  }
}

const result = SBParser.parse(SAMPLE, 5);
assertChars('warehouse', result,
  ['JOHN MERCER', 'JOHN', 'SARAH COLE', 'SARAH', 'DMITRI VOLKOV', 'VOLKOV'],
  [/^(RAIN|WATER|TIN|WAREHOUSE|HAMMER|DRIP)$/i, /ROOF/i]);

const viking = SBParser.parse(VIKING, 5);
assertChars('viking', viking,
  ['BRANT', 'RAMSEY', 'CRUMB', 'VOLKOV', 'JOHN MERCER'],
  [/^(WARRIORS|STOP|CLIFF|LAUNCH)$/i]);

const noise = SBParser.parse(NOISE, 5);
assertChars('noise', noise, [], [/^(RAIN|GERMAN|STOP|LOOK|SHIELD|FIELD)$/i]);

const titlePage = SBParser.parse(TITLE_PAGE, 5);
assertChars('title-page', titlePage, ['BRANT'], [/OPENING|SEQUENCE/i]);

const pdfBlob = SAMPLE.replace(/\n/g, ' ');
const pdfNorm = SBParser.normalizeScriptText(pdfBlob);
const pdfLines = pdfNorm.split('\n').filter(l => l.trim()).length;
const pdfResult = SBParser.parse(pdfNorm, 5);
const pdfFound = Object.keys(pdfResult.characters);

if (pdfLines < 8) {
  console.error('FAIL unflatten too few lines:', pdfLines, pdfNorm.slice(0, 200));
  process.exit(1);
}
if (pdfFound.length < 3) {
  console.error('FAIL PDF-normalized too sparse:', pdfFound);
  process.exit(1);
}

console.log('Unflattened lines:', pdfLines);
console.log('PDF-normalized found:', pdfFound.sort());
console.log('PASS');