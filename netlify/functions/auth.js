const crypto = require('crypto');

const DB = 'https://shotbreak-9f342-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;

function makeToken() { return crypto.randomUUID() + '-' + crypto.randomUUID(); }

/* No Access-Control-Allow-Origin. This used to send '*' on every response,
   including the ones carrying a 30-day session token, so any website the
   visitor opened could drive sign-in through their browser and read the token
   straight out of the response. Sign-in is same-origin; foreign pages get
   nothing back. */
function r(code, body) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

/* Passwords were stored as a single unsalted SHA-256. That is a fast hash with
   no per-user salt: one rainbow table covers every account at once, and a GPU
   walks a wordlist through it at billions of guesses a second. scrypt is
   deliberately slow and memory-hard, and the salt makes each account its own
   problem.

   Stored form: scrypt$<saltHex>$<keyHex>. A bare 64-char hex string is a
   legacy SHA-256 record — it is still accepted at sign-in so nobody is locked
   out, and the record is rewritten in the new form the moment the correct
   password proves itself. */
const SCRYPT_KEYLEN = 64;
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return 'scrypt$' + salt.toString('hex') + '$' + key.toString('hex');
}
function sameBytes(a, b) {
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}
/* Returns { ok, legacy }. Comparison is constant-time either way: the old
   `u.password_hash !== hash` returned as soon as two bytes differed, which
   leaks how much of a guess was right. */
function checkPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return { ok: false, legacy: false };
  if (stored.startsWith('scrypt$')) {
    const [, saltHex, keyHex] = stored.split('$');
    if (!saltHex || !keyHex) return { ok: false, legacy: false };
    let key;
    try {
      key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
    } catch { return { ok: false, legacy: false }; }
    return { ok: sameBytes(key.toString('hex'), keyHex), legacy: false };
  }
  const legacyHash = crypto.createHash('sha256').update(String(password)).digest('hex');
  return { ok: sameBytes(legacyHash, stored), legacy: true };
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function fbGet(path) {
  const res = await fetch(`${DB}/${path}.json?auth=${SECRET}`);
  return res.ok ? await res.json() : null;
}
async function fbPost(path, data) {
  const res = await fetch(`${DB}/${path}.json?auth=${SECRET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return res.ok ? await res.json() : null;
}
async function fbPatch(path, data) {
  const res = await fetch(`${DB}/${path}.json?auth=${SECRET}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return res.ok ? await res.json() : null;
}
async function fbDelete(path) {
  await fetch(`${DB}/${path}.json?auth=${SECRET}`, { method: 'DELETE' });
}
/* `field` and `value` land inside a JSON-quoted query parameter. They were
   interpolated raw, and `value` is caller-supplied on the verify path — a
   token containing a quote or an ampersand rewrote the query. Both are
   encoded, and `field` is restricted to the identifiers this file actually
   uses. */
async function fbQuery(path, field, value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(field)) throw new Error('bad query field');
  const q = `orderBy=${encodeURIComponent('"' + field + '"')}` +
            `&equalTo=${encodeURIComponent(JSON.stringify(String(value)))}`;
  const res = await fetch(`${DB}/${encodeURIComponent(path)}.json?auth=${encodeURIComponent(SECRET)}&${q}`);
  return res.ok ? await res.json() : null;
}

// Find user by email — returns {id, ...userData} or null
async function findUser(email) {
  const data = await fbQuery('users', 'email', email.toLowerCase());
  if (!data) return null;
  const keys = Object.keys(data);
  if (!keys.length) return null;
  return { id: keys[0], ...data[keys[0]] };
}

// The ONLY accounts allowed to log in. All other logins removed.
const ALLOWED_LOGINS = ['mz465@shotbreak.io', 'kz465@shotbreak.io', 'hz465@shotbreak.io', 'rz465@shotbreak.io', 'dz465@shotbreak.io'];

async function login(email, password) {
  if (!email || !password) return r(400, { error: 'Email and password required' });
  if (!ALLOWED_LOGINS.includes(String(email).toLowerCase().trim())) {
    return r(401, { error: 'Invalid email or password' });
  }
  const u = await findUser(email);
  const check = u ? checkPassword(password, u.password_hash) : { ok: false, legacy: false };
  if (!u || !check.ok) return r(401, { error: 'Invalid email or password' });
  /* Correct password against a legacy unsalted record — rewrite it now, while
     the plaintext is in hand and can be re-hashed properly. */
  if (check.legacy) {
    try { await fbPatch('users/' + u.id, { password_hash: hashPassword(password) }); }
    catch (e) { console.error('password rehash failed', e); }
  }
  if (u.role === 'subscriber' && u.subscription_status !== 'active') return r(403, { error: 'Subscription inactive. Please renew.' });

  const token = makeToken();
  await fbPost('sessions', { user_id: u.id, token, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });
  return r(200, { token, user: { id: u.id, name: u.name, email: u.email, role: u.role, tier: u.tier || 'core' } });
}

async function signup(name, email, password) {
  // Public signup disabled — access is limited to the two provisioned accounts.
  if (!ALLOWED_LOGINS.includes(String(email || '').toLowerCase().trim())) {
    return r(403, { error: 'Signups are closed — invite only.' });
  }
  if (!name || !email || !password) return r(400, { error: 'All fields required' });
  if (password.length < 8) return r(400, { error: 'Password must be at least 8 characters' });
  email = email.toLowerCase().trim();
  const hash = hashPassword(password);
  const existing = await findUser(email);

  let userId;
  if (existing) {
    if (existing.password_hash) return r(409, { error: 'Account exists. Please log in.' });
    await fbPatch('users/' + existing.id, { name: name.trim(), password_hash: hash });
    userId = existing.id;
  } else {
    const ref = await fbPost('users', { email, name: name.trim(), password_hash: hash, role: 'subscriber', subscription_status: 'pending', created_at: new Date().toISOString() });
    userId = ref?.name;
  }
  if (!userId) return r(500, { error: 'Failed to create account' });

  const u = await fbGet('users/' + userId);
  const token = makeToken();
  await fbPost('sessions', { user_id: userId, token, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });

  // Notify owners (fire and forget — don't block signup)
  notifyOwners(name, email).catch(e => console.error('Notification error:', e));

  return r(200, { token, user: { id: userId, name: u.name, email: u.email, role: u.role, tier: u.tier || 'core' } });
}

// ── Owner Notifications (private — emails never exposed to frontend) ──
const OWNER_EMAILS = [
  'mz465@shotbreak.io',
  'kz465@shotbreak.io',
  'hz465@shotbreak.io',
  'rz465@shotbreak.io',
  'dz465@shotbreak.io'
];

async function notifyOwners(name, email) {
  // 1. Always log to Firebase
  await fbPost('signup_notifications', {
    name, email,
    timestamp: new Date().toISOString(),
    read: false
  });

  // 2. Send email if Resend API key is configured
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (RESEND_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Cinamate <notifications@shotbreak.io>',
          to: OWNER_EMAILS,
          subject: 'New Cinamate Signup',
          html: `<div style="font-family:sans-serif;max-width:500px">
            <h2 style="color:#4f8fff">New Account Created</h2>
            <p><strong>Name:</strong> ${escHtml(name)}</p>
            <p><strong>Email:</strong> ${escHtml(email)}</p>
            <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST</p>
            <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
            <p style="font-size:12px;color:#888">Check Firebase Realtime Database → users for full details.</p>
          </div>`
        })
      });
      console.log('Signup notification email sent for', email);
    } catch (e) { console.error('Email send failed:', e); }
  }
}

async function verify(token) {
  if (!token) return r(401, { error: 'No token' });
  const data = await fbQuery('sessions', 'token', token);
  if (!data) return r(401, { error: 'Session expired' });
  const keys = Object.keys(data);
  if (!keys.length) return r(401, { error: 'Session expired' });

  const session = data[keys[0]];
  if (new Date(session.expires_at) < new Date()) return r(401, { error: 'Session expired' });

  const u = await fbGet('users/' + session.user_id);
  if (!u) return r(401, { error: 'User not found' });
  // Pre-lockdown sessions for removed accounts are dead on arrival
  if (!ALLOWED_LOGINS.includes(String(u.email || '').toLowerCase().trim())) {
    return r(401, { error: 'Session expired' });
  }
  return r(200, { user: { id: session.user_id, name: u.name, email: u.email, role: u.role, tier: u.tier || 'core', subscription_status: u.subscription_status } });
}

async function logout(token) {
  if (token) {
    const data = await fbQuery('sessions', 'token', token);
    if (data) { for (const key of Object.keys(data)) await fbDelete('sessions/' + key); }
  }
  return r(200, { ok: true });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return r(200, {});
  if (event.httpMethod !== 'POST') return r(405, { error: 'POST only' });
  if (!SECRET) return r(500, { error: 'Server not configured — set FIREBASE_DB_SECRET' });
  try {
    const body = JSON.parse(event.body || '{}');
    switch (body.action) {
      case 'login': return await login(body.email, body.password);
      case 'signup': return await signup(body.name, body.email, body.password);
      case 'verify': return await verify(body.token);
      case 'logout': return await logout(body.token);
      default: return r(400, { error: 'Unknown action' });
    }
  } catch (e) {
    /* The message can carry a stack path, a database URL or part of the
       secret-bearing request. It goes to the function log, not the caller. */
    console.error('auth handler failed', e);
    return r(500, { error: 'Request failed' });
  }
};