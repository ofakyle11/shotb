/* Every escaping helper a page calls must actually be reachable on that page.
 *
 * The escaping sweep wrapped ~425 values in esc(). On dashboard.html that
 * landed on a page which defines escHtml() and no esc(), so two renderers
 * threw ReferenceError and took the production table, the queue list, the
 * activity feed and the incentive select down with them.
 *
 * Three checks failed to notice, and each failure is instructive:
 *   · the unit suites never load a page;
 *   · the browser smoke test loads dashboard.html, which redirects to sign-in,
 *     so it ends up inspecting login.html;
 *   · a textual "is this name declared anywhere in the page's scripts" test
 *     passed, because the js/budget-engine.js the page loaded at the time did
 *     define esc() — inside an IIFE, where it is not global and dashboard.html
 *     could not see it. (That file has since been deleted as a duplicate
 *     engine; the check it defeated is the reason this suite exists.)
 *
 * So this tracks brace depth. A `function esc()` in an inline classic script
 * is global only at depth 0; in a loaded module file, only an explicit
 * window./root. assignment escapes the IIFE. That distinction is the whole
 * point — it is what the false-passing version got wrong.
 *
 * Run: node scripts/test_helpers_defined.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['.git', 'node_modules', 'static', 'assets', 'private',
  'local-backend', 'netlify-git-guard', 'docs', 'agents', 'scripts', 'netlify']);

const HELPERS = ['esc', 'escHtml', 'escAttr', 'escT', 'escH', 'jsq', 'csvSafe', 'ea', 'ex'];

/* Namespaced helpers are member calls — CinUrl.safe(x) — so the bare-name
   test below cannot see them: it looks for `name(` and this is `name.`. The
   consequence of a missing one is identical, a ReferenceError that takes the
   whole renderer down, and it was reached the same way: a sweep added
   CinUrl.safe() to a page whose script tags never loaded js/safe-url.js. */
const NAMESPACES = ['CinUrl'];

/* Strip strings, template literals, comments and regex literals, and report
   the brace depth at each surviving character. Nothing here needs to be a
   perfect JS parser — it needs to know whether a declaration sits at the top
   level of the script or inside something. */
function topLevelDeclarations(src) {
  const names = new Set();
  let depth = 0, i = 0, last = '';
  const n = src.length;
  let plain = '';
  const marks = [];

  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); i = j === -1 ? n : j; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j === -1 ? n : j + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; let j = i + 1;
      while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === q) break; j++; }
      i = j + 1; last = '"'; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^]/.test(last)) {
      let j = i + 1, cls = false, ok = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '\n') break;
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) { ok = true; break; }
        j++;
      }
      if (ok) { i = j + 1; last = '/'; continue; }
    }
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    if (!/\s/.test(c)) last = c;
    plain += c;
    marks.push(depth);
    i++;
  }

  /* function NAME( at depth 0, and var/let/const NAME = at depth 0 */
  for (const m of plain.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (marks[m.index] === 0) names.add(m[1]);
  }
  for (const m of plain.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    if (marks[m.index] === 0) names.add(m[1]);
  }
  /* explicit globals from anywhere, including inside an IIFE */
  for (const m of plain.matchAll(/\b(?:window|globalThis|root|self)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g)) {
    names.add(m[1]);
  }
  return names;
}

function walk(dir, ext, acc = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e) || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, ext, acc);
    else if (p.endsWith(ext)) acc.push(p);
  }
  return acc;
}

/* What a page can actually reach: globals from its inline scripts plus the
   explicit window./root. exports of the files it loads. */
function pageGlobals(page) {
  const src = readFileSync(page, 'utf8');
  const globals = new Set();
  let inline = '';
  const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const tag = m[1];
    const ref = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (ref) {
      const clean = ref[1].split('?')[0];
      if (/^https?:/i.test(clean)) continue;
      const target = clean.startsWith('/') ? join(ROOT, clean.slice(1)) : resolve(dirname(page), clean);
      if (!existsSync(target)) continue;
      for (const g of topLevelDeclarations(readFileSync(target, 'utf8'))) globals.add(g);
      continue;
    }
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (type && !/javascript|module/i.test(type[1])) continue;
    inline += m[2] + '\n';
    for (const g of topLevelDeclarations(m[2])) globals.add(g);
  }
  return { globals, inline };
}

/* Comments mention helpers all the time — projects/lib-vault.js explains that
   prose "is rendered as text through esc()", which is documentation, not a
   call. Strip them before deciding. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const calls = (raw, name) => {
  const body = stripComments(raw);
  const withoutDefs = body
    .replace(new RegExp('function\\s+' + name + '\\s*\\(', 'g'), '')
    .replace(new RegExp('(?:var|let|const)\\s+' + name + '\\s*=', 'g'), '');
  return new RegExp('(?<![.\\w$])' + name + '\\s*\\(').test(withoutDefs);
};

/* A bare `CinUrl.` — not `window.CinUrl`, which is the guarded form and is a
   test for existence rather than a use of it. */
const usesNamespace = (raw, name) =>
  new RegExp('(?<![.\\w$])' + name + '\\s*\\.').test(stripComments(raw));

/* Declarations ANYWHERE inside one script block, at any depth. A page that
   wraps its code in an IIFE and defines esc() inside it is perfectly correct —
   the call and the definition share a scope. What is NOT correct is calling a
   helper that only exists inside a DIFFERENT file's IIFE, which is exactly
   what dashboard.html did. So the unit of scope is the script block. */
function declaredInBlock(src) {
  const names = new Set();
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  for (const m of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  /* A single statement can declare several names — `var C = root.TCore, esc =
     C.esc, fm = C.fmtMoney;` is how every tools/*.js module picks up its
     helpers. Matching only `var NAME =` finds C and stops, which is why an
     earlier version of this check reported five files that are perfectly
     fine. Take the whole statement and pull every declarator out of it. */
  for (const stmt of src.matchAll(/\b(?:var|let|const)\s+([^;]+)/g)) {
    for (const d of stmt[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) names.add(d[1]);
  }
  return names;
}

function inlineBlocks(page) {
  const src = readFileSync(page, 'utf8');
  const out = [];
  const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(m[1]);
    if (type && !/javascript|module/i.test(type[1])) continue;
    out.push(m[2]);
  }
  return out;
}

let pass = 0, fail = 0;

for (const page of walk(ROOT, '.html')) {
  const rel = relative(ROOT, page).split('\\').join('/');
  const { globals } = pageGlobals(page);
  for (const block of inlineBlocks(page)) {
    const local = declaredInBlock(block);
    for (const name of HELPERS) {
      if (!calls(block, name)) continue;
      if (local.has(name) || globals.has(name)) { pass++; continue; }
      fail++;
      console.log(`  x ${rel} calls ${name}() — not defined in that script block, and not a global of any script the page loads`);
    }
    for (const ns of NAMESPACES) {
      if (!usesNamespace(block, ns)) continue;
      if (local.has(ns) || globals.has(ns)) { pass++; continue; }
      fail++;
      console.log(`  x ${rel} uses ${ns}.* — no script the page loads defines it`);
    }
  }
}

for (const file of walk(ROOT, '.js')) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const body = readFileSync(file, 'utf8');
  const local = declaredInBlock(body);
  /* A module that assigns root.CinUrl is the definition, not a use of one. */
  const selfDefines = topLevelDeclarations(body);
  const pagesLoading = (rel, base, dirOf) => walk(ROOT, '.html').filter((p) => {
    const pr = relative(ROOT, p).split('\\').join('/');
    if (pr.slice(0, pr.lastIndexOf('/')) !== dirOf && !readFileSync(p, 'utf8').includes('/' + rel)) return false;
    return readFileSync(p, 'utf8').includes(base);
  });
  for (const ns of NAMESPACES) {
    if (!usesNamespace(body, ns) || selfDefines.has(ns) || local.has(ns)) continue;
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    const loaders = pagesLoading(rel, base, rel.slice(0, rel.lastIndexOf('/')));
    if (loaders.length && loaders.every((l) => pageGlobals(l).globals.has(ns))) { pass++; continue; }
    fail++;
    console.log(`  x ${rel} uses ${ns}.* — ` + (loaders.length
      ? 'a page loading it does not load the script that defines it'
      : 'no page loading it was found'));
  }
  for (const name of HELPERS) {
    if (!calls(body, name)) continue;
    if (local.has(name)) { pass++; continue; }
    /* Pages reference sibling scripts relatively (src="tools-core.js"), not by
       absolute path, so match on the basename within the same directory. */
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    const dirOf = rel.slice(0, rel.lastIndexOf('/'));
    const loaders = walk(ROOT, '.html').filter((p) => {
      const pr = relative(ROOT, p).split('\\').join('/');
      if (pr.slice(0, pr.lastIndexOf('/')) !== dirOf && !readFileSync(p, 'utf8').includes('/' + rel)) return false;
      return readFileSync(p, 'utf8').includes(base);
    });
    if (loaders.length && loaders.every((l) => pageGlobals(l).globals.has(name))) { pass++; continue; }
    fail++;
    console.log(`  x ${rel} calls ${name}() — it does not define it and ` +
      (loaders.length ? 'a page loading it does not expose it globally' : 'no page loading it was found'));
  }
}

console.log(`test_helpers_defined: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
