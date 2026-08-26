/* The service worker decides what survives on the device after sign-out.
 *
 * Anything it writes to Cache Storage can be read back later with no cookie,
 * so the gated application must never land there. The worker used to decide
 * from the response's Cache-Control header alone — correct until some gate
 * path forgets to set it. This drives the real fetch handler against both a
 * compliant gate and a gate that forgot.
 *
 * Run: node scripts/test_sw_cache.mjs
 */
import { readFileSync } from 'fs';

const src = readFileSync('/home/user/shotb/sw.js', 'utf8');

/* ── a small stand-in for the service worker globals ── */
const listeners = {};
const stored = new Map();
const cacheApi = {
  open: async () => ({ put: async (req, res) => stored.set(req.url, res), add: async () => {} }),
  keys: async () => [],
  delete: async () => true,
  match: async () => undefined,
};
const self_ = {
  addEventListener: (name, fn) => { listeners[name] = fn; },
  location: { origin: 'https://cinamate-studio.netlify.app' },
  skipWaiting: async () => {},
  clients: { claim: async () => {} },
};

let fetchImpl = async () => { throw new Error('not set'); };
const sandbox = {
  self: self_, caches: cacheApi, URL, Response: class { constructor(b, i) { this.body = b; Object.assign(this, i); } },
  Promise, fetch: (...a) => fetchImpl(...a),
};
const fn = new Function(...Object.keys(sandbox), src);
fn(...Object.values(sandbox));

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`  x ${name}${detail ? ': ' + detail : ''}`); }
};

/* Drive one GET through the worker and report whether it got cached. */
async function visit(path, cacheControl) {
  stored.clear();
  const url = self_.location.origin + path;
  const req = { method: 'GET', url, mode: 'navigate' };
  const res = {
    ok: true, type: 'basic',
    headers: { get: (h) => (h.toLowerCase() === 'cache-control' ? cacheControl : null) },
    clone: () => ({ cloned: url }),
  };
  fetchImpl = async () => res;
  let responded;
  await listeners.fetch({ request: req, respondWith: (p) => { responded = p; } });
  if (responded) await responded;
  await new Promise((r) => setTimeout(r, 0));   // let the cache write settle
  return stored.has(url);
}

/* ── the public shell is what offline start-up needs ── */
for (const p of ['/', '/index.html', '/login.html', '/404.html', '/css/theme.css',
                 '/js/cinamate-auth.js', '/assets/logo.svg', '/static/vendor/jszip.min.js']) {
  t(`public shell is cached: ${p}`, await visit(p, 'public, max-age=3600') === true);
}

/* ── gated paths must not be, even when the gate sets the header correctly ── */
for (const p of ['/dashboard.html', '/timeline/', '/timeline/timeline.js', '/editor/cut-ui.js',
                 '/projects/index.html', '/app.html', '/js/auth.js', '/js/project-badge.js']) {
  t(`gated path is not cached: ${p}`, await visit(p, 'private, no-store') === false);
}

/* ── and still must not be when it forgets ── */
for (const p of ['/dashboard.html', '/timeline/timeline.js', '/producer/schedule-board.js',
                 '/vfx/index.html', '/js/auth.js']) {
  t(`gated path is not cached even with a permissive header: ${p}`,
    await visit(p, 'public, max-age=3600') === false);
}

/* ── a public path that the server marks no-store is still not cached ── */
t('a no-store public path is not cached', await visit('/login.html', 'no-store') === false);

/* ── the allow-list must match what the deploy actually publishes ── */
{
  const deploy = readFileSync('/home/user/shotb/scripts/deploy_cinamate.mjs', 'utf8');
  const block = /const PUBLIC_FILES = new Set\(\[([\s\S]*?)\]\)/.exec(deploy);
  t('the deploy still declares PUBLIC_FILES', !!block);
  if (block) {
    const published = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
      .filter((f) => !f.startsWith('_'));     // _headers/_redirects are CDN config, never fetched
    const missing = [];
    for (const f of published) {
      if (!(await visit('/' + f, 'public, max-age=3600'))) missing.push(f);
    }
    t('every published file is cacheable by the worker', missing.length === 0, missing.join(', '));
  }
}

/* ── an encoded path must be judged by what the SERVER will serve ──
   url.pathname is still percent-encoded, and the origin decodes before it
   decides what to answer with, so a path that reads as /assets/... here can
   be the gated dashboard there.

   The URL parser decodes %2e to "." and resolves the result, so the %2e forms
   below arrive already normalised and were refused even before the fix — they
   are here to pin that. The encoded SLASH is the one that got through: "..%2f"
   leaves a segment that is not "..", so nothing normalised it away and the
   prefix test still saw /assets/. */
for (const p of ['/assets/%2e%2e/dashboard.html', '/assets/%2E%2E/app.html',
                 '/static/%2e%2e/%2e%2e/dashboard.html', '/assets/..%2fdashboard.html',
                 '/assets/x%2f..%2f..%2fdashboard.html', '/static/..%5cdashboard.html']) {
  t(`an encoded traversal out of a public prefix is not cached: ${p}`,
    await visit(p, 'public, max-age=3600') === false);
}
/* An UNencoded traversal never reaches the worker as written — the URL parser
   resolves it first, so this arrives as /dashboard.html and is refused for
   being gated rather than for containing "..". Worth pinning: it is the
   reason only the encoded form was ever a way through. */
t('a plain traversal resolves away and is not cached',
  await visit('/assets/../dashboard.html', 'public, max-age=3600') === false);
/* An object used as a map answers for everything on Object.prototype too. */
t('a prototype key is not mistaken for a public path',
  await visit('/__proto__', 'public, max-age=3600') === false);
t('a malformed escape is not cached',
  await visit('/assets/%zz', 'public, max-age=3600') === false);
/* The guard must not have become "refuse everything": ordinary encoded
   characters in a genuinely public path still cache. */
t('an ordinary encoded character in a public path still caches',
  await visit('/assets/my%20logo.svg', 'public, max-age=3600') === true);

/* ── install writes through the same gate as fetch ──
   cache.add() fetches and writes in one step, consulting neither the path
   allow-list nor the response header. A gated path in SHELL was written to
   disk regardless of both. */
{
  const installed = [];
  const realOpen = cacheApi.open;
  cacheApi.open = async () => ({
    put: async (req, res) => { installed.push(typeof req === 'string' ? req : req.url); },
    add: async (u) => { installed.push('ADD:' + u); },
  });
  fetchImpl = async (u) => ({
    ok: true, type: 'basic',
    headers: { get: (h) => (h.toLowerCase() === 'cache-control'
      ? (String(u).indexOf('/js/auth.js') >= 0 ? 'private, no-store' : 'public, max-age=3600')
      : null) },
    clone: () => ({ cloned: u }),
  });

  /* Re-run the worker with a SHELL that has a gated path smuggled into it. */
  const tampered = src.replace("'/', '/login.html',", "'/', '/login.html', '/dashboard.html', '/js/auth.js',");
  t('the tampered SHELL fixture actually differs', tampered !== src);
  const fn2 = new Function(...Object.keys(sandbox), tampered);
  const l2 = {};
  fn2(...Object.values({ ...sandbox, self: { ...self_, addEventListener: (n, f) => { l2[n] = f; } } }));
  let waited;
  await l2.install({ waitUntil: (p) => { waited = p; } });
  if (waited) await waited;

  t('install never uses cache.add', !installed.some((u) => u.startsWith('ADD:')), installed.join(', '));
  t('install refuses a gated path smuggled into the shell',
    !installed.some((u) => u.indexOf('/dashboard.html') >= 0), installed.join(', '));
  t('install refuses a shell path the gate marks no-store',
    !installed.some((u) => u.indexOf('/js/auth.js') >= 0), installed.join(', '));
  t('install still caches the real shell',
    installed.some((u) => u.indexOf('/login.html') >= 0), installed.join(', '));
  cacheApi.open = realOpen;
}

console.log(`test_sw_cache: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
