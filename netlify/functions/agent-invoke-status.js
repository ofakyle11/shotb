// netlify/functions/agent-invoke-status.js
// Polls the status of an async agent job started via agent-invoke-start.

'use strict';

const { callLLM } = require('./lib/llm');
const { getAgent } = require('../../agents/registry');
const { verifyToken } = require('./lib/verify-token');

// Import the job store from the start function (simple shared module pattern for MVP)
const startModule = require('./agent-invoke-start');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});

  const jobId = (event.queryStringParameters && event.queryStringParameters.job_id) ||
                (event.body && JSON.parse(event.body || '{}').job_id);

  if (!jobId) return respond(400, { error: 'job_id required' });

  let auth;
  try {
    auth = await verifyToken(event);
  } catch (e) {
    return respond(401, { error: e.message || 'AUTH_FAIL' });
  }

  let job = startModule.getJob ? startModule.getJob(jobId) : null;

  if (!job) {
    return respond(404, { error: 'Job not found or expired' });
  }

  // Simple ownership check (basic)
  if (!job.isOwner && job.uid !== auth.uid) {
    return respond(403, { error: 'Not authorized for this job' });
  }

  // If still pending, run the actual work now (MVP approach)
  if (job.status === 'pending') {
    try {
      const agent = getAgent(job.agent_id);
      const result = await callLLM(agent, job.input, job.context);

      const updated = {
        status: 'done',
        result: result.structured || result.raw,
        raw: result,
        completedAt: Date.now(),
      };

      if (startModule.updateJob) startModule.updateJob(jobId, updated);
      job = { ...job, ...updated };
    } catch (e) {
      const updated = {
        status: 'error',
        error: e.message,
        completedAt: Date.now(),
      };
      if (startModule.updateJob) startModule.updateJob(jobId, updated);
      job = { ...job, ...updated };
    }
  }

  return respond(200, {
    jobId,
    status: job.status,
    result: job.result || null,
    error: job.error || null,
    createdAt: job.createdAt,
  });
};