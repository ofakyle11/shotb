const crypto = require('crypto');

const DB = 'https://shotbreak-9f342-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;

function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex'); }
function makeToken() { return crypto.randomUUID() + '-' + crypto.randomUUID(); }
function r(code, body) {
  return { statusCode: code, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
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
async function fbQuery(path, field, value) {
  const res = await fetch(`${DB}/${path}.json?auth=${SECRET}&orderBy="${field}"&equalTo="${value}"`);
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

async function login(email, password) {
  if (!email || !password) return r(400, { error: 'Email and password required' });
  const hash = sha256(password);
  const u = await findUser(email);
  if (!u || u.password_hash !== hash) return r(401, { error: 'Invalid email or password' });
  if (u.role === 'subscriber' && u.subscription_status !== 'active') return r(403, { error: 'Subscription inactive. Please renew.' });

  const token = makeToken();
  await fbPost('sessions', { user_id: u.id, token, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });
  return r(200, { token, user: { id: u.id, name: u.name, email: u.email, role: u.role, tier: u.tier || 'core' } });
}

async function signup(name, email, password) {
  if (!name || !email || !password) return r(400, { error: 'All fields required' });
  if (password.length < 8) return r(400, { error: 'Password must be at least 8 characters' });
  email = email.toLowerCase().trim();
  const hash = sha256(password);
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
const OWNER_EMAILS = ['kyle@shotbreak.io', 'scott@shotbreak.io', 'steve@shotbreak.io'];

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
          from: 'Shotbreak <notifications@shotbreak.io>',
          to: OWNER_EMAILS,
          subject: 'New Shotbreak Signup: ' + name,
          html: `<div style="font-family:sans-serif;max-width:500px">
            <h2 style="color:#4f8fff">New Account Created</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
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
  } catch (e) { console.error(e); return r(500, { error: e.message }); }
};