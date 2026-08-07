'use strict';

// Relay for one-click SMS sending. The browser can't call Textbelt directly
// (no CORS), so the app posts {phone, message, key} here and this function
// forwards it. The Textbelt key lives in the app's Settings (localStorage);
// optionally set TEXTBELT_KEY in Netlify env vars to avoid sending it from
// the browser at all.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }
  let p;
  try { p = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) }; }

  const phone = String(p.phone || '').replace(/[^\d+]/g, '');
  const message = String(p.message || '').slice(0, 1500);
  const key = String(p.key || process.env.TEXTBELT_KEY || '');
  if (!phone || !message || !key) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ success: false, error: 'phone, message and key are required' }) };
  }

  try {
    const r = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key }),
    });
    const d = await r.json();
    return { statusCode: 200, headers: CORS, body: JSON.stringify(d) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ success: false, error: 'SMS gateway unreachable: ' + e.message }) };
  }
};
