/* Find values interpolated into HTML strings without escaping.
 *
 * The security review kept reporting the same shape of bug in different
 * modules — a field nobody thought of ('dn', 'srcId', 'durationSec',
 * 'lensMm', 'rot', 'sec') dropped straight into markup. Fixing them one
 * report at a time only ever closes the ones somebody happened to look at,
 * so this enumerates every one of them instead.
 *
 * Heuristic, deliberately noisy on the safe side: it flags an interpolation
 * that lands inside a string containing markup and is not already wrapped in
 * an escaping call. Numeric literals, constants and known-safe helpers are
 * filtered out; whatever is left is read by hand.
 *
 *   node scripts/scan_html_sinks.mjs            # report
 *   node scripts/scan_html_sinks.mjs --check    # exit 1 if anything is unlisted
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIR = new Set(['.git', 'node_modules', 'static', 'assets', 'private',
  'local-backend', 'netlify-git-guard', 'docs', 'agents']);

/* Calls that already produce safe output. */
const SAFE_CALL = /^(esc|escAttr|escape|encodeURIComponent|escapeHtml|htmlEsc|csvSafe|String\(\s*\+|Number|parseInt|parseFloat)\b/;
/* Expressions that cannot carry markup: numbers, arithmetic, .length, indexes,
   .toFixed(), template counters, and boolean-picked literal strings. */
const NUMERIC = /^[\s()]*[-+]?(\d[\d_.eE+-]*|[A-Za-z_$][\w$.]*\s*\.\s*(length|size)|[A-Za-z_$][\w$.]*\s*\.\s*to(Fixed|Precision)\s*\([^)]*\))[\s()]*$/;
const ARITH = /^[^'"`]*[-+*/%][^'"`]*$/;

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIR.has(e) || e.charAt(0) === '.') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(js|html)$/.test(p)) acc.push(p);
  }
  return acc;
}

/* Pull the JS out of an .html file so line numbers still line up. */
function jsOf(path, src) {
  if (!path.endsWith('.html')) return src;
  let out = '';
  const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
  let last = 0, m;
  while ((m = re.exec(src)) !== null) {
    out += src.slice(last, m.index).replace(/[^\n]/g, ' ');
    out += m[1].replace(/[^\n]/g, ' ') + m[2] + m[3].replace(/[^\n]/g, ' ');
    last = m.index + m[0].length;
  }
  return out + src.slice(last).replace(/[^\n]/g, ' ');
}

const HAS_MARKUP = /<\/?[a-zA-Z][\w-]*[\s>/]|<\/[a-zA-Z]|\bdata-[a-z-]+=|\b(class|id|src|href|value|title|style)\s*=\s*["']?$/;

const hits = [];
for (const path of walk(ROOT)) {
  const rel = relative(ROOT, path).split('\\').join('/');
  const raw = readFileSync(path, 'utf8');
  const src = jsOf(path, raw);
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;

    /* ── template literals: ${ ... } inside a backtick string with markup ── */
    for (const m of line.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const before = line.slice(0, m.index);
      if (!before.includes('`')) continue;
      if (!HAS_MARKUP.test(before) && !/<[a-zA-Z]/.test(line)) continue;
      record(rel, lineNo, m[1].trim(), line);
    }

    /* ── concatenation: '<div>' + expr + '</div>' ── */
    for (const m of line.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*([^+]+?)\s*\+\s*(['"])/g)) {
      const lit = m[2];
      if (!HAS_MARKUP.test(lit)) continue;
      record(rel, lineNo, m[3].trim(), line);
    }
  });
}

function record(file, line, expr, ctx) {
  const e = expr.trim();
  if (!e || SAFE_CALL.test(e)) return;
  if (NUMERIC.test(e)) return;
  if (/^['"`]/.test(e)) return;                       // a literal
  if (/^[A-Z][A-Z0-9_]*(\[|\.|$)/.test(e)) return;    // module constant table
  if (/\?.*:/.test(e) && !/[+]/.test(e) && /['"]/.test(e)) return; // picks between literals
  if (ARITH.test(e) && !/['"`]/.test(e) && !/\besc\b/.test(e)) {
    // arithmetic on identifiers — still worth seeing if it is a bare field
    if (/[-*/%]/.test(e)) return;
  }
  hits.push({ file, line, expr: e, ctx: ctx.trim().slice(0, 150) });
}

/* Reviewed and accepted: each of these was read and is safe for the stated
   reason. Anything NOT here is unreviewed and fails --check. */
const ALLOW_FILE = join(ROOT, 'scripts', 'html_sinks_allow.json');
const allow = existsSync(ALLOW_FILE) ? JSON.parse(readFileSync(ALLOW_FILE, 'utf8')) : {};
const keyOf = (h) => h.file + '::' + h.expr;

/* `--only a/b.js,c/d.html` narrows the report to one worker's files. */
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean)) : null;

const unlisted = hits.filter((h) => !allow[keyOf(h)]).filter((h) => !only || only.has(h.file));
const byFile = {};
for (const h of unlisted) (byFile[h.file] = byFile[h.file] || []).push(h);

const names = Object.keys(byFile).sort();
for (const f of names) {
  console.log('\n' + f);
  for (const h of byFile[f]) console.log(`  ${String(h.line).padStart(5)}  ${h.expr}`);
}
console.log(`\n${hits.length} interpolations scanned · ${unlisted.length} unreviewed in ${names.length} files`);

if (process.argv.includes('--check') && unlisted.length) {
  console.error('\nUnreviewed HTML interpolations — escape them, or add them to scripts/html_sinks_allow.json with a reason.');
  process.exit(1);
}
