// ═══════════════════════════════════════════════════════════════════════════
// CINAMATE — application gate (server-side)
// The entire working application (module pages, scripts, styles) is bundled
// INSIDE this function, not on the public CDN. A request only receives code
// after its cin_owner cookie carries a valid HMAC-signed owner token from
// /verify-owner — anonymous visitors get a login redirect, never the code.
//
// ENV: OWNER_TOKEN_SECRET (same secret verify-owner signs with)
// ═══════════════════════════════════════════════════════════════════════════

const { createHmac, timingSafeEqual } = require('crypto');
const { readFileSync, existsSync, statSync } = require('fs');
const { join, normalize } = require('path');

const NAMES = ['mz465', 'kz465', 'hz465', 'rz465', 'dz465'];

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', ico: 'image/x-icon', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8', fountain: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json'
};
const BINARY = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp',
  'woff', 'woff2', 'ttf', 'mp4', 'webm', 'mp3', 'wav']);

function safeEqual(a, b) {
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  return A.length === B.length && timingSafeEqual(A, B);
}

// owner:name:expiresMs:hmac — the exact format verify-owner mints.
function tokenOwner(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split(':');
  if (parts.length !== 4 || parts[0] !== 'owner') return null;
  const name = String(parts[1]).toLowerCase();
  if (NAMES.indexOf(name) < 0) return null;
  const expires = parseInt(parts[2], 10);
  if (!expires || Date.now() > expires) return null;
  const expect = createHmac('sha256', secret)
    .update('owner:' + parts[1] + ':' + expires).digest('hex');
  return safeEqual(parts[3], expect) ? name : null;
}

function cookieToken(header) {
  const m = /(?:^|;\s*)cin_owner=([^;]+)/.exec(String(header || ''));
  try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
}

exports.handler = async (event) => {
  let path = '/';
  try { path = new URL(event.rawUrl).pathname; }
  catch (e) { path = (event.path || '/'); }
  try { path = decodeURIComponent(path); } catch (e) { /* keep raw */ }

  const secret = process.env.OWNER_TOKEN_SECRET;
  const headers = event.headers || {};
  const owner = tokenOwner(cookieToken(headers.cookie || headers.Cookie), secret);

  if (!owner) {
    // Pages bounce to the sign-in screen; subresources get a plain 401.
    const isPage = !/\.[a-z0-9]+$/i.test(path) || /\.html$/i.test(path);
    if (isPage) {
      return { statusCode: 302, body: '', headers: {
        Location: '/login.html?to=' + encodeURIComponent(path),
        'Cache-Control': 'no-store' } };
    }
    return { statusCode: 401, body: 'Sign in required',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } };
  }

  let rel = normalize(path).replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.indexOf('..') >= 0 || rel.indexOf('\0') >= 0) {
    return { statusCode: 400, body: 'Bad path', headers: { 'Content-Type': 'text/plain' } };
  }
  let file, body, ext;
  try {
    file = join(__dirname, 'site', rel);
    if (!rel || rel.slice(-1) === '/' || (existsSync(file) && statSync(file).isDirectory())) {
      file = join(file, 'index.html');
    }
    if (!existsSync(file) && existsSync(file + '.html')) file += '.html'; // pretty URLs (/app)
    if (!existsSync(file)) throw new Error('missing');
    ext = (file.split('.').pop() || '').toLowerCase();
    body = readFileSync(file);
  } catch (e) {
    return { statusCode: 404, body: 'Not found', headers: {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } };
  }
  const bin = BINARY.has(ext);
  const headersOut = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    // _headers never applies to function responses, so the gated app carries
    // its own policy. 'unsafe-inline' is required while pages ship inline
    // script; everything else is locked to our own origin plus the two
    // research APIs and the generation bridge on the operator's own machine —
    // which the page must be able to call AND to load rendered frames and
    // clips from, hence localhost in img-src and media-src as well.
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: http://127.0.0.1:* http://localhost:*; media-src 'self' blob: data: http://127.0.0.1:* http://localhost:*; connect-src 'self' blob: data: https://api.themoviedb.org https://query.wikidata.org http://127.0.0.1:* http://localhost:*"
  };
  // Legacy /app.html predates the gate and is built on Firebase, so it needs
  // its vendor origins allowed. Scoped to that one path — every current module
  // keeps the strict self-only policy above.
  if (/^\/app(\.html)?$/.test(path)) {
    headersOut['Content-Security-Policy'] = headersOut['Content-Security-Policy']
      .replace("script-src 'self'", "script-src 'self' https://www.gstatic.com https://cdnjs.cloudflare.com")
      .replace("connect-src 'self'", "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com");
  }

  // _headers rules never apply to function responses, so the cross-origin
  // isolation ffmpeg.wasm threading needs is re-issued here for the same
  // paths the static _headers used to cover.
  if (/^\/(app(\.html)?$|editor(\/|$)|workflow(\/|$)|timeline(\/|$))/.test(path)) {
    headersOut['Cross-Origin-Opener-Policy'] = 'same-origin';
    headersOut['Cross-Origin-Embedder-Policy'] = 'credentialless';
  }
  return {
    statusCode: 200,
    headers: headersOut,
    body: bin ? body.toString('base64') : body.toString('utf8'),
    isBase64Encoded: bin
  };
};
