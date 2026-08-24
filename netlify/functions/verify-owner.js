// ═══════════════════════════════════════════════════════════════════════════
// CINAMATE — Owner Authentication (server-side)
// Passwords live in Netlify env vars, not in page source.
// Issues HMAC-signed 12-hour tokens.
//
// ENV VARS REQUIRED (the ONLY five active logins):
//   OWNER_PW_MZ465      (256-bit random password for mz465)
//   OWNER_PW_KZ465      (256-bit random password for kz465)
//   OWNER_PW_HZ465      (256-bit random password for hz465)
//   OWNER_PW_RZ465      (password for rz465)
//   OWNER_PW_DZ465      (password for dz465)
//   OWNER_TOKEN_SECRET  (random 48+ char string)
// Remove any old OWNER_PW_* vars (kyle/scott/steve era) from Netlify env —
// stale vars can still mint tokens, but verify-token rejects any name that
// does not resolve to mz465/kz465/hz465/rz465/dz465, so the allowlist holds either way.
//
// Helper script: Cinamate/get-owner-token.ps1  (run it, it prompts for short + pw securely,
// calls this endpoint, copies the resulting owner:xxx token to clipboard, and prints usage examples).
// After setting the OWNER_PW_* in Netlify env + "Clear cache and deploy site", run the helper to get tokens.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require("crypto");

// No CORS headers on purpose: sign-in is same-origin only. Without an
// Access-Control-Allow-Origin, foreign pages can neither read responses
// nor drive credential-guessing through visitors' browsers.
const BASE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function respond(statusCode, body, setCookies) {
  const out = { statusCode, headers: BASE_HEADERS, body: JSON.stringify(body) };
  if (setCookies && setCookies.length) {
    out.multiValueHeaders = { "Set-Cookie": setCookies };
  }
  return out;
}

// The real token travels HttpOnly so page scripts (and any future XSS) can
// never read it; cin_who carries only the owner short for UI labels.
function sessionCookies(token, name, maxAge) {
  return [
    "cin_owner=" + encodeURIComponent(token) +
      "; Path=/; Max-Age=" + maxAge + "; Secure; HttpOnly; SameSite=Lax",
    "cin_who=" + encodeURIComponent(name) +
      "; Path=/; Max-Age=" + maxAge + "; Secure; SameSite=Lax",
  ];
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function signOwnerToken(name, ttlHours) {
  const expires = Date.now() + ttlHours * 60 * 60 * 1000;
  const payload = `owner:${name}:${expires}`;
  const secret = process.env.OWNER_TOKEN_SECRET;
  if (!secret) throw new Error("OWNER_TOKEN_SECRET not set");
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}:${hmac}`;
}

function verifyOwnerToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(":");
  if (parts.length !== 4 || parts[0] !== "owner") return null;
  const [, name, expiresStr, providedHmac] = parts;
  const expires = parseInt(expiresStr, 10);
  if (!expires || Date.now() > expires) return null;
  const secret = process.env.OWNER_TOKEN_SECRET;
  if (!secret) return null;
  const payload = `owner:${name}:${expires}`;
  const expectedHmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (!safeEqual(providedHmac, expectedHmac)) return null;
  return { name, expires };
}

exports.verifyOwnerToken = verifyOwnerToken;

// ── brute-force throttle ────────────────────────────────────────────────
// Two layers. The in-memory map is instant but only covers one warm instance,
// so an attacker spread across instances slipped past it entirely. The shared
// counter in Netlify Blobs is authoritative across every instance and survives
// cold starts.
//
// It fails OPEN on purpose: if the store is unreachable we fall back to the
// in-memory limit rather than locking the owners out of their own studio. A
// storage outage must not become a denial of service against the five people
// who need to get in.
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPT_MAX = 12;
const attempts = new Map();

function throttledLocally(ip) {
  const now = Date.now();
  if (attempts.size > 500) attempts.clear();
  const a = attempts.get(ip);
  if (!a || now - a.t > ATTEMPT_WINDOW_MS) { attempts.set(ip, { n: 1, t: now }); return false; }
  a.n++;
  return a.n > ATTEMPT_MAX;
}

const THROTTLE_STORE = "cinamate-auth";
// The client IP is a personal identifier and this counter is not a place to
// keep one, so the key is a keyed digest of it rather than the address itself.
function ipKey(ip) {
  const salt = process.env.OWNER_TOKEN_SECRET || "cinamate";
  return "t_" + crypto.createHmac("sha256", salt).update(String(ip)).digest("hex").slice(0, 32);
}
function blobUrl(key) {
  return "https://api.netlify.com/api/v1/blobs/" +
    process.env.CIN_SITE_ID + "/" + THROTTLE_STORE + "/" + encodeURIComponent(key);
}
async function blobJson(method, key, body) {
  if (!process.env.CIN_API_TOKEN || !process.env.CIN_SITE_ID) return null;
  const res = await fetch(blobUrl(key), {
    method,
    headers: {
      Authorization: "Bearer " + process.env.CIN_API_TOKEN,
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (method !== "GET") return { ok: res.ok };
  if (!res.ok) return res.status === 404 ? { ok: true, value: null } : null;
  try { return { ok: true, value: JSON.parse(await res.text()) }; }
  catch (e) { return { ok: true, value: null }; }
}

// Read the shared count. Returns true only when we are certain the caller is
// over the limit; any uncertainty defers to the local map.
async function throttledShared(ip) {
  try {
    const r = await blobJson("GET", ipKey(ip));
    if (!r || !r.ok) return null;                       // store unreachable
    const rec = r.value;
    const now = Date.now();
    if (!rec || typeof rec.t !== "number" || now - rec.t > ATTEMPT_WINDOW_MS) return false;
    return (rec.n || 0) > ATTEMPT_MAX;
  } catch (e) { return null; }
}

// Only failures are counted — a correct password never costs an owner budget.
async function recordFailure(ip) {
  try {
    const key = ipKey(ip);
    const r = await blobJson("GET", key);
    const now = Date.now();
    const rec = (r && r.ok && r.value && typeof r.value.t === "number" &&
                 now - r.value.t <= ATTEMPT_WINDOW_MS) ? r.value : { n: 0, t: now };
    await blobJson("PUT", key, { n: (rec.n || 0) + 1, t: rec.t });
  } catch (e) { /* best effort — the local map still applies */ }
}

async function throttled(ip) {
  const shared = await throttledShared(ip);
  if (shared === true) return true;
  return throttledLocally(ip);
}
function clientIp(event) {
  const h = event.headers || {};
  return h["x-nf-client-connection-ip"] ||
    String(h["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });

  if (!process.env.OWNER_TOKEN_SECRET) {
    return respond(500, { error: "Owner auth not configured on server" });
  }

  const ip = clientIp(event);

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { error: "Invalid JSON body" }); }

  // Signing out is not a credential guess and must never be rate-limited:
  // throttling it would leave a session cookie alive on a shared machine
  // precisely when someone is trying to end it. Handled before the throttle,
  // and it costs no attempt budget.
  if (body.op === "logout") {
    return respond(200, { ok: true }, [
      "cin_owner=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
      "cin_who=; Path=/; Max-Age=0; Secure; SameSite=Lax",
    ]);
  }

  if (await throttled(ip)) {
    return respond(429, { error: "Too many attempts — wait a few minutes and try again" });
  }

  const { name, password } = body;
  if (!name || !password) return respond(400, { error: "name and password required" });

  // Only mz465, kz465, hz465, rz465 and dz465 are valid owner names.
  const nameLower = String(name).toLowerCase();
  if (nameLower !== 'mz465' && nameLower !== 'kz465' && nameLower !== 'hz465' && nameLower !== 'rz465' && nameLower !== 'dz465') {
    await sleep(150 + Math.floor(Math.random() * 250)); // same timing as a wrong password
    await recordFailure(ip);
    return respond(401, { error: "Invalid name or password" });
  }
  const envVar = `OWNER_PW_${nameLower.toUpperCase()}`;
  const expected = process.env[envVar];

  if (!expected) {
    await sleep(150 + Math.floor(Math.random() * 250)); // uniform failure timing
    await recordFailure(ip);
    return respond(401, { error: "Invalid name or password" });
  }
  // Trim both sides — pasted passwords often carry stray whitespace, and
  // env values can pick up a trailing newline. Edge whitespace is never
  // meaningful in our passwords.
  if (!safeEqual(String(password).trim(), String(expected).trim())) {
    await sleep(150 + Math.floor(Math.random() * 250));
    await recordFailure(ip);
    return respond(401, { error: "Invalid name or password" });
  }

  const token = signOwnerToken(nameLower, 12);
  /* The token is NOT echoed in the body. It used to be, and the comment above
     sessionCookies claiming page scripts "can never read it" was false as a
     result: app.html and timeline.js took the token out of this response and
     put it in localStorage as SB_OWNER_TOKEN, where any injected script could
     read a valid 12-hour owner credential and replay it. HttpOnly on the
     cookie is worthless while a copy is handed to JavaScript. The session
     travels in the cookie alone; the body carries only what the page needs to
     draw itself. */
  return respond(200, {
    success: true,
    name: nameLower,
    expires: Date.now() + 12 * 60 * 60 * 1000,
  }, sessionCookies(token, nameLower, 12 * 60 * 60));
};