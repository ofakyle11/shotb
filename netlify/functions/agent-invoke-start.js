// netlify/functions/agent-invoke-start.js
// Async job starter for long-running agent calls.
// Returns immediately with a jobId. Client polls agent-invoke-status.

'use strict';

const { getAgent } = require('../../agents/registry');
const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');

function respond(event, statusCode, body) {
  return { statusCode, headers: corsHeaders(event), body: JSON.stringify(body) };
}

// Simple in-memory job store (resets on cold start — fine for MVP).
// In production you would persist to Firestore or similar.
const jobs = new Map();

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

  const { agent_id, input, context } = payload;
  if (!agent_id) return respond(event, 400, { error: 'agent_id required' });

  let agent;
  try {
    agent = getAgent(agent_id);
  } catch (e) {
    return respond(event, 404, { error: e.message });
  }

  const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

  // For MVP: we store the request and mark as 'pending'.
  // A real implementation would use a queue or background processing.
  jobs.set(jobId, {
    status: 'pending',
    agent_id,
    input,
    context,
    createdAt: Date.now(),
    uid: auth.uid,
    isOwner: auth.isOwner,
    result: null,
    error: null,
  });

  // In a more advanced version you would kick off the actual work here
  // (e.g. via another function or a queue). For now the status endpoint
  // can run the work on first poll if still pending.

  return respond(event, 200, {
    jobId,
    status: 'pending',
  });
};

exports.getJob = (jobId) => jobs.get(jobId);
exports.updateJob = (jobId, data) => {
  const existing = jobs.get(jobId);
  if (existing) jobs.set(jobId, { ...existing, ...data });
};