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

console.log(`test_sw_cache: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
