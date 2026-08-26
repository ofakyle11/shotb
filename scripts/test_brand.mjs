#!/usr/bin/env node
/* Brand-kit conformance — run: node scripts/test_brand.mjs
 *
 * WHY THIS SUITE EXISTS
 *
 * docs/audit/BRAND.md ends with a list of greps that "must return zero". A
 * list of greps in a document is a rule nobody runs. Every defect asserted
 * below was actually shipped and actually fixed in 7b01cde, and each one is
 * the kind that reappears the moment someone copies a nearby rule:
 *
 *   font-weight:800 on Cinzel   — ten rules, including the wordmark on all 28
 *                                 module pages. Cinzel ships 400 and 700; the
 *                                 browser SYNTHESISES 800 by smearing the 700
 *                                 master, so the page renders a fake bold that
 *                                 looks like Cinzel until you compare it.
 *                                 Nothing errors. Nothing looks broken.
 *   negative tracking on Cinzel — five rules, tightening the exact letterforms
 *                                 the kit spaces out at +0.04..0.08em.
 *   #eab308 / #a78bfa           — a high-chroma yellow and a violet from no
 *                                 kit at all, both live in the app shell.
 *   #E8EEF4                     — five files, two hex digits off the real
 *                                 Soft Film White. Invisible by eye; only a
 *                                 machine catches it.
 *
 * The scan is textual on purpose. It does not need a browser, it runs in
 * milliseconds, and a CSS parser would not have caught the inline `style="…"`
 * attributes where two of the fake bolds were hiding.
 *
 * All original code, written for Cinamate.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); if (detail) console.error('     ', detail); }
}

/* ── the corpus ───────────────────────────────────────────────────────
 * Every .css and .html in the repo, minus the places a match would be a
 * false positive rather than a defect. */
const SKIP_DIR = new Set(['.git', 'node_modules', 'static', 'dist', '.netlify']);
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIR.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|html)$/.test(e)) files.push(p);
  }
})(ROOT);

const corpus = files.map((p) => ({
  rel: relative(ROOT, p).split('\\').join('/'),
  src: readFileSync(p, 'utf8'),
}));

t('the corpus is non-empty (a walk that finds nothing would pass everything)',
  corpus.length > 40, `found ${corpus.length} files`);

/* Report every offending file, not just the count: a bare number sends the
   next reader back to the command line to find out which file. */
function offenders(re) {
  const hits = [];
  for (const { rel, src } of corpus) {
    const m = src.match(re);
    if (m) hits.push(`${rel} (${m.length}×)`);
  }
  return hits;
}

/* ── 1 · Cinzel is never asked for a weight it does not have ──────────
 * Matched in both directions because the declaration order inside a rule is
 * arbitrary — `font-family:var(--display);…font-weight:800` and
 * `font-weight:800;…font-family:var(--display)` are the same defect, and the
 * first version of this check only caught one of them. [^}] keeps the match
 * inside a single declaration block so an 800 in the NEXT rule is not blamed
 * on this one. */
const FAKE_BOLD = [
  /var\(--display\)[^}]*font-weight:\s*(?:800|900)/g,
  /font-weight:\s*(?:800|900)[^}]*var\(--display\)/g,
];
for (const re of FAKE_BOLD) {
  const hits = offenders(re);
  t('no synthesised bold on Cinzel (it ships 400/700 only)',
    hits.length === 0, hits.join(', '));
}

/* The same trap, one alias over: --font-serif is the token name tokens.css
   gives Cinzel, and a page reaching for that name instead of --display would
   have slipped past the check above entirely. */
for (const re of [/var\(--font-serif\)[^}]*font-weight:\s*(?:800|900)/g,
                  /font-weight:\s*(?:800|900)[^}]*var\(--font-serif\)/g]) {
  const hits = offenders(re);
  t('no synthesised bold via the --font-serif alias either',
    hits.length === 0, hits.join(', '));
}

/* ── 2 · display tracking is positive ────────────────────────────────
 * The kit sets display type all-caps at +0.04em..+0.08em. Negative tracking
 * on Cinzel is always wrong, never a taste call. */
for (const re of [/var\(--display\)[^}]*letter-spacing:\s*-[0-9.]/g,
                  /letter-spacing:\s*-[0-9.][^}]*var\(--display\)/g,
                  /var\(--font-serif\)[^}]*letter-spacing:\s*-[0-9.]/g]) {
  const hits = offenders(re);
  t('display type never carries negative tracking', hits.length === 0, hits.join(', '));
}

/* ── 3 · colours from no kit ─────────────────────────────────────────
 * #eab308 marked pending/warning state — a role the kit already names
 * #C9A06C — and a high-chroma yellow on #0A1628 is precisely the neon accent
 * the kit's Avoid list rules out. #a78bfa is a violet the kit has no slot for.
 * #E8EEF4 is Soft Film White typo'd; it reads identical and is not.
 *
 * THE ONE EXEMPTION, and it is narrow: app.html's provider legend carries
 * OpenAI green, WaveSpeed sky and Grok violet to tell those services apart.
 * A brand kit does not govern a partner's colour. The exemption is keyed to
 * SB_PROVIDER_LABELS so it cannot silently widen — a new #a78bfa anywhere
 * else in app.html still fails. */
/* The last three are a distinct and sneakier failure than a wrong colour: a
   HALF-MIGRATION. All three lived on .tk-chip rules in css/cinamate-ui.css,
   where someone had moved the `color` onto a Blue Patina token and left the
   `background` literal from the previous palette behind. So each chip painted
   a pre-palette fill under a post-palette text — .warn was a yellow-gold wash
   with BLUE text sitting in it, two colours that were never meant to meet.
   Nothing looks obviously broken in a half-migrated rule, which is exactly why
   it survives a visual pass and needs a machine. */
const BANNED = { eab308: 'neon yellow (use --warn #C9A06C)',
                 a78bfa: 'off-kit violet (use --violet #8BA3B8)',
                 E8EEF4: 'typo of Soft Film White #E8EEF2',
                 D4A843: 'pre-palette gold (use --warn / --magenta)',
                 F87171: 'pre-palette red (use --error #A65D5D)',
                 '22C55E': 'pre-palette neon green (use --ok #4A8B7A)' };

/* Comments are STRIPPED, not skipped over.
   The first run of the three bans below went red on css/cinamate-ui.css — and
   the only matches were inside the comment explaining why those hexes had just
   been removed. A rule that forbids naming the thing it forbids makes the
   defect undocumentable, so the ban has to apply to declarations and not to
   prose. Same discipline as stripPrintBlocks: remove the text that is not
   code, rather than notice it and hope.
   `//` is stripped only when not preceded by `:`, so https:// URLs survive. */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
t('stripComments removes a block comment but keeps the declaration',
  stripComments('a{color:#111}/* #eab308 */b{color:#222}').replace(/\s+/g, '')
    === 'a{color:#111}b{color:#222}');
t('stripComments keeps a URL containing //',
  stripComments('@import url(https://x.test/a.css);').includes('https://x.test'));
t('stripComments removes an HTML comment',
  !stripComments('<p>x</p><!-- #eab308 -->').includes('eab308'));

/* A banned colour must be banned IN EVERY NOTATION IT CAN BE WRITTEN.
   The first version of this matched the hex string only — and every one of the
   three chip defects was authored as `rgba(248, 113, 113, .18)`, not as
   `#F87171`. Planting the rgba form to test the ban is what exposed it: the
   guard came back green on the exact bug it was written to catch. So each ban
   now matches the hex OR its decimal channel triplet, with optional spaces. */
function bannedRe(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.substr(i, 2), 16));
  return new RegExp(hex + '|' + r + '\\s*,\\s*' + g + '\\s*,\\s*' + b, 'i');
}
/* Guard the guard: a typo in bannedRe would silently disarm every ban. */
t('bannedRe matches the hex notation', bannedRe('F87171').test('color:#F87171'));
t('bannedRe matches the rgba channel notation',
  bannedRe('F87171').test('background: rgba(248, 113, 113, .18)'));
t('bannedRe does not match an unrelated colour',
  !bannedRe('F87171').test('background: rgba(166, 93, 93, .18)'));

for (const [hex, why] of Object.entries(BANNED)) {
  const re = bannedRe(hex);
  const hits = [];
  for (const { rel, src } of corpus) {
    for (const line of stripComments(src).split('\n')) {
      if (!re.test(line)) continue;
      if (/SB_PROVIDER_LABELS|'(?:xai|grok)-imagine':|'wavespeed':|'openai':/.test(line)) continue;
      hits.push(rel);
      break;
    }
  }
  t(`#${hex} does not appear outside the provider legend — ${why}`,
    hits.length === 0, hits.join(', '));
}

/* The exemption must stay real. If the legend is ever refactored away, the
   carve-out above becomes dead code that quietly permits the hex again. */
const appHtml = corpus.find((f) => f.rel === 'app.html');
t('app.html still exists and still declares the provider legend the exemption names',
  !!appHtml && /SB_PROVIDER_LABELS/.test(appHtml.src));

/* ── 4 · no second serif beside Cinzel ───────────────────────────────
 * "Never pair two serifs" is a kit rule. Playfair/Cormorant are sanctioned as
 * a landing-page TAGLINE italic only, so they are allowed on the public shell
 * and nowhere else. Space Grotesk is sanctioned nowhere. */
const grotesk = offenders(/Space\s*\+?\s*Grotesk/g);
t('Space Grotesk (an off-kit display face) appears nowhere', grotesk.length === 0, grotesk.join(', '));

const PUBLIC_SHELL = new Set(['index.html', 'cinamate/index.html', 'login.html',
                              '404.html', 'dashboard.html', 'css/theme.css']);
const strayserif = corpus
  .filter((f) => !PUBLIC_SHELL.has(f.rel) && /Playfair|Cormorant/.test(f.src))
  .map((f) => f.rel);
t('Playfair/Cormorant stay on the public shell (tagline only, never beside Cinzel in-app)',
  strayserif.length === 0, strayserif.join(', '));

/* ── 5 · the kit palette resolves to the kit values ──────────────────
 * Asserted against the token DECLARATION, not against a rendered pixel: if
 * --void stops being #0A1628 the whole platform repaints and every other
 * check here would still pass. */
const KIT = {
  '--void': '#0A1628', '--surface-1': '#12253A', '--surface-2': '#1A2F4A',
  '--cyan': '#5B8DB8', '--violet': '#8BA3B8', '--magenta': '#C9A86C',
  '--patina-hi': '#C0D0E0', '--blue-mid': '#4A6B82',
  '--text-hi': '#E8EEF2', '--text-mid': '#A0B4C8',
  '--ok': '#4A8B7A', '--warn': '#C9A06C', '--error': '#A65D5D',
};
for (const sheet of ['css/tokens.css', 'css/theme.css']) {
  const src = corpus.find((f) => f.rel === sheet)?.src || '';
  for (const [tok, hex] of Object.entries(KIT)) {
    t(`${sheet} declares ${tok}: ${hex}`,
      new RegExp(tok.replace(/-/g, '\\-') + ':\\s*' + hex + '\\s*;', 'i').test(src));
  }
}

/* ── 6 · the two sheets stay mirrored ────────────────────────────────
 * tokens.css and theme.css hand-duplicate their section 01 because the deploy
 * partitions theme.css onto the public CDN while tokens.css moves inside the
 * gate — a public sheet importing a gated one is answered with a redirect and
 * the landing page renders untokenised for every anonymous visitor. So the
 * duplication is deliberate and the DRIFT is the bug. Compared as declaration
 * text: every top-level custom property in theme.css must appear identically
 * in tokens.css. The converse is not required — tokens.css carries app-only
 * extensions theme.css has no use for. */
function decls(src) {
  const out = new Map();
  for (const m of src.matchAll(/^\s{2}(--[a-z0-9-]+):\s*([^;]+);/gim)) {
    out.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  }
  return out;
}
const themeD = decls(corpus.find((f) => f.rel === 'css/theme.css').src);
const tokensD = decls(corpus.find((f) => f.rel === 'css/tokens.css').src);
t('theme.css declares a real token block (a failed parse would vacuously pass)',
  themeD.size > 50, `parsed ${themeD.size}`);
const drift = [...themeD].filter(([k, v]) => tokensD.get(k) !== v)
  .map(([k, v]) => `${k}: theme="${v}" tokens="${tokensD.get(k) ?? '(absent)'}"`);
t('every theme.css token is byte-identical in tokens.css', drift.length === 0, drift.join(' | '));

/* ── 7 · the kit's one gradient exists ───────────────────────────────
 * Deep Navy -> Mid Blue. It had no --blue-mid to end on before 7b01cde and
 * so had simply never been built. */
for (const sheet of ['css/tokens.css', 'css/theme.css']) {
  const src = corpus.find((f) => f.rel === sheet)?.src || '';
  t(`${sheet} ships --grad-brand (Deep Navy → Mid Blue)`,
    /--grad-brand:\s*linear-gradient\([^;]*#0A1628[^;]*#4A6B82[^;]*\);/i.test(src));
}

/* ── 8 · pure black/white never becomes a dominant surface ───────────
 * The kit forbids it for SCREEN. Print is the deliberate exception: a call
 * sheet on paper needs a white page and black ink, which is why --black and
 * --white exist as tokens at all.
 *
 * So the @media print blocks must be REMOVED before scanning, not merely
 * noticed. The first version of this check tested the raw source and failed
 * on boards.css, producer.css and production/index.html — all three correct,
 * all three inside @media print. That is the same defect this suite exists to
 * catch elsewhere: a regex confident about text it does not understand.
 *
 * Brace-counted rather than regex'd, because @media print wraps whole rule
 * blocks and `[^}]*` would stop at the first inner `}` — cutting the block
 * off after one rule and leaving the rest of it in the scanned text. */
function stripPrintBlocks(src) {
  let out = '', i = 0;
  const open = /@media[^{]*\bprint\b[^{]*\{/gi;
  let m;
  while ((m = open.exec(src)) !== null) {
    if (m.index < i) continue;               // already consumed by a prior block
    out += src.slice(i, m.index);
    let depth = 1, j = open.lastIndex;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    i = j;
    open.lastIndex = j;
  }
  return out + src.slice(i);
}

/* The stripper is load-bearing enough to test directly: if it silently
   returned its input, section 8 would pass on nothing but print rules. */
t('stripPrintBlocks removes a print block and keeps the surrounding screen CSS',
  stripPrintBlocks('a{x:1}@media print{body{background:#fff}.t{display:none}}b{y:2}')
    === 'a{x:1}b{y:2}');
t('stripPrintBlocks survives a nested at-rule inside the print block',
  stripPrintBlocks('a{}@media print{@page{margin:0}body{background:#fff}}b{}') === 'a{}b{}');
t('stripPrintBlocks leaves a screen-only sheet untouched',
  stripPrintBlocks('body{background:var(--void)}') === 'body{background:var(--void)}');

const bgWhite = [];
for (const { rel, src } of corpus) {
  const screen = stripPrintBlocks(src);
  if (/\bbody\s*\{[^}]*background(?:-color)?:\s*(?:#fff\b|#ffffff\b|white\b)/i.test(screen)) bgWhite.push(rel);
}
t('no stylesheet paints the page body pure white on screen',
  bgWhite.length === 0, bgWhite.join(', '));

const bgBlack = [];
for (const { rel, src } of corpus) {
  const screen = stripPrintBlocks(src);
  if (/\bbody\s*\{[^}]*background(?:-color)?:\s*(?:#000\b|#000000\b|black\b)/i.test(screen)) bgBlack.push(rel);
}
t('no stylesheet paints the page body pure black on screen (use --void #0A1628)',
  bgBlack.length === 0, bgBlack.join(', '));

console.log(`test_brand: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
