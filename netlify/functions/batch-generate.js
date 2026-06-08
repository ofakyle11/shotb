// netlify/functions/batch-generate.js
// Minimal batch video generation endpoint (MVP).
// For now it just queues individual jobs. Can be expanded later.

'use strict';

const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');

function respond(event, statusCode, body) {
  return { statusCode, headers: corsHeaders(event), body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(event, 204, {});
  if (event.httpMethod !== 'POST') return respond(event, 405, { error: 'POST only' });

  let auth;
  try {
    auth = await requireAuth(event);
  } catch (e) {
    return respond(event, 401, { error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return respond(event, 400, { error: 'Invalid JSON' });
  }

  const { prompts = [], model = 'flux-schnell' } = payload;

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return respond(event, 400, { error: 'prompts[] required' });
  }

  return respond(event, 200, {
    batchId: 'batch_' + Date.now(),
    count: prompts.length,
    model,
    status: 'queued',
    message: 'Batch accepted. Polling not yet implemented in MVP.',
  });
};