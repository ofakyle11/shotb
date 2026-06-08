// netlify/functions/agent-invoke-status.js
// Polls the status of an async agent job started via agent-invoke-start.

'use strict';

const { callLLM } = require('./lib/llm');
const { getAgent } = require('../../agents/registry');
const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');

// Import the job store from the start function (simple shared module pattern for MVP)
const startModule = require('./agent-invoke-start');

function respond(event, statusCode, body) {
  return { statusCode, headers: corsHeaders(event), body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(event, 204, {});

  const jobId = (event.queryStringParameters && event.queryStringParameters.job_id) ||
                (event.body && JSON.parse(event.body || '{}').job_id);

  if (!jobId) return respond(event, 400, { error: 'job_id required' });

  let auth;
  try {
    auth = await requireAuth(event);
  } catch (e) {
    return respond(event, 401, { error: 'Unauthorized' });
  }

  let job = startModule.getJob ? startModule.getJob(jobId) : null;

  if (!job) {
    return respond(event, 404, { error: 'Job not found or expired' });
  }

  if (!job.isOwner && job.uid !== auth.uid) {
    return respond(event, 403, { error: 'Not authorized for this job' });
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

  return respond(event, 200, {
    jobId,
    status: job.status,
    result: job.result || null,
    error: job.error || null,
    createdAt: job.createdAt,
  });
};