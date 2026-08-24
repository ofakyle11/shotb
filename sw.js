/* CINAMATE service worker — installable app shell.
 * Strategy: network-first for every same-origin GET, falling back to the
 * device cache. Only the PUBLIC shell is ever cached: responses marked
 * no-store or private — which is everything the gate serves — are passed
 * through and never written to disk, so the application cannot be replayed
 * from Cache Storage after sign-out or without a cookie.
 * Never caches POSTs, functions, or cross-origin requests. */
var VERSION = 'cin-v3';   // v3: cacheable paths are an allow-list, not a header check
var SHELL = [
  '/', '/login.html',
  '/css/theme.css', '/js/cinamate-auth.js', '/js/effects.js',
  '/assets/logo.svg', '/assets/logo-mark.svg', '/assets/favicon.svg',
  '/assets/icon-512.png', '/manifest.webmanifest'
];

/* Exactly the files the deploy leaves on the public CDN. Everything else on
   this origin comes out of the gate function and must never touch disk.
 *
 * This is deliberately a second, independent check. The header test below
 * asks the RESPONSE whether it may be cached, which is correct right up until
 * some future gate path forgets to set "private, no-store" — and then gated
 * application bytes land in Cache Storage, where they outlive sign-out and
 * replay with no cookie at all. A path list cannot be forgotten by a header:
 * a new gated route is simply not on it. Both must agree before anything is
 * written. Keep this in step with PUBLIC_FILES/PUBLIC_PREFIXES in
 * scripts/deploy_cinamate.mjs. */
var PUBLIC_EXACT = {
  '/': 1, '/index.html': 1, '/login.html': 1, '/404.html': 1,
  '/css/theme.css': 1, '/js/cinamate-auth.js': 1, '/js/effects.js': 1,
  '/manifest.webmanifest': 1, '/sw.js': 1, '/robots.txt': 1, '/sitemap.xml': 1,
  '/favicon.ico': 1, '/apple-touch-icon.png': 1
};
var PUBLIC_PREFIX = ['/assets/', '/static/'];

function isPublicPath(pathname) {
  if (PUBLIC_EXACT[pathname]) return true;
  for (var i = 0; i < PUBLIC_PREFIX.length; i++) {
    if (pathname.indexOf(PUBLIC_PREFIX[i]) === 0) return true;
  }
  return false;
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { /* shell item unavailable — skip */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/.netlify/') === 0) return; // functions always live
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
        /* Never write gated bytes to disk. The gate marks everything it
           serves "private, no-store"; honouring that keeps the application
           out of on-device Cache Storage, where it would otherwise survive
           sign-out and be replayable with no cookie. Only the public shell
           is cached, which is all the offline start-up needs. */
        var cc = res.headers.get('Cache-Control') || '';
        if (isPublicPath(url.pathname) && !/no-store|private/i.test(cc)) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('/login.html');
        return new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      });
    })
  );
});
