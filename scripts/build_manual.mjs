#!/usr/bin/env node
/* Build docs/manual/manual.pdf — run: node scripts/build_manual.mjs
 *
 * HOW THIS WORKS, AND WHY IT IS SHAPED THIS WAY
 *
 * Twenty authors each write ONE body fragment, docs/manual/ch-NN-slug.html.
 * A fragment is not a document: no <html>, no <head>, no <body>. It opens with
 * <h1 class="ch"> and carries an invisible marker <span class="mk">@@CHnn@@</span>
 * immediately after that heading. This file concatenates them, wraps the result
 * once, and renders the whole book in a SINGLE chromium pass.
 *
 * One pass, not twenty. Rendering each chapter separately and merging the PDFs
 * gives every chapter its own page-1, so the page numbers in a table of
 * contents would be fiction. Continuous numbering has to come from a single
 * layout, and that is the whole reason for the fragment convention.
 *
 * THE TWO PASSES ARE FOR PAGE NUMBERS, NOT FOR LAYOUT
 *
 *   pass 1  render without a TOC, then read the text of every page and find
 *           which page each @@CHnn@@ marker landed on. That is the only
 *           trustworthy source of a page number — computing it from word
 *           counts guesses at line breaking, hyphenation and widow control.
 *   pass 2  render again WITH a contents page built from those numbers.
 *
 * Pass 2 inserts a page, which shifts everything after it. That shift is
 * applied as a constant offset, and then VERIFIED by re-reading the final PDF:
 * if a marker is not on the page the contents claims, the build fails rather
 * than shipping a manual whose page numbers are wrong. A contents page that
 * lies is worse than none.
 *
 * There are no webfonts. The manual renders offline, and a font that fails to
 * load silently reflows every page after it.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANUAL = join(ROOT, 'docs', 'manual');
const OUT = join(MANUAL, 'manual.pdf');
const WORK = join(ROOT, '.manual-build');

/* The browser. chromium-1194 is the full build; headless_shell also renders but
   the full build is what was verified against @page and page-break-before. */
const CHROME = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
].find((p) => existsSync(p));

function fail(msg) { console.error('build_manual: ' + msg); process.exit(1); }
if (!CHROME) fail('no chromium found under /opt/pw-browsers — cannot render');

/* ── collect the fragments ─────────────────────────────────────────── */
if (!existsSync(MANUAL)) fail('docs/manual does not exist — no chapters written yet');
const frags = readdirSync(MANUAL)
  .filter((f) => /^ch-\d{2}-[a-z0-9-]+\.html$/.test(f))
  .sort();
if (!frags.length) fail('docs/manual holds no ch-NN-slug.html fragments');

const chapters = [];
for (const f of frags) {
  const n = f.slice(3, 5);
  const src = readFileSync(join(MANUAL, f), 'utf8');
  /* Each of these is a real failure mode, so each is named rather than
     letting a malformed fragment quietly produce a malformed book. */
  if (/<\s*(html|head|body)\b/i.test(src)) fail(`${f} contains <html>/<head>/<body> — fragments are body content only`);
  const marker = `@@CH${n}@@`;
  if (!src.includes(marker)) fail(`${f} is missing its ${marker} marker — the contents page cannot locate it`);
  const h1 = /<h1[^>]*class="[^"]*\bch\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(src);
  if (!h1) fail(`${f} does not open with <h1 class="ch">`);
  const title = h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!title) fail(`${f} has an empty chapter title`);
  chapters.push({ file: f, n, marker, title, src });
}
console.log(`build_manual: ${chapters.length} chapters`);

/* ── the wrapper ───────────────────────────────────────────────────── */
const CSS = readFileSync(join(MANUAL, 'manual.css'), 'utf8');

function page(tocHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Cinamate — Operator's Manual</title><style>${CSS}</style></head><body>
<section class="title-page">
  <h1 class="book-title">CINAMATE</h1>
  <p class="book-sub">The Operator's Manual</p>
  <p class="book-meta">A private studio system · ${chapters.length} chapters</p>
</section>
${tocHtml}
${chapters.map((c) => c.src).join('\n\n')}
</body></html>`;
}

/* ── render ────────────────────────────────────────────────────────── */
mkdirSync(WORK, { recursive: true });
function render(html, name) {
  const htmlPath = join(WORK, name + '.html');
  const pdfPath = join(WORK, name + '.pdf');
  writeFileSync(htmlPath, html);
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox',
    '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, 'file://' + htmlPath],
    { stdio: ['ignore', 'ignore', 'ignore'] });
  if (!existsSync(pdfPath)) fail(`chromium produced no PDF for ${name}`);
  return pdfPath;
}

/* Page numbers come from the rendered document, via python+pypdf — there is no
   pure-node PDF text extractor here and guessing is not an option. */
function markerPages(pdfPath) {
  const script = `
import json, sys
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
out = {}
for i, p in enumerate(r.pages):
    for tok in (p.extract_text() or '').split():
        if tok.startswith('@@CH') and tok.endswith('@@'):
            out.setdefault(tok, i + 1)
print(json.dumps({'pages': len(r.pages), 'markers': out}))
`;
  const raw = execFileSync('python3', ['-c', script, pdfPath], { encoding: 'utf8' });
  return JSON.parse(raw);
}

console.log('build_manual: pass 1 — locating chapters');
const p1 = markerPages(render(page(''), 'pass1'));
const missing = chapters.filter((c) => !p1.markers[c.marker]);
if (missing.length) {
  fail('pass 1 could not find markers for: ' + missing.map((c) => c.file).join(', ') +
    ' — a marker inside an element the PDF text layer does not emit (display:none, ' +
    'a background image, an ::after) is invisible here. Use a visually tiny span, not a hidden one.');
}

/* The contents page is one page, inserted after the title page, so everything
   after it moves down by exactly that much. Asserted below, not assumed. */
const TOC_PAGES = 1;
const tocRows = chapters.map((c) =>
  `<li><span class="toc-n">${c.n}</span><span class="toc-t">${c.title}</span>` +
  `<span class="toc-p">${p1.markers[c.marker] + TOC_PAGES}</span></li>`).join('\n');
const toc = `<section class="toc"><h1 class="toc-h">Contents</h1><ol class="toc-list">\n${tocRows}\n</ol></section>`;

console.log('build_manual: pass 2 — rendering with contents');
const finalPdf = render(page(toc), 'pass2');
const p2 = markerPages(finalPdf);

/* VERIFY, rather than trust the offset. If a chapter grew across a page
   boundary because the contents page changed the flow, the number printed is
   wrong and the build must say so. */
const wrong = chapters.filter((c) => p2.markers[c.marker] !== p1.markers[c.marker] + TOC_PAGES);
if (wrong.length) {
  fail('the contents page numbers do not match the final render for: ' +
    wrong.map((c) => `${c.file} (says ${p1.markers[c.marker] + TOC_PAGES}, is ${p2.markers[c.marker]})`).join(', ') +
    ' — a contents page that lies is worse than none.');
}

/* ── outline ───────────────────────────────────────────────────────── */
const outlineScript = `
import sys, json
from pypdf import PdfReader, PdfWriter
src, dst, meta = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
r = PdfReader(src); w = PdfWriter()
for p in r.pages: w.add_page(p)
w.add_outline_item('Contents', 1)
for ch in meta:
    w.add_outline_item(ch['n'] + ' · ' + ch['title'], ch['page'] - 1)
with open(dst, 'wb') as fh: w.write(fh)
print(len(r.pages))
`;
const meta = chapters.map((c) => ({ n: c.n, title: c.title, page: p2.markers[c.marker] }));
mkdirSync(dirname(OUT), { recursive: true });
const pages = execFileSync('python3', ['-c', outlineScript, finalPdf, OUT, JSON.stringify(meta)],
  { encoding: 'utf8' }).trim();

rmSync(WORK, { recursive: true, force: true });
console.log(`build_manual: docs/manual/manual.pdf — ${pages} pages, ${chapters.length} chapters, outline written`);
