#!/usr/bin/env node
/* The platform has TWO Content-Security-Policies, and nothing kept them equal.
 *
 *   · `_headers`                    → the public shell on the CDN
 *                                     (index, login, 404, sw.js, assets, static)
 *   · netlify/functions/gate.js     → EVERY gated page, i.e. all 28 modules
 *
 * `_headers` rules never apply to a function response, so the gate carries a
 * hand-copied second policy. A fix applied to one copy is invisible in the
 * other and nothing failed: `https://api.open-meteo.com` was added to the
 * shell's connect-src for the weather planner, but the planner runs on
 * /producer/ and /locations/ — both served THROUGH the gate — so it shipped
 * blocked and looked, from the code, entirely correct.
 *
 * This suite is the structural fix. It reads the real `_headers` file and
 * takes the gate's policy off a REAL RESPONSE from the real handler (not a
 * regex over the source), so however the gate assembles its headers, what is
 * compared is what a browser would actually receive.
 *
 * WHICH DIVERGENCES ARE LEGITIMATE — the whole judgement, in one place:
 *
 *   Base policy: NONE. The split between the two surfaces is the sign-in
 *   wall, not a difference in what a page may load. The same fonts, the same
 *   wasm/worker shapes, the same research APIs, the same localhost bridge
 *   serve both halves; `static/ffmpeg` even lives on the CDN under `_headers`
 *   while the pages that execute it are served by the gate. So the two
 *   policies must be token-for-token identical, and any divergence is drift
 *   until a human writes down why. EXCEPTIONS below is the place to write it;
 *   it is deliberately empty.
 *
 *   /app.html overlay: LEGITIMATE, and asserted rather than waved through.
 *   The legacy monolith is on Firebase and needs four vendor origins the rest
 *   of the product does not. The gate scopes them to that one path, so this
 *   suite checks the overlay is additive-only, reaches no other path, and —
 *   the part that could rot silently — that it still APPLIES at all: it is
 *   built with String.replace() on two literal anchors inside the base
 *   policy, so reordering the base policy would turn it into a no-op and take
 *   sign-in on /app.html down with it.
 *
 *   Cache-Control: LEGITIMATE. `_headers` revalidates; the gate is
 *   'private, no-store' on everything, because a gate response is one owner's
 *   copy of protected code. Stricter, one-directional, asserted below.
 *
 *   netlify.toml: LEGITIMATE, and nearly inert. It is on the deploy exclusion
 *   list (scripts/deploy_cinamate.mjs:80) and a git build publishes the
 *   fail-closed placeholder, so its headers harden the placeholder and never
 *   the studio — which is why its X-Frame-Options may be STRICTER (DENY) than
 *   the shell's SAMEORIGIN. It must never be looser, and it must never grow a
 *   CSP of its own: a third hand-maintained copy is the same bug again.
 *
 * Run: node scripts/test_csp_parity.mjs
 */
import { createHmac } from 'crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error('  ✗ ' + name + (detail ? '\n      ' + detail : ''));
}

/* ── declared divergences ────────────────────────────────────────────────
   directive → { onlyInShell:[src], onlyInGate:[src], why:'...' }
   Empty, and it should stay empty. An entry without a real `why` is refused
   below, so "silence the test" is not a one-line move. */
const EXCEPTIONS = new Map();

/* Every remote origin either policy is allowed to name, and what pays for it.
   Anything else — in either copy — fails, so no origin can be slipped into
   one policy (or both) without landing in this table first. */
const ALLOWED_REMOTE = new Map([
  ['https://fonts.googleapis.com', { directives: ['style-src'], why: 'Google Fonts stylesheet, linked by every page shell' }],
  ['https://fonts.gstatic.com', { directives: ['font-src'], why: 'the font files that stylesheet pulls' }],
  ['https://api.themoviedb.org', { directives: ['connect-src'], why: 'cast/title research — production/production.js:418' }],
  ['https://query.wikidata.org', { directives: ['connect-src'], why: 'cast/title research — production/production.js:432' }],
  ['https://api.open-meteo.com', { directives: ['connect-src'], why: 'weather planner — tools/lib-sun.js:159 via tools/sched-weather.js, runs on /producer/ and /locations/' }],
  ['http://127.0.0.1:*', { directives: ['img-src', 'media-src', 'connect-src'], why: 'the generation bridge on the operator\'s own machine, and the frames/clips it serves back' }],
  ['http://localhost:*', { directives: ['img-src', 'media-src', 'connect-src'], why: 'same bridge, hostname form' }],
]);

/* The /app.html-only additions, and nothing else may appear there. */
const APP_OVERLAY = new Map([
  ['script-src', ['https://www.gstatic.com']],
  ['connect-src', ['https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com', 'https://firestore.googleapis.com']],
]);

/* Directives whose value is a hardening pin, not a capability list. Both
   policies must carry each one, exactly, with nothing else in it. */
const PINS = new Map([
  ['default-src', "'self'"], ['base-uri', "'self'"], ['object-src', "'none'"],
  ['frame-ancestors', "'none'"], ['form-action', "'self'"],
]);

/* Paths `_headers` may harden that the gate never serves: deploy_cinamate.mjs
   keeps the shell and the vendor asset trees on the CDN (PUBLIC_FILES /
   PUBLIC_PREFIXES, deploy_cinamate.mjs:212-220). */
const CDN_ONLY = new Set(['/index.html', '/login.html', '/404.html', '/sw.js']);
const CDN_ONLY_PREFIXES = ['/static/', '/assets/'];

/* ── parsers ─────────────────────────────────────────────────────────── */

/* Netlify `_headers`: a path pattern at column 0, indented `Name: value`
   lines under it. Repeated patterns merge (the file does this for /workflow/*
   and /timeline/*). */
function parseHeadersFile(text) {
  const blocks = new Map();
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) {
      const pattern = line.trim();
      if (!blocks.has(pattern)) blocks.set(pattern, new Map());
      cur = blocks.get(pattern);
      continue;
    }
    const m = /^\s+([A-Za-z0-9-]+)\s*:\s*(.*)$/.exec(line);
    if (m && cur) cur.set(m[1].toLowerCase(), m[2].trim());
  }
  return blocks;
}

function parseCsp(str) {
  const out = new Map();
  for (const part of String(str || '').split(';')) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (!bits.length) continue;
    out.set(bits.shift().toLowerCase(), new Set(bits));
  }
  return out;
}

const only = (a, b) => [...a].filter((x) => !b.has(x));
const hdr = (headers, name) => {
  const want = name.toLowerCase();
  for (const k of Object.keys(headers || {})) if (k.toLowerCase() === want) return headers[k];
  return undefined;
};

/* The `/*` block of the netlify.toml [[headers]] table. */
function parseTomlRootHeaders(text) {
  const out = new Map();
  const blocks = text.split(/^\[\[headers\]\]\s*$/m).slice(1);
  for (const b of blocks) {
    const target = /^\s*for\s*=\s*"([^"]*)"/m.exec(b);
    if (!target || target[1] !== '/*') continue;
    const re = /^\s*([A-Za-z0-9-]+)\s*=\s*"([^"]*)"/gm;
    let m;
    while ((m = re.exec(b)) !== null) {
      if (m[1].toLowerCase() === 'for') continue;
      out.set(m[1].toLowerCase(), m[2]);
    }
  }
  return out;
}

/* ── the two policies, as a browser would see them ───────────────────── */

const SECRET = 'test-secret-csp-parity';
process.env.OWNER_TOKEN_SECRET = SECRET;

const stage = mkdtempSync(join(tmpdir(), 'csp-parity-'));
const siteDir = join(stage, 'site');
cpSync(join(ROOT, 'netlify/functions/gate.js'), join(stage, 'gate.js'));
function stageFile(rel, body = '<html>staged</html>') {
  const p = join(siteDir, rel.replace(/^\//, ''));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}
stageFile('dashboard.html');
stageFile('app.html');
stageFile('js/staged-fixture.js', 'window.CStaged={}');

const { handler } = require_(join(stage, 'gate.js'));
const payload = 'owner:hz465:' + (Date.now() + 3600000);
const TOKEN = payload + ':' + createHmac('sha256', SECRET).update(payload).digest('hex');
const get = (path) => handler({
  rawUrl: 'https://x.example' + path,
  headers: { cookie: 'cin_owner=' + encodeURIComponent(TOKEN) },
});

const shellBlocks = parseHeadersFile(readFileSync(join(ROOT, '_headers'), 'utf8'));
const shellRoot = shellBlocks.get('/*') || new Map();
const shellCspRaw = shellRoot.get('content-security-policy') || '';

const pageRes = await get('/dashboard.html');
const gateCspRaw = hdr(pageRes.headers, 'content-security-policy') || '';

t('the gate serves a module page to a signed-in owner', pageRes.statusCode === 200,
  'statusCode ' + pageRes.statusCode);
t('_headers carries a CSP on /*', !!shellCspRaw);
t('the gate response carries a CSP', !!gateCspRaw);

const shell = parseCsp(shellCspRaw);
const gate = parseCsp(gateCspRaw);

/* ── 1. hardening pins, in both copies ───────────────────────────────── */
for (const [label, csp] of [['_headers', shell], ['gate.js', gate]]) {
  for (const [dir, want] of PINS) {
    const got = csp.get(dir);
    t(label + ': ' + dir + ' is exactly ' + want,
      !!got && got.size === 1 && got.has(want), got ? [...got].join(' ') : 'directive missing');
  }
}

/* ── 2. nothing dangerous, in either copy ────────────────────────────── */
for (const [label, csp] of [['_headers', shell], ['gate.js', gate]]) {
  const script = csp.get('script-src') || new Set();
  t(label + ": script-src has no 'unsafe-eval'", !script.has("'unsafe-eval'"));
  t(label + ': script-src has no data: (a data: URL would be executable code)',
    !script.has('data:'));
  for (const [dir, srcs] of csp) {
    for (const s of srcs) {
      t(label + ': ' + dir + ' names no wildcard host (' + s + ')',
        !/^\*/.test(s) && !/^(https?|ws|wss):\/\/\*/.test(s), s);
      if (/^http:\/\//.test(s)) {
        t(label + ': ' + dir + ' plaintext http: source is loopback only (' + s + ')',
          /^http:\/\/(127\.0\.0\.1|localhost)(:(\*|\d+))?$/.test(s), s);
      }
      if (/^https?:\/\//.test(s)) {
        const entry = ALLOWED_REMOTE.get(s);
        t(label + ': ' + s + ' is a documented origin',
          !!entry, 'unlisted origin in ' + dir + ' — add it to ALLOWED_REMOTE with a reason, or drop it');
        if (entry) {
          t(label + ': ' + s + ' is used in a directive it was justified for',
            entry.directives.includes(dir), dir + ' not in [' + entry.directives.join(', ') + ']');
          t(label + ': ' + s + ' carries a reason', !!entry.why && entry.why.length > 10);
        }
      }
    }
  }
}

/* ── 3. parity — the whole point ─────────────────────────────────────── */
{
  const dirsShell = [...shell.keys()].sort();
  const dirsGate = [...gate.keys()].sort();
  t('both policies declare the same directives',
    dirsShell.join(' ') === dirsGate.join(' '),
    'only in _headers: [' + only(new Set(dirsShell), new Set(dirsGate)).join(', ') +
    '] · only in gate.js: [' + only(new Set(dirsGate), new Set(dirsShell)).join(', ') + ']');

  for (const dir of new Set([...dirsShell, ...dirsGate])) {
    const a = shell.get(dir) || new Set();
    const b = gate.get(dir) || new Set();
    const ex = EXCEPTIONS.get(dir) || {};
    if (EXCEPTIONS.has(dir)) {
      t('the declared divergence on ' + dir + ' states why', !!ex.why && ex.why.length > 20, ex.why || '(none)');
    }
    const missingInGate = only(a, b).filter((s) => !(ex.onlyInShell || []).includes(s));
    const missingInShell = only(b, a).filter((s) => !(ex.onlyInGate || []).includes(s));
    t(dir + ': every source the shell allows, the gated app allows',
      missingInGate.length === 0,
      missingInGate.join(', ') + ' — in _headers only, so EVERY module page blocks it ' +
      '(this is exactly how api.open-meteo.com shipped broken)');
    t(dir + ': the gated app allows nothing the shell does not',
      missingInShell.length === 0,
      missingInShell.join(', ') + ' — in gate.js only; either mirror it into _headers or declare it in EXCEPTIONS');
  }

  /* Belt and braces: the assembled strings, normalised, must match. Catches a
     duplicated directive or stray token that the per-directive sets would
     quietly absorb. */
  const norm = (csp) => [...csp.entries()].map(([d, s]) => d + ' ' + [...s].sort().join(' '))
    .sort().join('; ');
  t('the two policies are token-for-token identical',
    EXCEPTIONS.size > 0 || norm(shell) === norm(gate));
}

/* ── 4. the research origins the code actually calls ─────────────────── */
for (const origin of ['https://api.themoviedb.org', 'https://query.wikidata.org',
  'https://api.open-meteo.com']) {
  t(origin + ' is reachable from a gated page', (gate.get('connect-src') || new Set()).has(origin),
    ALLOWED_REMOTE.get(origin).why);
  t(origin + ' is reachable from the public shell', (shell.get('connect-src') || new Set()).has(origin));
}

/* ── 5. the /app.html overlay: scoped, additive, and still applying ──── */
{
  const appRes = await get('/app.html');
  const appCsp = parseCsp(hdr(appRes.headers, 'content-security-policy') || '');
  const prettyRes = await get('/app');
  const prettyCsp = parseCsp(hdr(prettyRes.headers, 'content-security-policy') || '');

  t('/app.html is served', appRes.statusCode === 200, 'statusCode ' + appRes.statusCode);
  t('/app (pretty URL) is served', prettyRes.statusCode === 200, 'statusCode ' + prettyRes.statusCode);

  for (const [label, csp] of [['/app.html', appCsp], ['/app', prettyCsp]]) {
    /* If someone reorders the base policy, gate.js's String.replace() anchors
       stop matching and this overlay becomes a silent no-op — Firebase
       sign-in on the monolith dies with no failing test anywhere. */
    t(label + ': the Firebase overlay actually applied',
      [...APP_OVERLAY.values()].flat().every((o) => [...csp.values()].some((s) => s.has(o))),
      'the replace() anchors in gate.js no longer match the base policy');

    for (const [dir, base] of gate) {
      const got = csp.get(dir) || new Set();
      t(label + ': ' + dir + ' keeps every source the base policy had',
        only(base, got).length === 0, 'lost: ' + only(base, got).join(', '));
      const added = only(got, base);
      const expected = APP_OVERLAY.get(dir) || [];
      t(label + ': ' + dir + ' adds only the documented Firebase origins',
        added.every((s) => expected.includes(s)),
        'unexpected: ' + added.filter((s) => !expected.includes(s)).join(', '));
      t(label + ': ' + dir + ' adds every documented Firebase origin',
        expected.every((s) => got.has(s)),
        'missing: ' + expected.filter((s) => !got.has(s)).join(', '));
    }
    for (const [dir, pin] of PINS) {
      const got = csp.get(dir) || new Set();
      t(label + ': the overlay did not relax ' + dir, got.size === 1 && got.has(pin),
        [...got].join(' '));
    }
  }

  /* Scoping: no other path may inherit the vendor origins. */
  const vendors = [...APP_OVERLAY.values()].flat();
  for (const path of ['/dashboard.html', '/js/staged-fixture.js']) {
    const r = await get(path);
    const raw = hdr(r.headers, 'content-security-policy') || '';
    t(path + ' does not carry the Firebase origins',
      vendors.every((o) => !raw.includes(o)),
      vendors.filter((o) => raw.includes(o)).join(', '));
  }
  for (const o of vendors) {
    t(o + ' is https and has no wildcard', /^https:\/\/[a-z0-9.-]+$/i.test(o), o);
  }
}

/* ── 6. the other security headers, and cross-origin isolation ───────── */
{
  for (const name of ['x-content-type-options', 'referrer-policy', 'permissions-policy',
    'strict-transport-security', 'x-frame-options']) {
    const a = shellRoot.get(name);
    const b = hdr(pageRes.headers, name);
    t('both surfaces send the same ' + name, !!a && !!b && a === b,
      '_headers: ' + a + ' · gate: ' + b);
  }
  t('a gate response is never publicly cacheable',
    /no-store/.test(hdr(pageRes.headers, 'cache-control') || ''),
    hdr(pageRes.headers, 'cache-control'));

  /* Cross-origin isolation: `_headers` grants it to the ffmpeg.wasm pages,
     and every one of those pages is served by the gate — where `_headers`
     does not reach. A block added there and not mirrored here means silent
     loss of SharedArrayBuffer threading. */
  for (const [pattern, hdrs] of shellBlocks) {
    if (!hdrs.has('cross-origin-opener-policy') && !hdrs.has('cross-origin-embedder-policy')) continue;
    const probe = pattern.endsWith('/*') ? pattern.slice(0, -1) + 'index.html' : pattern;
    if (CDN_ONLY.has(probe) || CDN_ONLY_PREFIXES.some((p) => probe.startsWith(p))) continue;
    stageFile(probe);
    const r = await get(probe);
    t('the gate serves ' + probe, r.statusCode === 200, 'statusCode ' + r.statusCode);
    for (const name of ['cross-origin-opener-policy', 'cross-origin-embedder-policy']) {
      if (!hdrs.has(name)) continue;
      t('the gate re-issues ' + name + ' for ' + pattern,
        hdr(r.headers, name) === hdrs.get(name),
        '_headers: ' + hdrs.get(name) + ' · gate: ' + hdr(r.headers, name));
    }
  }
}

/* ── 7. no third policy, and netlify.toml no looser than the shell ───── */
{
  const tomlText = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  const toml = parseTomlRootHeaders(tomlText);
  t('netlify.toml declares no CSP of its own',
    !/Content-Security-Policy\s*=/i.test(tomlText));
  t('_headers declares exactly one CSP, on /*',
    [...shellBlocks].filter(([, h]) => h.has('content-security-policy'))
      .map(([p]) => p).join(',') === '/*');

  for (const name of ['x-content-type-options', 'referrer-policy', 'permissions-policy']) {
    if (!toml.has(name)) continue;
    t('netlify.toml agrees with _headers on ' + name, toml.get(name) === shellRoot.get(name),
      'netlify.toml: ' + toml.get(name) + ' · _headers: ' + shellRoot.get(name));
  }
  const rank = (v) => ({ deny: 2, sameorigin: 1 })[String(v || '').toLowerCase()] || 0;
  t('netlify.toml X-Frame-Options is no looser than the shell\'s',
    rank(toml.get('x-frame-options')) >= rank(shellRoot.get('x-frame-options')),
    'netlify.toml: ' + toml.get('x-frame-options') + ' · _headers: ' + shellRoot.get('x-frame-options'));

  /* The fail-closed settings are pinned by test_deploy_exclusions.mjs; what
     is pinned here is that no comment in the file contradicts them. */
  t('netlify.toml claims no automatic function deploy',
    !/auto-?deploys?\s+on\s+git\s+push/i.test(tomlText),
    'a comment still promises git-push deploys while functions point at the empty guard');
}

rmSync(stage, { recursive: true, force: true });
console.log(`test_csp_parity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
