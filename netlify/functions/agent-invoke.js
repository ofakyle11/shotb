// ═════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Agent Invocation (single-agent)
//  Mirrors generate-video.js auth + credit logic exactly. No Admin SDK.
//
//  POST /.netlify/functions/agent-invoke
//  Headers:  Authorization: Bearer <HMAC-owner-token | firebase-idToken>
//  Body:     { agent_id, input, context? }
//
//  ENV VARS (all already configured for SHOTBREAK):
//    FIREBASE_API_KEY
//    FIREBASE_PROJECT_ID
//    OWNER_TOKEN_SECRET     (used by verify-owner.js)
//    SYSTEM_EMAIL           (system account for server-authorised Firestore writes)
//    SYSTEM_PASSWORD
//    GROK_API_KEY or XAI_API_KEY   (required now — Anthropic key no longer needed)
// ═════════════════════════════════════════════════════════════════════════

'use strict';

const { getAgent } = require('../../agents/registry');
const { callLLM } = require('./lib/llm');

const FIREBASE_PROJECT_ID = () => process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY    = () => process.env.FIREBASE_API_KEY;
const FIRESTORE_BASE      = () =>
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID()}/databases/(default)/documents`;

// Shared auth/token verification (single source of truth)
const { verifyToken, getSystemToken, rawTokenFromEvent } = require('./lib/verify-token');

const VALID_DEDUCTIONS = new Set([5, 15, 20, 50, 75, 150, 250]);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}



// ── Firestore read/write via SYSTEM token ───────────────────────────────
async function readUser(uid) {
  const token = await getSystemToken();
  const r = await fetch(
    `${FIRESTORE_BASE()}/users/${uid}`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('READ_FAIL_' + r.status);
  const d = await r.json();
  const f = d.fields || {};
  return {
    tier:    f.tier?.stringValue || 'free',
    credits: parseInt(f.credits?.integerValue || '0', 10),
  };
}

async function setCredits(uid, newCredits) {
  const token = await getSystemToken();
  const url = `${FIRESTORE_BASE()}/users/${uid}?updateMask.fieldPaths=credits`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization:  'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: { credits: { integerValue: String(newCredits) } },
    }),
  });
  if (!r.ok) throw new Error('WRITE_FAIL_' + r.status);
}

// LLM logic moved to lib/llm.js (callLLM handles Anthropic robust path + Grok).
// This stub prevents any accidental use of the old local implementation.
async function callAnthropic(agent, input, context) {
  throw new Error('callAnthropic local stub in agent-invoke — use callLLM instead');
}
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'POST only' });

  // Start timer for telemetry — captures end-to-end duration per agent call.
  const startMs = Date.now();

  // Log helper — writes a single JSON line to Netlify function logs with all
  // the fields an admin dashboard will eventually want. Costs nothing, runs
  // on every call, and gives us historical telemetry even before we build
  // the dashboard. Filter in Netlify logs by searching `"SB_AGENT_LOG"`.
  const logTelemetry = (fields) => {
    try {
      const line = {
        tag:            'SB_AGENT_LOG',
        ts:             new Date().toISOString(),
        duration_ms:    Date.now() - startMs,
        agent_id:       fields.agent_id || null,
        agent_tier:     fields.agent_tier || null,
        uid:            fields.uid || null,
        email:          fields.email || null,
        is_owner:       fields.is_owner || false,
        status:         fields.status,        // 'ok' | 'error' | 'rejected'
        http_status:    fields.http_status || null,
        credits:        fields.credits || 0,
        input_tokens:   fields.input_tokens || null,
        output_tokens:  fields.output_tokens || null,
        parse_error:    fields.parse_error || null,
        error_code:     fields.error_code || null,
        error_msg:      fields.error_msg || null,
      };
      // Single-line JSON for grep-ability in Netlify log viewer.
      console.log(JSON.stringify(line));
    } catch (e) { /* telemetry never breaks the request */ }
  };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch {
    logTelemetry({ status: 'rejected', http_status: 400, error_code: 'BAD_JSON' });
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { agent_id, input, context } = payload;
  if (!agent_id)           { logTelemetry({ status: 'rejected', http_status: 400, error_code: 'NO_AGENT_ID' }); return respond(400, { error: 'agent_id required' }); }
  if (input === undefined) { logTelemetry({ status: 'rejected', http_status: 400, error_code: 'NO_INPUT', agent_id }); return respond(400, { error: 'input required' }); }

  let agent;
  try { agent = getAgent(agent_id); }
  catch (e) { logTelemetry({ agent_id, status: 'rejected', http_status: 404, error_code: 'AGENT_NOT_FOUND', error_msg: e.message }); return respond(404, { error: e.message }); }

  if (!VALID_DEDUCTIONS.has(agent.credits)) {
    logTelemetry({ agent_id, agent_tier: agent.tier, status: 'error', http_status: 500, error_code: 'INVALID_CREDITS', credits: agent.credits });
    return respond(500, {
      error: `Agent credit cost ${agent.credits} is not a valid Firestore deduction amount`,
    });
  }

  // Auth
  let auth;
  try { auth = await verifyToken(event); }
  catch (e) { logTelemetry({ agent_id, agent_tier: agent.tier, status: 'rejected', http_status: 401, error_code: 'AUTH_FAIL', error_msg: e.message }); return respond(401, { error: e.message || 'AUTH_FAIL' }); }

  // Credit pre-check (customers only; owners skip)
  let userCredits = 0;
  if (!auth.isOwner) {
    let user;
    try { user = await readUser(auth.uid); }
    catch (e) { logTelemetry({ agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, status: 'error', http_status: 500, error_code: 'CREDIT_LOOKUP_FAIL', error_msg: e.message }); return respond(500, { error: 'Credit lookup failed: ' + e.message }); }
    userCredits = user?.credits || 0;
    if (userCredits < agent.credits) {
      logTelemetry({ agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, status: 'rejected', http_status: 402, error_code: 'INSUFFICIENT_CREDITS', credits: agent.credits });
      return respond(402, {
        error:             'Insufficient credits',
        required:          agent.credits,
        available:         userCredits,
        credits_remaining: userCredits,
      });
    }
    // Deduct BEFORE the call (mirrors generate-video.js); refund on failure.
    try { await setCredits(auth.uid, userCredits - agent.credits); }
    catch (e) { logTelemetry({ agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, status: 'error', http_status: 500, error_code: 'CREDIT_DEDUCT_FAIL', error_msg: e.message }); return respond(500, { error: 'Credit deduction failed: ' + e.message }); }
  }

  // Run the agent (provider chosen by LLM_PROVIDER env or default; supports grok)
  let result;
  try {
    result = await callLLM(agent, input, context);
  } catch (e) {
    if (!auth.isOwner) {
      try { await setCredits(auth.uid, userCredits); } catch (_) {}
    }
    logTelemetry({
      agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, is_owner: auth.isOwner,
      status: 'error', http_status: 502, error_code: 'LLM_FAIL', error_msg: e.message,
      credits: auth.isOwner ? 0 : agent.credits,
    });
    return respond(502, { error: 'Agent invocation failed', detail: e.message });
  }

  // Success — log the full stats for this call.
  logTelemetry({
    agent_id, agent_tier: agent.tier, uid: auth.uid, email: auth.email, is_owner: auth.isOwner,
    status:        'ok', http_status: 200,
    credits:       auth.isOwner ? 0 : agent.credits,
    input_tokens:  result.usage?.input_tokens || null,
    output_tokens: result.usage?.output_tokens || null,
    parse_error:   result.parse_error || null,
  });

  return respond(200, {
    ok:                true,
    agent_id,
    agent_name:        agent.name,
    output:            result.structured || result.raw,
    result:            result.structured || result.raw,
    raw:               result.raw,
    parse_error:       result.parse_error,
    credits_charged:   auth.isOwner ? 0 : agent.credits,
    credits_remaining: auth.isOwner ? 999999 : userCredits - agent.credits,
    usage:             result.usage,
    is_owner:          auth.isOwner,
  });
};
