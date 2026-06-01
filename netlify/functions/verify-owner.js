// ═══════════════════════════════════════════════════════════════════════════
// SHOTBREAK — Owner Authentication (server-side)
// Passwords live in Netlify env vars, not in page source.
// Issues HMAC-signed 12-hour tokens.
//
// ENV VARS REQUIRED:
//   OWNER_PW_KYLE
//   OWNER_PW_SCOTT
//   OWNER_PW_STEVE
//   OWNER_TOKEN_SECRET  (random 48+ char string)
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

  const nameLower = String(name).toLowerCase();
  const envVar = `OWNER_PW_${nameLower.toUpperCase()}`;
  const expected = process.env[envVar];

  if (!expected) return respond(401, { error: "Invalid name or password" });
  if (!safeEqual(password, expected)) return respond(401, { error: "Invalid name or password" });

  const token = signOwnerToken(nameLower, 12);
  return respond(200, {
    success: true,
    token,
    name: nameLower,
    expires: Date.now() + 12 * 60 * 60 * 1000,
  });
};