const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');

exports.handler = async (event) => {
  const headers = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    await requireAuth(event);
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const key = process.env.WAVESPEED_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'WAVESPEED_API_KEY not set' }) };

  const requestId = event.queryStringParameters && event.queryStringParameters.id;
  if (!requestId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) };

  try {
    const resultUrl = `https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`;
    const ctrl = new AbortController();
    const tmo  = setTimeout(() => ctrl.abort(), 20000);
    let pollRes;
    try {
      pollRes = await fetch(resultUrl, { headers: { 'Authorization': `Bearer ${key}` }, signal: ctrl.signal });
    } finally { clearTimeout(tmo); }

    const rawText = await pollRes.text();
    let pollData;
    try { pollData = JSON.parse(rawText); }
    catch(e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Non-JSON response' }) };
    }

    const data = pollData.data || {};
    const rawStatus = data.status || pollData.status || 'processing';
    const STATUS_MAP = { succeed: 'completed', succeeded: 'completed', complete: 'completed', fail: 'failed', failure: 'failed' };
    const status = STATUS_MAP[rawStatus] || rawStatus;
    const outputs = data.outputs || [];
    const firstOutput = outputs[0];
    const imageUrl = (firstOutput && typeof firstOutput === 'object' ? firstOutput.url : firstOutput) || null;
    const error = data.error || null;
    return { statusCode: 200, headers, body: JSON.stringify({ status, imageUrl, error }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Status check failed' }) };
  }
};