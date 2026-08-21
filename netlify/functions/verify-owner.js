// ═══════════════════════════════════════════════════════════════════════════
// CINAMATE — Owner Authentication (server-side)
// Passwords live in Netlify env vars, not in page source.
// Issues HMAC-signed 12-hour tokens.
//
// ENV VARS REQUIRED (the ONLY three active logins):
//   OWNER_PW_MZ465      (256-bit random password for mz465)
//   OWNER_PW_KZ465      (256-bit random password for kz465)
//   OWNER_PW_HZ465      (256-bit random password for hz465)
//   OWNER_TOKEN_SECRET  (random 48+ char string)
// Remove any old OWNER_PW_* vars (kyle/scott/steve era) from Netlify env —
// stale vars can still mint tokens, but verify-token rejects any name that
// does not resolve to mz465/kz465/hz465, so the allowlist holds either way.
//
// Helper script: Cinamate/get-owner-token.ps1  (run it, it prompts for short + pw securely,
// calls this endpoint, copies the resulting owner:xxx token to clipboard, and prints usage examples).
// After setting the OWNER_PW_* in Netlify env + "Clear cache and deploy site", run the helper to get tokens.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require("crypto");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });

  if (!process.env.OWNER_TOKEN_SECRET) {
    return respond(500, { error: "Owner auth not configured on server" });
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { error: "Invalid JSON body" }); }

  const { name, password } = body;
  if (!name || !password) return respond(400, { error: "name and password required" });

  // Only mz465, kz465 and hz465 are valid owner names.
  const nameLower = String(name).toLowerCase();
  if (nameLower !== 'mz465' && nameLower !== 'kz465' && nameLower !== 'hz465') {
    return respond(401, { error: "Invalid name or password" });
  }
  const envVar = `OWNER_PW_${nameLower.toUpperCase()}`;
  const expected = process.env[envVar];

  if (!expected) return respond(401, { error: "Invalid name or password" });
  // Trim both sides — pasted passwords often carry stray whitespace, and
  // env values can pick up a trailing newline. Our passwords are hex/base64,
  // so edge whitespace is never meaningful.
  if (!safeEqual(String(password).trim(), String(expected).trim())) {
    return respond(401, { error: "Invalid name or password" });
  }

  const token = signOwnerToken(nameLower, 12);
  return respond(200, {
    success: true,
    token,
    name: nameLower,
    expires: Date.now() + 12 * 60 * 60 * 1000,
  });
};