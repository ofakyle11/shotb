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
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
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
        /* STICKY MARKUP CONTEXT, and this is a real hole that was closed.

           frame.text is reset after every interpolation, so `before` only ever
           held the text since the PREVIOUS ${}. In

               `<td>${esc(a)}${row.name}</td>`

           the first interpolation saw "<td>" and was recorded; the second saw
           "" and was invisible to this scanner — an unescaped value sitting in
           markup, reported as nothing to review. A reviewer proved it with
           fixtures: eight of sixteen sink shapes went unseen.

           Once a template literal has opened a tag, everything remaining in it
           is in markup context until the literal ends. So the frame REMEMBERS,
           and the flag rides onto the code frame with the text. */
        if (!frame.sawMarkup && HAS_MARKUP.test(frame.text)) frame.sawMarkup = true;
        stack.push({ type: 'code', depth: 0, expr: '', exprLine: line,
                     capture: true, before: frame.text, sticky: frame.sawMarkup });
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
    if (c === '`') { stack.push({ type: 'tpl', text: '', sawMarkup: false, line }); i++; continue; }
    if (c === '{') { frame.depth++; cap(c); i++; lastSignificant = '{'; continue; }
    if (c === '}') {
      if (frame.depth === 0 && frame.capture) {
        out.push({ kind: 'tpl-expr', expr: frame.expr.trim(),
                   before: frame.before, sticky: frame.sticky, line: frame.exprLine });
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
    if (!HAS_MARKUP.test(t.before || '') && !t.sticky) continue;
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
   reason. Anything NOT here is unreviewed and fails --check.
 *
 * Each entry records HOW MANY occurrences were reviewed, not merely that the
 * expression was seen once. The key is file + expression, and with no count a
 * second, third or tenth `${row.name}` added later to the same file was
 * covered by the review of the first — two genuinely new sinks were planted
 * in this repository and absorbed in exactly that way, reported as nothing.
 * Line numbers cannot be the key instead: every insertion above a sink would
 * invalidate it and the list would be noise within a week. A count moves only
 * when the number of sinks moves, which is the thing worth noticing.
 *
 * Entry shape: { "n": 2, "why": "..." }. A bare string is the old shape and
 * is treated as n = 1, so an un-migrated entry fails closed rather than open.
 * Run with --migrate to rewrite the file with today's counts. */
const ALLOW_FILE = join(ROOT, 'scripts', 'html_sinks_allow.json');
const allow = existsSync(ALLOW_FILE) ? JSON.parse(readFileSync(ALLOW_FILE, 'utf8')) : {};
const keyOf = (h) => h.file + '::' + h.expr;
const allowedCount = (key) => {
  const e = allow[key];
  if (e == null) return 0;
  if (typeof e === 'string') return 1;
  return typeof e.n === 'number' && e.n >= 0 ? e.n : 0;
};

/* `--only a/b.js,c/d.html` narrows the report to one worker's files. */
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean)) : null;

/* `--counts` prints what the scan ACTUALLY found, as JSON, keyed the same way
   as the allow-list.

   It exists because test_html_sinks.mjs could not tell a live entry from a
   dead one. Its staleness check read `allow[k].n === 0` — the RECORDED count —
   so an entry budgeting 18 occurrences of code that has since been deleted
   never fired, and 25 of 119 entries had drifted that way, holding 54 free
   slots open for future sinks to land in unreviewed. A reviewer proved the
   consequence: five raw `${si}` interpolations planted into app.html markup,
   two of them inside attributes, and `--check` still reported "0 unreviewed"
   and exited 0.

   The recorded count can only ever describe the past. Comparing it against
   this is what makes the ledger honest. */
if (process.argv.includes('--counts')) {
  const counts = {};
  for (const h of hits) counts[keyOf(h)] = (counts[keyOf(h)] || 0) + 1;
  console.log(JSON.stringify(counts, null, 1));
  process.exit(0);
}

if (process.argv.includes('--migrate')) {
  const counts = {};
  for (const h of hits) counts[keyOf(h)] = (counts[keyOf(h)] || 0) + 1;
  const out = {};
  for (const key of Object.keys(allow).sort()) {
    const e = allow[key];
    const why = typeof e === 'string' ? e : (e && e.why) || '';
    /* An entry whose sinks have gone drops to n:0, which is what makes it
       visible to the staleness check rather than dead weight holding slots
       open. (This comment previously claimed the opposite — that n was kept
       from the old shape — describing a fail-closed behaviour the code has
       never had. It was the stale comment on the stale-entry detector.) */
    out[key] = { n: counts[key] || 0, why };
  }
  writeFileSync(ALLOW_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`migrated ${Object.keys(out).length} entries to counted form`);
  process.exit(0);
}

/* Occurrences beyond the reviewed count are the unreviewed ones. Ordering by
   line makes "the extra one" the last, which is usually the newly added
   sink — and always, at minimum, points at one that nobody has read. */
const seen = {};
const unlisted = hits.filter((h) => {
  const key = keyOf(h);
  seen[key] = (seen[key] || 0) + 1;
  return seen[key] > allowedCount(key);
}).filter((h) => !only || only.has(h.file));
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
