#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   The assurance layer — tests about the tests.

   Phase 1 found five distinct ways this suite stayed green while real defects
   shipped. Each one is a class, not an incident, so each gets a structural
   check here rather than a patch in the suite that missed it:

     1  A fixture invents a shape no writer produces.
        test_modules.mjs built a take with `status:'print'` and a `date`.
        Nothing in the app writes either field, so `printedCount` was
        permanently 0 and the assertion that "1 take printed" passed on a
        number the real store can never produce.
        → ROUND TRIP: build every fixture row from the WRITER's declared
          shape, read it with the REAL reader through a recording Proxy, and
          report every field the reader consulted that no writer emits.

     2  Two tests pin contradictory answers.
        test_set.mjs asserts a 35mm reads 54.4°; test_set3d.mjs asserts a
        50mm reads 27.9°. Those are a 36mm sensor and a 24.89mm sensor. The
        suite enforced the contradiction: fixing either module alone turns it
        red, so nobody did.
        → AGREEMENT: where one concept has more than one implementation,
          either the copies are textually identical, or a case here runs both
          and asserts they answer the same.

     3  A live engine no suite loads.
        js/budget-engine.js is 1,082 lines on the dashboard and no suite ever
        evaluated a line of it.
        → COVERAGE: enumerate every shipped .js under the real deploy rules
          and assert each is executed by at least one suite.

     4  Fixtures dodge the input class where the bug lives.
        Nothing in the money slice used a value with cents; no script fixture
        carried an A-scene or a FADE IN: preamble — the two inputs that break
        page count and scene numbering.
        → INPUTS: a suite exercising a money module must use a non-round
          amount; a suite carrying a screenplay fixture must carry both an
          A-scene and a preamble.

     5  Glob discovery hides untested modules.
        run_all_tests.mjs discovers by globbing scripts/test_*.mjs, so a
        module with no suite is not a failure — it is an absence. COVERAGE
        above is the detection; scripts/test_safety.mjs is the answer for the
        module that had none of its own.

   Violations that belong to another wave are NOT fixed here and do NOT turn
   the suite red. They go in scripts/assurance_exceptions.json, in the shape
   scripts/scan_html_sinks.mjs already uses: every entry carries a COUNT and a
   written reason, the check fails when a count GROWS or a new key appears,
   and --migrate records today's numbers for keys already listed. A named
   exception with a reason is honest. A silent pass is not.

   HOW TO READ scripts/assurance_exceptions.json (baseline set by order G0-R3a).
   Every one of its keys was read against the code before it was written down,
   and each reason opens with one of three words:

     DEFECT  a real bug. It is listed rather than fixed because that order
             owned no module source, and the reason names the backlog item
             that must clear it. A DEFECT entry is a debt, not a dispensation:
             the right outcome is that the key disappears, never that it is
             re-listed at a higher count.
     SAFE    the violation is a true statement about the code and the code is
             nonetheless correct, with the substantive reason why. These are
             the entries that may legitimately live here forever.
     UNSURE  appears inside a reason to mark a judgement a second reviewer
             should re-derive rather than inherit.

   The COUNT is what makes a SAFE entry safe. `esc` is accepted at eight
   drifted versions because all eight escape the identical character class;
   the ninth is unlisted and fails, because a new escaper is the event worth
   stopping on. Nothing here is silenced by name.

   Owners are named by the backlog item in docs/audit/PHASE1-SYNTHESIS.md
   (wave 1.1 .. 3.x), NOT by Phase 2 team number: PROGRAM.md names only the
   spine T5 -> T6 -> T7 and the Phase 3 T1a/T1b/T2 split and carries no T1-T10
   roster to map onto. Remap when that roster exists.

     node scripts/test_assurance.mjs
     node scripts/test_assurance.mjs --migrate   # re-record listed counts
     node scripts/test_assurance.mjs --verbose   # show what passed too
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXC_FILE = join(ROOT, 'scripts', 'assurance_exceptions.json');
const VERBOSE = process.argv.includes('--verbose');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

/* ── violation ledger ──────────────────────────────────────────────────── */
const violations = [];   // { check, key, detail }
const notes = [];        // things worth printing that are not violations
function flag(check, key, detail) { violations.push({ check, key, detail }); }
function note(s) { notes.push(s); }

/* ═══ shipped-file census, from the real deploy rules ══════════════════════
   Parsed out of scripts/deploy_cinamate.mjs rather than restated here: if the
   deploy rules change, "shipped" changes with them and coverage follows. A
   restated copy is exactly the drift this file exists to catch. */
function deployExclusions() {
  const src = readFileSync(join(ROOT, 'scripts', 'deploy_cinamate.mjs'), 'utf8');
  const m = /const\s+EXCLUDE\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!m) throw new Error('cannot read EXCLUDE from scripts/deploy_cinamate.mjs — coverage would be guessing');
  const names = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] || x[2]);
  if (!names.length) throw new Error('EXCLUDE in deploy_cinamate.mjs parsed empty');
  return new Set(names);
}
const EXCLUDE = deployExclusions();
/* Not deployed, but also not module code: vendored bundles and binary drops. */
const EXTRA_SKIP = new Set(['static', 'assets']);

function walkJs(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e.charAt(0) === '.' || EXCLUDE.has(e) || EXTRA_SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkJs(p, acc);
    else if (e.endsWith('.js')) acc.push(p);
  }
  return acc;
}
const SHIPPED = walkJs(ROOT).map(rel).sort();

function walkAll(dir, exts, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e.charAt(0) === '.' || EXCLUDE.has(e) || EXTRA_SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkAll(p, exts, acc);
    else if (exts.some((x) => e.endsWith(x))) acc.push(p);
  }
  return acc;
}
const SHIPPED_SRC = walkAll(ROOT, ['.js', '.html']).map(rel).sort();
const src = (() => {
  const cache = new Map();
  return (r) => {
    if (!cache.has(r)) cache.set(r, readFileSync(join(ROOT, r), 'utf8'));
    return cache.get(r);
  };
})();

/* Suites are discovered the same way run_all_tests.mjs discovers them, so a
   suite added tomorrow counts tomorrow with nothing to update here. */
const SUITES = readdirSync(join(ROOT, 'scripts'))
  .filter((e) => /^test_.*\.mjs$/.test(e) && e !== 'test_assurance.mjs')
  .map((e) => 'scripts/' + e).sort();

/* ═══ evaluating a module the way the browser does ═════════════════════════
   Every module is an IIFE that hangs its API off `window` or `globalThis`.
   Running one in its own vm context gives back exactly the public surface the
   pages get, with no cross-contamination between two modules that export the
   same name — which matters, because two of them do. */
function evalOnce(paths, extraGlobals) {
  const ctx = vm.createContext(Object.assign({
    console, Math, JSON, Date, isFinite, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent,
    Intl, Promise, RegExp, Error, TextEncoder, TextDecoder,
  }, extraGlobals || {}));
  const before = new Set(Object.keys(ctx));
  for (const p of paths) vm.runInContext(src(p), ctx, { filename: p, timeout: 8000 });
  const api = {};
  for (const k of Object.keys(ctx)) if (!before.has(k)) api[k] = ctx[k];
  return api;
}
/* Modules that need another module loaded first say so, by name, in the error
   they throw. Reading the dependency out of the message rather than keeping a
   table here means the wiring follows the code: when wave 1.1 repointed nine
   modules at js/lib-scenes.js mid-audit, this kept working with no edit. */
function depFromError(e, list) {
  for (const m of String((e && e.message) || '').matchAll(/([A-Za-z0-9_./-]+\.js)/g)) {
    const f = SHIPPED.find((x) => x === m[1] || x.endsWith('/' + m[1]));
    if (f && !list.includes(f)) return f;
  }
  return null;
}
function evalModule(paths, extraGlobals) {
  let list = [].concat(paths);
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return evalOnce(list, extraGlobals); }
    catch (e) {
      const hit = depFromError(e, list);
      if (!hit) throw e;
      list = [hit].concat(list);
    }
  }
  return evalOnce(list, extraGlobals);
}
function tryEvalModule(paths, extraGlobals) {
  try { return evalModule(paths, extraGlobals); } catch { return null; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 1 — ROUND TRIP: the reader's expectations against the writer's output
   ═════════════════════════════════════════════════════════════════════════ */

/* Writer shapes are read out of the code that does the writing. Most SB_*
   registers are declared as a TCore.Register schema — `key`, a `fields` list
   of {id,label,type,options} and sometimes a `blank()`. Those field ids ARE
   the row shape: Register.add stamps an `id` and stores exactly the fields the
   schema declares. Nothing else is ever written. */
function schemaAt(text, from) {
  /* Walk forward from `key: 'SB_x'` through the enclosing object literal,
     capturing `fields:` and `blank:` at depth 0 of that object. */
  let depth = 0, i = from, fields = null, blank = null;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') { if (depth === 0) break; depth--; }
    else if (depth === 0 && /[A-Za-z_$]/.test(c)) {
      const w = /^[A-Za-z_$][\w$]*/.exec(text.slice(i))[0];
      const after = text.slice(i + w.length).replace(/^\s*/, '');
      if (w === 'fields' && after.startsWith(':')) {
        const s = text.indexOf('[', i);
        fields = balanced(text, s, '[', ']');
        i = s + (fields ? fields.length : 1);
        continue;
      }
      if (w === 'blank' && after.startsWith(':')) {
        const s = text.indexOf('{', text.indexOf('return', i) >= 0 ? text.indexOf('return', i) : i);
        blank = balanced(text, s, '{', '}');
        i = s + (blank ? blank.length : 1);
        continue;
      }
      i += w.length;
      continue;
    }
    i++;
  }
  return { fields, blank };
}
function balanced(text, start, open, close) {
  if (start < 0) return null;
  let d = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) d++;
    else if (text[i] === close) { d--; if (d === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/* store key -> { fields: [{id,type,options,label}], where: 'file:line' } */
const WRITER_SHAPES = new Map();
for (const f of SHIPPED_SRC) {
  const text = src(f);
  for (const m of text.matchAll(/key\s*:\s*['"](SB_[A-Za-z0-9_]+)['"]/g)) {
    const { fields, blank } = schemaAt(text, m.index + m[0].length);
    if (!fields) continue;
    const list = [];
    for (const fm of fields.matchAll(/\{\s*id\s*:\s*['"]([^'"]+)['"]([\s\S]*?)\}/g)) {
      const tail = fm[2];
      const type = /type\s*:\s*['"]([^'"]+)['"]/.exec(tail);
      const opts = /options\s*:\s*\[([\s\S]*?)\]/.exec(tail);
      const label = /label\s*:\s*['"]([^'"]*)['"]/.exec(tail);
      list.push({
        id: fm[1],
        type: type ? type[1] : 'text',
        label: label ? label[1] : fm[1],
        options: opts ? [...opts[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]) : null,
      });
    }
    if (blank) {
      for (const bm of blank.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
        if (!list.some((x) => x.id === bm[1])) list.push({ id: bm[1], type: 'text', label: bm[1], options: null });
      }
    }
    if (!list.length) continue;
    const line = text.slice(0, m.index).split('\n').length;
    WRITER_SHAPES.set(m[1], { fields: list, where: f + ':' + line });
  }
}

/* Every SB_* store the shipped code touches, so a store with no derivable
   writer shape is visible as an absence rather than simply missing. */
const ALL_STORES = new Set();
for (const f of SHIPPED_SRC) {
  for (const m of src(f).matchAll(/\bSB_[A-Za-z0-9_]*_v\d+\b/g)) ALL_STORES.add(m[0]);
}

/* A row built strictly from the writer's declared fields. A select takes a
   real option — the second where there is one, since the first is usually the
   neutral/empty state and a fixture that only ever exercises the neutral state
   is how mode 4 happens. A money-ish field takes cents, for the same reason. */
const MONEYISH = /(^|[^a-z])(rate|fee|amount|amt|est|total|cost|price|budget|pay|day)($|[^a-z])/i;
const FIXTURE_DATE = '2026-08-20';
function fixtureRow(shape, idx) {
  const row = { id: 'row' + (idx + 1) };
  for (const f of shape.fields) {
    if (f.id === 'id') continue;
    if (f.options && f.options.length) row[f.id] = f.options[Math.min(1, f.options.length - 1)];
    else if (f.type === 'date') row[f.id] = FIXTURE_DATE;
    else if (MONEYISH.test(f.id) || MONEYISH.test(f.label)) row[f.id] = '1234.56';
    else row[f.id] = f.id === 'scene' ? '12' : f.label + ' 1';
  }
  return row;
}
/* The recording Proxy is the whole point: it does not guess what a reader
   might want, it observes what the reader actually asks for. */
const IGNORED_PROPS = new Set(['then', 'toJSON', 'constructor', 'valueOf', 'toString',
  'hasOwnProperty', 'length', 'inspect', 'nodeType', 'call', 'apply', 'splice']);
function recordingRow(row, seen) {
  return new Proxy(row, {
    get(t, p) {
      if (typeof p === 'string' && !IGNORED_PROPS.has(p) && !(p in t)) seen.add(p);
      return t[p];
    },
    has(t, p) { if (typeof p === 'string' && !(p in t)) seen.add(p); return p in t; },
  });
}

/* Readers are the real functions the pages call, wired to the real stores they
   read. Each entry names the module file, so the wiring breaks loudly if a
   module moves rather than silently covering nothing. */
const READERS = [
  {
    id: 'CProd.dpr',
    files: ['production/lib-prod.js'],
    stores: ['SB_TakeLog_v1', 'SB_Timecards_v1', 'SB_HotCost_v1'],
    run(api, rows) {
      return api.CProd.dpr({
        takes: rows('SB_TakeLog_v1'),
        timecards: rows('SB_Timecards_v1'),
        hotcost: rows('SB_HotCost_v1'),
        board: { scenes: [{ day: 0 }] },
        plan: { date: FIXTURE_DATE },
        timeline: { projectName: 'Round Trip' },
      }, { date: FIXTURE_DATE, notes: '' });
    },
  },
  {
    id: 'CAdvisor.prepActions',
    files: ['workflow/advisor.js'],
    stores: ['SB_Roles_v1', 'SB_Crew_v1', 'SB_Locations_v1', 'SB_Insurance_v1',
             'SB_Clearance_v1', 'SB_Delivery_v1'],
    run(api, rows) {
      return api.CAdvisor.prepActions({
        timeline: { scriptText: 'INT. ROOM - DAY\nA round trip.', clips: [{ videoUrl: 'x', status: 'approved' }] },
        sheet: { categories: [{ acct: '2000', items: [{ est: 100 }] }] },
        budgetPrefs: { incentive: 'ontario' },
        roles: rows('SB_Roles_v1'),
        crew: rows('SB_Crew_v1'),
        locations: rows('SB_Locations_v1'),
        insurance: rows('SB_Insurance_v1'),
        clearance: rows('SB_Clearance_v1'),
        delivery: rows('SB_Delivery_v1'),
        plan: { date: FIXTURE_DATE },
        cut: { project: { video: [{}] }, lastExport: 1 },
      });
    },
  },
  {
    id: 'CDeal.fromCrewRow',
    files: ['contracts/lib-deal.js'],
    stores: ['SB_Crew_v1'],
    run(api, rows) {
      return rows('SB_Crew_v1').map((r) => {
        const fields = api.CDeal.fromCrewRow(r, 'Round Trip');
        api.CDeal.dealValue(fields);
        return fields;
      });
    },
  },
  {
    id: 'CFest.feesTotal/upcoming/resultCounts',
    files: ['festivals/lib-fest.js'],
    stores: ['SB_Festivals_v1'],
    run(api, rows) {
      const r = rows('SB_Festivals_v1');
      api.CFest.feesTotal(r);
      api.CFest.upcoming(r, FIXTURE_DATE);
      api.CFest.resultCounts(r);
      return r;
    },
  },
];

const readerStores = new Set();
for (const r of READERS) r.stores.forEach((s) => readerStores.add(s));

for (const r of READERS) {
  const missing = r.files.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) { flag('roundtrip', 'reader:' + r.id, `module moved or gone: ${missing.join(', ')}`); continue; }
  const seenByStore = new Map();
  const rowsFor = (key) => {
    const shape = WRITER_SHAPES.get(key);
    if (!shape) return [];
    const seen = seenByStore.get(key) || new Set();
    seenByStore.set(key, seen);
    return [0, 1].map((i) => recordingRow(fixtureRow(shape, i), seen));
  };
  /* A module may defer its dependency check to CALL time rather than load time:
     contracts/lib-deal.js evaluates fine on its own and only asks for
     CMoneyMath when a deal is actually valued. evalModule resolves a name out
     of the load-time error; the run needs the same resolution, or the reader
     throws, the loop `continue`s, and the round trip for that store is never
     run at all — which reads on the report as one line rather than as the
     missing check it is. This is the exact "green over a check that did not
     execute" shape the file exists to catch, so it must not be one here. */
  let list = [].concat(r.files), api = null, ran = false, lastErr = null;
  for (let attempt = 0; attempt < 6 && !ran; attempt++) {
    api = tryEvalModule(list);
    if (!api) break;
    for (const s of seenByStore.values()) s.clear();
    try { r.run(api, rowsFor); ran = true; }
    catch (e) {
      lastErr = e;
      const hit = depFromError(e, list);
      if (!hit) break;
      list = [hit].concat(list);
    }
  }
  if (!api) { flag('roundtrip', 'reader:' + r.id, `${list.join(', ')} would not evaluate`); continue; }
  if (!ran) { flag('roundtrip', 'reader:' + r.id, 'reader threw on writer-shaped rows: ' + (lastErr && lastErr.message)); continue; }
  for (const key of r.stores) {
    const shape = WRITER_SHAPES.get(key);
    if (!shape) { flag('roundtrip', 'shape:' + key, `${r.id} reads ${key} and no writer shape is derivable from the code`); continue; }
    const seen = seenByStore.get(key) || new Set();
    for (const p of [...seen].sort()) {
      flag('roundtrip', `${key}.${p}`,
        `${r.id} reads .${p} on a ${key} row; the writer at ${shape.where} emits only [${shape.fields.map((f) => f.id).join(', ')}]`);
    }
    if (!seen.size && VERBOSE) note(`  round-trip ok   ${key} → ${r.id}`);
  }
}
/* Stores nobody round-trips are where mode 1 can still happen. One key with a
   count, not one key each: the number is the thing to watch, and it can only
   go down as later waves wire readers. A store added without a round-trip
   pushes it up and fails. */
const uncoveredStores = [...ALL_STORES].sort().filter((k) => !readerStores.has(k));
for (const key of uncoveredStores) {
  flag('roundtrip', 'uncovered-stores',
    `${uncoveredStores.length} SB_* stores have no round-trip: ` +
    uncoveredStores.map((k) => k + (WRITER_SHAPES.has(k) ? '*' : '')).join(', ') +
    '   (* = a writer shape is already derivable, so a reader case is cheap)');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 2 — AGREEMENT: two implementations of one concept must answer alike
   ═════════════════════════════════════════════════════════════════════════ */

/* (a) Textual: the same function name defined in more than one shipped file.
   Identical copies agree by construction — that is duplication for wave 1 to
   delete, not a correctness risk. Copies that have DRIFTED are the risk, and
   drift is what this counts. */
function functionBodies(text) {
  const out = [];
  for (const m of text.matchAll(/(^|[^.\w$])function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g)) {
    const openAt = text.indexOf('{', m.index + m[0].length - 1);
    const body = balanced(text, openAt, '{', '}');
    if (body) out.push({ name: m[2], params: m[3], body });
  }
  return out;
}
const norm = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ')
  .replace(/\s+/g, ' ')
  .trim();

/* Two functions sharing a name are not automatically two implementations of
   one concept: every page has its own render() and they are unrelated code.
   Copy-paste drift looks different — the bodies are mostly the same tokens
   with a few changed. Token overlap separates the two, so the check reports
   drifted copies and stays quiet about coincidental names. */
const tokensOf = (s) => s.match(/[A-Za-z_$][\w$]*|\d+|\S/g) || [];
function similarity(a, b) {
  const ca = new Map(), cb = new Map();
  for (const t of tokensOf(a)) ca.set(t, (ca.get(t) || 0) + 1);
  for (const t of tokensOf(b)) cb.set(t, (cb.get(t) || 0) + 1);
  let inter = 0, uni = 0;
  for (const k of new Set([...ca.keys(), ...cb.keys()])) {
    const x = ca.get(k) || 0, y = cb.get(k) || 0;
    inter += Math.min(x, y); uni += Math.max(x, y);
  }
  return uni ? inter / uni : 1;
}
const COPY_SIMILARITY = 0.55;  // below this they are different code, same name
const REAL_LOGIC = 140;        // chars of normalised body; a one-liner is a helper

const byName = new Map();
for (const f of SHIPPED) {
  for (const fn of functionBodies(src(f))) {
    if (!byName.has(fn.name)) byName.set(fn.name, new Map());
    const m = byName.get(fn.name);
    if (!m.has(f)) m.set(f, norm('(' + fn.params + ')' + fn.body));   // first definition per file
  }
}
let identicalGroups = 0, coincidental = 0;
for (const [name, perFile] of [...byName].sort()) {
  if (perFile.size < 2) continue;
  const entries = [...perFile];
  const variants = new Map();
  for (const [file, sig] of entries) {
    if (!variants.has(sig)) variants.set(sig, []);
    variants.get(sig).push(file);
  }
  if (variants.size < 2) { identicalGroups++; continue; }
  const sigs = [...variants.keys()];
  const drifted = sigs.some((a, i) => sigs.slice(i + 1).some((b) =>
    Math.max(a.length, b.length) >= REAL_LOGIC && similarity(a, b) >= COPY_SIMILARITY));
  if (!drifted) { coincidental++; continue; }
  const shown = [...variants.values()].map((v) => v.join('+'));
  flag('agreement', 'drift:' + name,
    `${name}() is copied into ${perFile.size} shipped files and has drifted into ${variants.size} versions: ` +
    shown.slice(0, 4).join(' | ') + (shown.length > 4 ? ` | …and ${shown.length - 4} more` : ''));
}
note(`  agreement: ${identicalGroups} duplicated names are byte-identical across their copies; ` +
  `${coincidental} more share a name but not an implementation`);

/* (b) Behavioural: run both implementations and compare the answer. These are
   the concepts where drift is not cosmetic — the ones two suites currently pin
   to two different values. */

/* The lens. Three sensor assumptions ship in one product. */
{
  const set2 = tryEvalModule(['sets/lib-set.js']);
  const set3 = tryEvalModule(['sets/lib-set3d.js']);
  const media = tryEvalModule(['tools/lib-media.js']);
  if (set2 && set3 && media && set2.CSet && set3.CSet3D && media.TMedia) {
    for (const mm of [18, 35, 50, 85]) {
      const a = set2.CSet.fovDeg(mm);
      const b = set3.CSet3D.lensFov(mm, false);
      const c = media.TMedia.lensCalc('super35', mm).hfov;
      const spread = Math.max(a, b, c) - Math.min(a, b, c);
      if (spread > 0.5) {
        flag('agreement', 'lens:' + mm + 'mm',
          `a ${mm}mm reads ${a.toFixed(1)}° in CSet.fovDeg (sets/lib-set.js), ` +
          `${b.toFixed(1)}° in CSet3D.lensFov (sets/lib-set3d.js) and ` +
          `${c.toFixed(1)}° in TMedia.lensCalc super35 (tools/lib-media.js) — ${spread.toFixed(1)}° apart`);
      } else if (VERBOSE) note(`  lens ok         ${mm}mm agrees to ${spread.toFixed(2)}°`);
    }
  } else {
    flag('agreement', 'lens:modules', 'the three lens implementations could not all be evaluated');
  }
}

/* The scene split. Eight-plus copies, and the numbers they print are what the
   props breakdown and the risk assessment cite to each other. */
const SCRIPT_FIXTURE = [
  'FADE IN:',
  '',
  '1  INT. FARMHOUSE KITCHEN - NIGHT',
  '',
  'Maggie sets the table. A shotgun leans by the door.',
  '',
  '1A  INT. FARMHOUSE HALL - CONTINUOUS',
  '',
  'She carries the plates through.',
  '',
  '2  EXT. COUNTRY ROAD - DAY',
  '',
  'A rusted truck rattles past.',
  '',
].join('\n');
{
  const impls = [];
  for (const f of SHIPPED) {
    if (!/\bsplitScenes\b/.test(src(f))) continue;
    const api = tryEvalModule([f]);
    if (!api) continue;
    for (const [ns, v] of Object.entries(api)) {
      if (v && typeof v === 'object' && typeof v.splitScenes === 'function') {
        impls.push({ file: f, call: (t) => v.splitScenes(t), label: ns + '.splitScenes' });
      }
    }
  }
  if (impls.length < 2) {
    flag('agreement', 'splitScenes:modules', `only ${impls.length} runnable splitScenes implementation found — the comparison cannot run`);
  } else {
    const answers = new Map();
    for (const im of impls) {
      let sig;
      try {
        const out = im.call(SCRIPT_FIXTURE) || [];
        sig = out.length + ' scenes; first=' + JSON.stringify(sceneNumberOf(out[0]));
      } catch (e) { sig = 'threw: ' + e.message; }
      if (!answers.has(sig)) answers.set(sig, []);
      answers.get(sig).push(im.file + ' (' + im.label + ')');
    }
    if (answers.size > 1) {
      flag('agreement', 'splitScenes:answers',
        `${impls.length} splitScenes implementations give ${answers.size} different answers for one script with a FADE IN: preamble and an A-scene — ` +
        [...answers].map(([sig, files]) => `«${sig}» ${files.join(', ')}`).join(' | '));
    } else if (VERBOSE) note(`  splitScenes ok  ${impls.length} implementations agree: ${[...answers.keys()][0]}`);
  }
}
function sceneNumberOf(sc) {
  if (!sc) return null;
  for (const k of ['number', 'num', 'printed', 'printedNumber', 'sceneNumber', 'n']) {
    if (sc[k] != null) return sc[k];
  }
  return sc.slug || null;
}

/* The budget engine. Two files export SBBudget; the dashboard runs one and
   every suite that touches a budget runs the other. */
{
  const dupExports = new Map();
  for (const f of SHIPPED) {
    for (const m of src(f).matchAll(/^\s*(?:root|window|globalThis)\.([A-Za-z_$][\w$]*)\s*=\s*\{/gm)) {
      if (!dupExports.has(m[1])) dupExports.set(m[1], []);
      dupExports.get(m[1]).push(f);
    }
  }
  for (const [name, files] of [...dupExports].sort()) {
    const uniq = [...new Set(files)];
    if (uniq.length < 2) continue;
    /* A namespace several files extend (TTabs) is not two implementations. */
    if (uniq.every((f) => /\breturn\b/.test('') )) continue;
    const apis = uniq.map((f) => ({ f, api: tryEvalModule([f]) }));
    if (apis.some((x) => !x.api || !x.api[name])) {
      flag('agreement', 'export:' + name, `${name} is exported by ${uniq.join(' and ')} and they cannot both be evaluated to compare`);
      continue;
    }
    const shared = Object.keys(apis[0].api[name]).filter((k) =>
      apis.every((x) => typeof x.api[name][k] === typeof apis[0].api[name][k]));
    let disagreed = 0;
    for (const fn of shared) {
      if (typeof apis[0].api[name][fn] !== 'function') continue;
      const results = apis.map((x) => {
        try { return JSON.stringify(x.api[name][fn](SCRIPT_FIXTURE)); } catch { return '<threw>'; }
      });
      if (results.some((r) => r === '<threw>')) continue;
      if (new Set(results).size > 1) disagreed++;
    }
    if (disagreed) {
      flag('agreement', 'export:' + name,
        `${uniq.join(' and ')} both export ${name}; ${disagreed} of their shared functions return different answers for the same script`);
    } else if (VERBOSE) {
      note(`  export ok       ${name} in ${uniq.join(' + ')} agrees on every comparable function`);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 3 — COVERAGE: every shipped .js is executed by at least one suite
   ═════════════════════════════════════════════════════════════════════════ */

/* A suite "runs" a file when it evaluates it — eval, vm, dynamic import, or a
   browser harness that loads a page carrying the <script src>. Reading a file
   to grep it is a lint, not a test: test_helpers_defined.mjs statically reads
   every script on every page, and js/budget-engine.js was still never once
   executed. Counting a lint as coverage is how a 1,082-line engine hid. */
const EXEC_MARK = /\beval\b|\bvm\.run|new Function|import\s*\(|runInContext|runInNewContext/;
const runBy = new Map();     // shipped file -> [suites that execute it]
const lintBy = new Map();    // shipped file -> [suites that only read it]
const execOf = new Map();    // suite -> Set(shipped files it executes)
const addTo = (map, f, s) => {
  if (!map.has(f)) map.set(f, []);
  map.get(f).push(s);
  if (map === runBy) {
    if (!execOf.has(s)) execOf.set(s, new Set());
    execOf.get(s).add(f);
  }
};

/* pages a browser harness visits -> the scripts those pages load */
function scriptsOfPage(pageRel) {
  const p = join(ROOT, pageRel);
  if (!existsSync(p)) return [];
  const out = [];
  for (const m of readFileSync(p, 'utf8').matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const raw = m[1].split('?')[0];
    if (/^https?:/i.test(raw)) continue;
    const target = raw.startsWith('/') ? join(ROOT, raw.slice(1)) : resolve(dirname(p), raw);
    if (existsSync(target)) out.push(rel(target));
  }
  return out;
}
for (const s of SUITES) {
  const text = src(s);
  const executes = EXEC_MARK.test(text);
  const isBrowser = /playwright|chromium|startServer/.test(text);
  for (const m of text.matchAll(/['"`]([A-Za-z0-9_@./-]+\.js)['"`]/g)) {
    /* Six suites name their target by absolute path. Stripping only a leading
       slash left `home/user/shotb/sw.js`, which matches no shipped file, so
       those suites contributed nothing — sw.js reported as "no suite loads it
       at all" when scripts/test_sw_cache.mjs reads it on every run. An absence
       misattributed is the same failure this file exists to catch, one level
       down: make the path relative to ROOT first. */
    const abs = m[1].startsWith(ROOT + '/') ? m[1].slice(ROOT.length + 1) : m[1];
    const cand = abs.replace(/^\.?\//, '').replace(/^\.\.\//, '');
    const hit = SHIPPED.find((f) => f === cand || f.endsWith('/' + cand));
    if (!hit) continue;
    addTo(executes ? runBy : lintBy, hit, s);
  }
  if (isBrowser) {
    for (const m of text.matchAll(/['"`](\/[A-Za-z0-9_./-]*\.html|[A-Za-z0-9_-]+\/index\.html)['"`]/g)) {
      for (const js of scriptsOfPage(m[1].replace(/^\//, ''))) addTo(runBy, js, s);
    }
    /* `${base}/sets/` style navigations: take any bare module directory. */
    for (const m of text.matchAll(/\$\{[A-Za-z_$][\w$]*\}\/([A-Za-z0-9_-]+)\/?['"`]/g)) {
      for (const js of scriptsOfPage(m[1] + '/index.html')) addTo(runBy, js, s);
    }
  }
}
for (const f of SHIPPED) {
  if (runBy.has(f)) continue;
  const lines = src(f).split('\n').length;
  flag('coverage', f,
    lintBy.has(f)
      ? `${lines} lines, shipped, and no suite ever executes it — only read statically by ${[...new Set(lintBy.get(f))].join(', ')}`
      : `${lines} lines, shipped, and no suite loads it at all`);
}
note(`  coverage: ${SHIPPED.length - [...SHIPPED].filter((f) => !runBy.has(f)).length}/${SHIPPED.length} shipped .js files are executed by a suite`);

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 4 — INPUTS: the fixture has to contain the class the bug lives in
   ═════════════════════════════════════════════════════════════════════════ */

/* Which modules are money modules is read off their own public API rather than
   listed here, so a new engine joins the rule by existing. */
const MONEY_API = /(money|budget|cost|fee|payroll|fringe|invoice|deal|incentive|residual|waterfall|petty|price|amount|estimat|spend|revenue|sales|tax|dollar)/i;
const moneyModules = new Set();
for (const f of SHIPPED) {
  const api = tryEvalModule([f]);
  if (!api) continue;
  for (const v of Object.values(api)) {
    if (!v || typeof v !== 'object') continue;
    if (Object.keys(v).some((k) => MONEY_API.test(k))) { moneyModules.add(f); break; }
  }
}
/* cents: a decimal amount that is not a round dollar and not a version or a
   timecode. Two decimal places, at least one of them non-zero. */
const CENTS = /(?<![.\d])\d[\d_]*\.\d?[1-9]\d?(?![\d.])/;
const SLUGLINE = /^\s*(?:[\dA-Z]+[\s.]+)?(INT|EXT|INT\/EXT|I\/E)[.\s]/mi;
const A_SCENE = /^\s*\d+[A-Z]\b/m;
const PREAMBLE = /\bFADE IN\s*:/i;

for (const s of SUITES) {
  const text = src(s);
  const money = [...(execOf.get(s) || [])].filter((f) => moneyModules.has(f)).sort();
  if (money.length && !CENTS.test(text)) {
    flag('inputs', 'cents:' + s,
      `runs ${money.length} money module${money.length === 1 ? '' : 's'} (${money.slice(0, 3).join(', ')}${money.length > 3 ? ', …' : ''}) ` +
      'and every amount in its fixtures is a round number — the rounding bugs live in the cents');
  }
  if (SLUGLINE.test(text)) {
    const missing = [];
    if (!PREAMBLE.test(text)) missing.push('a FADE IN: preamble');
    if (!A_SCENE.test(text)) missing.push('an A-scene');
    if (missing.length) {
      flag('inputs', 'script:' + s,
        `carries a screenplay fixture with ${missing.length === 2 ? 'neither ' + missing[0] + ' nor ' + missing[1] : 'no ' + missing[0]} — ` +
        'the inputs that make most scene numbering start at 2 and lose A-scenes entirely');
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHECK 5 — API reach: a module being loaded is not the same as being tested
   ═════════════════════════════════════════════════════════════════════════ */

/* Mode 5 was that run_all_tests.mjs globs scripts/test_*.mjs, so a module with
   no suite is not a failure — it is an absence, and absences do not show up in
   a pass count. CHECK 3 turns the file-level absence into a failure. This is
   the same hole one level down: safety/lib-safety.js was loaded by test_ops.mjs
   the whole time, and half its public API had never been called. A file that is
   loaded reads as covered; a name nobody ever names is covered by nothing.

   The measure is deliberately generous — a suite that so much as writes the
   export's name counts — so anything it reports is a function no suite mentions
   at all. */
for (const f of SHIPPED) {
  const suites = runBy.get(f);
  if (!suites) continue;                       // CHECK 3 already owns this file
  /* Only the pure-logic half of a module can be reached from node at all. A
     file that touches the DOM has a browser harness or nothing, and holding it
     to a node-callable standard would be inventing a violation. Membership is
     read off the code — does it touch `document` — not off a list of names. */
  if (/\bdocument\s*\./.test(src(f))) continue;
  const api = tryEvalModule([f]);
  if (!api) continue;
  /* evalModule pulls a module's dependencies in with it, and every namespace
     they create lands in the same context — so props/lib-props.js was being
     charged with CScenes.eighthsOf, which it does not define, does not export
     and cannot fix. That reported the one real gap (js/lib-scenes.js) ten more
     times against ten wrong files, and a reader following the report would
     have gone looking in the wrong module. A name that does not occur in this
     file's own text is not this file's export; the genuine owner is flagged
     under its own path, so nothing is lost by excluding it here. */
  const own = src(f);
  const names = new Set();
  for (const ns of Object.values(api)) {
    if (!ns || typeof ns !== 'object') continue;
    for (const [k, v] of Object.entries(ns)) {
      if (typeof v !== 'function') continue;
      if (!new RegExp('\\b' + k.replace(/[$]/g, '\\$') + '\\b').test(own)) continue;
      names.add(k);
    }
  }
  if (names.size < 3) continue;
  const text = [...new Set(suites)].map((s) => src(s)).join('\n');
  const untouched = [...names].filter((n) => !new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b').test(text)).sort();
  if (!untouched.length) continue;
  for (const n of untouched) {
    flag('api-reach', f,
      `${untouched.length}/${names.size} exported functions are never named by any suite that loads it: ` +
      untouched.join(', '));
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   the ledger
   ═════════════════════════════════════════════════════════════════════════ */
const counts = new Map();
const details = new Map();
for (const v of violations) {
  const k = v.check + '::' + v.key;
  counts.set(k, (counts.get(k) || 0) + 1);
  if (!details.has(k)) details.set(k, v.detail);
}

const listed = existsSync(EXC_FILE) ? JSON.parse(readFileSync(EXC_FILE, 'utf8')) : {};
const allowed = (k) => {
  const e = listed[k];
  if (e == null) return 0;
  if (typeof e === 'string') return 1;            // pre-count shape fails closed
  return typeof e.n === 'number' && e.n >= 0 ? e.n : 0;
};

if (process.argv.includes('--migrate')) {
  /* Only keys already listed are re-counted. A brand-new violation is never
     absorbed silently — somebody has to write down why it is acceptable. */
  const out = {};
  for (const k of Object.keys(listed).sort()) {
    const e = listed[k];
    out[k] = { n: counts.get(k) || 0, why: typeof e === 'string' ? e : (e && e.why) || '' };
  }
  writeFileSync(EXC_FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`migrated ${Object.keys(out).length} listed exceptions to today's counts`);
  process.exit(0);
}

const CHECKS = [
  ['roundtrip', '1  round trip — writer shape vs reader expectations'],
  ['agreement', '2  agreement — two implementations of one concept'],
  ['coverage', '3  coverage  — every shipped .js executed by a suite'],
  ['inputs', '4  inputs    — cents in money fixtures, A-scenes in scripts'],
  ['api-reach', '5  api reach — exported functions no suite ever calls'],
];

let grown = 0, shrunk = 0;
const lines = [];
for (const [check, title] of CHECKS) {
  const keys = [...counts.keys()].filter((k) => k.startsWith(check + '::')).sort();
  const listedKeys = Object.keys(listed).filter((k) => k.startsWith(check + '::'));
  let over = 0, within = 0;
  for (const k of keys) {
    const n = counts.get(k), a = allowed(k);
    if (n > a) {
      over++;
      lines.push(`  NEW  ${k.slice(check.length + 2)}` + (a ? `  (${n} now, ${a} listed)` : ''));
      lines.push(`       ${details.get(k)}`);
    } else within++;
  }
  const stale = listedKeys.filter((k) => (counts.get(k) || 0) < allowed(k));
  grown += over;
  shrunk += stale.length;
  console.log(`\n${title}`);
  console.log(`     ${over ? over + ' UNLISTED' : 'clean'} · ${within} known and listed · ${listedKeys.length} entries on the list` +
    (stale.length ? ` · ${stale.length} listed but no longer occurring` : ''));
  for (const l of lines.splice(0)) console.log(l);
}

if (notes.length) { console.log(''); for (const n of notes) console.log(n); }

const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`\nassurance: ${total} violations across 5 checks · ` +
  `${Object.keys(listed).length} named exceptions · ${grown} unlisted` +
  (shrunk ? ` · ${shrunk} listed entries have been fixed — run --migrate to lower the ceiling` : ''));

if (grown) {
  console.error('\nSomething got worse, or something new is unaccounted for. Fix it, or add it to\n' +
    'scripts/assurance_exceptions.json with a count and a written reason. Then --migrate.');
  process.exit(1);
}
process.exit(0);
