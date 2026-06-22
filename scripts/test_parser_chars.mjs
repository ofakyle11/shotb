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

const result = SBParser.parse(SAMPLE, 5);
const found = new Set(Object.keys(result.characters));
const expected = ['JOHN MERCER', 'JOHN', 'SARAH COLE', 'SARAH', 'DMITRI VOLKOV', 'VOLKOV'];
const missing = expected.filter(n => !found.has(n));
const bad = [...found].filter(n => /RAIN|TIN ROOF|WAREHOUSE/i.test(n) && !['JOHN','SARAH','VOLKOV'].some(c => n.includes(c)));

const pdfBlob = SAMPLE.replace(/\n/g, ' ');
const pdfNorm = SBParser.normalizeScriptText(pdfBlob);
const pdfResult = SBParser.parse(pdfNorm, 5);
const pdfFound = Object.keys(pdfResult.characters);

console.log('=== Character extraction smoke test (parser.js) ===');
console.log('Found:', [...found].sort());
console.log('Descriptions:', Object.fromEntries(Object.entries(result.characters).filter(([,v]) => v)));
if (missing.length) {
  console.error('FAIL missing:', missing);
  process.exit(1);
}
if (bad.length) {
  console.error('FAIL false positives:', bad);
  process.exit(1);
}
if (pdfFound.length < 3) {
  console.error('FAIL PDF-normalized too sparse:', pdfFound);
  process.exit(1);
}
console.log('PDF-normalized found:', pdfFound.sort());
console.log('PASS');