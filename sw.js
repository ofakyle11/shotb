/* CINAMATE service worker — installable app shell.
 * Strategy: network-first for every same-origin GET, falling back to the
 * device cache so pages you have opened keep opening offline. Auth stays
 * server-side: the worker never bypasses the gate — it only caches what the
 * gate already served to this signed-in device, privately, on-device.
 * Never caches POSTs, functions, or cross-origin requests. */
var VERSION = 'cin-v1';
var SHELL = [
  '/', '/login.html',
  '/css/theme.css', '/js/cinamate-auth.js', '/js/effects.js',
  '/assets/logo.svg', '/assets/logo-mark.svg', '/assets/favicon.svg',
  '/assets/icon-512.png', '/manifest.webmanifest'
];

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
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
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
