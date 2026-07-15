// Streaming media proxy (Functions v2 API — streams, no 6MB buffered-response cap).
// Lets the browser canvas-grab end frames from provider video CDNs that don't
// send CORS headers (a tainted canvas kills prev-clip continuity chaining),
// and serves frame-sampling for the verification loop. GET only, https only,
// media content types only; Range passthrough so <video> can seek.
import safeUrl from './lib/safe-url.js';

const { isSafeUrl } = safeUrl;
const MAX_BYTES = 200 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json(405, { error: 'GET only' });

  const target = new URL(req.url).searchParams.get('url') || '';
  if (!target.startsWith('https://') || !isSafeUrl(target)) {
    return json(400, { error: 'url must be a safe https URL' });
  }

  const fwd = {};
  const range = req.headers.get('range');
  if (range) fwd.Range = range;

  let upstream;
  try {
    upstream = await fetch(target, { headers: fwd, redirect: 'follow' });
  } catch (e) {
    return json(502, { error: 'Upstream fetch failed', detail: String((e && e.message) || e) });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return json(502, { error: 'Upstream returned ' + upstream.status });
  }

  const ct = upstream.headers.get('content-type') || '';
  if (!/^(video|image)\//i.test(ct) && !/application\/octet-stream/i.test(ct)) {
    return json(415, { error: 'Unsupported content-type', contentType: ct });
  }
  const len = Number(upstream.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return json(413, { error: 'File too large' });

  const headers = new Headers(CORS);
  headers.set('Content-Type', ct || 'application/octet-stream');
  for (const k of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(k);
    if (v) headers.set(k, v);
  }
  headers.set('Cache-Control', 'public, max-age=3600');
  // Loadable under the COEP:credentialless timeline page.
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(upstream.body, { status: upstream.status, headers });
};
