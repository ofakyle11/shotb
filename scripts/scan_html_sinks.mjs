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
/* Calls that already produce safe output. CinUrl.safe is the URL-context
   check — HTML escaping is not enough inside an href or src, since it does
   nothing to a javascript: scheme. escT/escH are per-module escapers. */
const SAFE_CALL = /^[\s(]*(CinUrl\.safe|esc|escT|escH|escHtml|escAttr|escape|encodeURIComponent|escapeHtml|htmlEsc|csvSafe|String\(\s*\+|Number|parseInt|parseFloat)\b/;
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
  const blank = (x) => x.replace(/[^\n]/g, ' ');
  while ((m = re.exec(src)) !== null) {
    const tag = m[1];
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag);
    const isJs = !type || /javascript|module/i.test(type[1]);
    out += blank(src.slice(last, m.index)) + blank(tag);
    out += isJs ? m[2] : blank(m[2]);      // a JSON or template <script> is data, not code
    out += blank(m[3]);
    last = m.index + m[0].length;
  }
  return out + src.slice(last).replace(/[^\n]/g, ' ');
}

const HAS_MARKUP = /<\/?[a-zA-Z][\w-]*[\s>/]|<\/[a-zA-Z]|\bdata-[a-z-]+\s*=|\b(class|id|src|href|value|title|style|alt|placeholder)\s*=\s*["']?$/;

/* Walk the source once with an explicit context stack.
 *
 * The previous detector was line-scoped: for a template literal it required
 * the backtick to be on the same line as the ${...}, so every multi-line HTML
 * template in the codebase was invisible to it. That is not a small gap —
 * app.html builds almost all of its markup that way, and a scanner that
 * reports "0 unreviewed" for a file it structurally cannot read is worse than
 * no scanner, because its silence gets mistaken for assurance.
 *
 * Contexts also stop the failure mode a flag-based version has: a regex
 * literal containing a backtick used to open a template that never closed,
 * and everything after it was reported as markup. */
function tokenize(src) {
  const out = [];
  const n = src.length;
  let i = 0, line = 1;
  const stack = [{ type: 'code', depth: 0 }];
  let lastSignificant = '';

  while (i < n) {
    const c = src[i];
    const frame = stack[stack.length - 1];

    if (frame.type === 'tpl') {
      if (c === '\\') { frame.text += src[i + 1] || ''; i += 2; continue; }
      if (c === '`') { stack.pop(); lastSignificant = '`'; i++; continue; }
      if (c === '$' && src[i + 1] === '{') {
        stack.push({ type: 'code', depth: 0, expr: '', exprLine: line,
                     capture: true, before: frame.text });
        frame.text = '';
        i += 2;
        continue;
      }
      if (c === '\n') line++;
      frame.text += c;
      i++;
      continue;
    }

    const cap = (s) => { if (frame.capture) frame.expr += s; };

    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      i = j === -1 ? n : j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j === -1 ? n : j + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end;
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^]$/.test(lastSignificant)) {
      let j = i + 1, inClass = false, ok = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        while (j + 1 < n && /[a-z]/i.test(src[j + 1])) j++;
        cap(src.slice(i, j + 1));
        i = j + 1;
        lastSignificant = '/';
        continue;
      }
    }
    if (c === '"' || c === "'") {
      const startLine = line;
      let j = i + 1, value = '';
      while (j < n) {
        if (src[j] === '\\') { value += src[j + 1] || ''; j += 2; continue; }
        if (src[j] === c) break;
        if (src[j] === '\n') line++;
        value += src[j]; j++;
      }
      out.push({ kind: 'str', value, line: startLine, start: i, end: j });
      cap(src.slice(i, j + 1));
      i = j + 1;
      lastSignificant = '"';
      continue;
    }
    if (c === '`') { stack.push({ type: 'tpl', text: '', line }); i++; continue; }
    if (c === '{') { frame.depth++; cap(c); i++; lastSignificant = '{'; continue; }
    if (c === '}') {
      if (frame.depth === 0 && frame.capture) {
        out.push({ kind: 'tpl-expr', expr: frame.expr.trim(),
                   before: frame.before, line: frame.exprLine });
        stack.pop();
        i++;
        continue;
      }
      if (frame.depth > 0) frame.depth--;
      cap(c); i++; lastSignificant = '}';
      continue;
    }
    if (c === '\n') line++;
    if (!/\s/.test(c)) lastSignificant = c;
    cap(c);
    i++;
  }
  return out;
}

const hits = [];
for (const path of walk(ROOT)) {
  const rel = relative(ROOT, path).split('\\').join('/');
  const src = jsOf(path, readFileSync(path, 'utf8'));
  const tokens = tokenize(src);
  const lines = src.split('\n');

  /* ── template literals, however many lines they span ── */
  for (const t of tokens) {
    if (t.kind !== 'tpl-expr') continue;
    if (!HAS_MARKUP.test(t.before || '')) continue;
    record(rel, t.line, t.expr, (t.before || '').slice(-90) + '${' + t.expr + '}');
  }

  /* ── concatenation: '<div>' + expr + '</div>' ──
     Still line-based, because concatenated markup in this codebase is written
     one statement per line and a token-level version would flag every string
     addition in the repo. */
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const m of line.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*([^+]+?)\s*\+\s*(['"])/g)) {
      if (!HAS_MARKUP.test(m[2])) continue;
      record(rel, i + 1, m[3].trim(), line.trim().slice(0, 150));
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
