const crypto = require('crypto');

const DB = 'https://shotbreak-9f342-default-rtdb.firebaseio.com';
const SECRET = process.env.FIREBASE_DB_SECRET;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Map Stripe amounts (in cents CAD) to tiers
function amountToTier(cents) {
  if (cents >= 9500) return 'institutional'; // CA$99.99 = 9999
  if (cents >= 4500) return 'pro';           // CA$49.99 = 4999
  return 'core';                              // CA$29.99 = 2999
}

async function fbQuery(path, field, value) {
  const res = await fetch(`${DB}/${path}.json?auth=${SECRET}&orderBy="${field}"&equalTo="${value}"`);
  return res.ok ? await res.json() : null;
}
async function fbPost(path, data) {
  await fetch(`${DB}/${path}.json?auth=${SECRET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
async function fbPatch(path, data) {
  await fetch(`${DB}/${path}.json?auth=${SECRET}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

function verifySig(payload, sig) {
  if (!STRIPE_WEBHOOK_SECRET) return false;
  try {
    const parts = sig.split(',');
    const ts = parts.find(p => p.startsWith('t=')).split('=')[1];
    const v1 = parts.find(p => p.startsWith('v1=')).split('=')[1];
    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  } catch (e) { return false; }
}

async function updateUser(email, customerId, status, tier) {
  if (!email) return;
  email = email.toLowerCase();
  const data = await fbQuery('users', 'email', email);
  const updates = { stripe_customer_id: customerId, subscription_status: status };
  if (tier) updates.tier = tier;
  
  if (data && Object.keys(data).length) {
    const key = Object.keys(data)[0];
    await fbPatch('users/' + key, updates);
  } else {
    await fbPost('users', { email, name: email.split('@')[0], password_hash: '', role: 'subscriber', ...updates, created_at: new Date().toISOString() });
  }
  console.log(`${email}: status=${status}, tier=${tier || 'unchanged'}`);
}

async function updateByCustomer(customerId, updates) {
  const data = await fbQuery('users', 'stripe_customer_id', customerId);
  if (data && Object.keys(data).length) {
    const key = Object.keys(data)[0];
    await fbPatch('users/' + key, updates);
    console.log(`Customer ${customerId}: ${JSON.stringify(updates)}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const sig = event.headers['stripe-signature'];
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured');
    return { statusCode: 500, body: 'Webhook secret not configured' };
  }
  if (!verifySig(event.body, sig)) return { statusCode: 400, body: 'Bad signature' };
  
  try {
    const ev = JSON.parse(event.body);
    const obj = ev.data.object;
    console.log('Stripe:', ev.type);
    
    switch (ev.type) {
      case 'checkout.session.completed': {
        const email = obj.customer_email || obj.customer_details?.email;
        const customerId = obj.customer;
        const amount = obj.amount_total || 0;
        const tier = amountToTier(amount);
        if (email) await updateUser(email, customerId, 'active', tier);
        break;
      }
      
      case 'customer.subscription.updated': {
        const st = (obj.status === 'active' || obj.status === 'trialing') ? 'active' : 'inactive';
        const updates = { subscription_status: st };
        // Check if plan changed — get amount from subscription items
        if (obj.items?.data?.[0]?.price?.unit_amount) {
          updates.tier = amountToTier(obj.items.data[0].price.unit_amount);
        }
        await updateByCustomer(obj.customer, updates);
        break;
      }
      
      case 'customer.subscription.deleted':
        await updateByCustomer(obj.customer, { subscription_status: 'cancelled', tier: 'none' });
        break;
        
      case 'invoice.payment_failed':
        await updateByCustomer(obj.customer, { subscription_status: 'past_due' });
        break;
    }
    
    return { statusCode: 200, body: '{"received":true}' };
  } catch (e) { console.error(e); return { statusCode: 500, body: e.message }; }
};
