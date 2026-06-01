// ═════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Agent Orchestration (multi-agent chains)
//  Same auth + credit model as agent-invoke.js. Runs 4 modes:
//    auteur_plan       — 50 credits.  AUTEUR alone; returns execution plan.
//    showrunner_cut    — 50 credits.  SHOWRUNNER alone; returns cut JSON.
//    full_production   — 150 credits.  AUTEUR -> planned specialists -> SHOWRUNNER.
//    custom_chain      — variable.    Caller specifies the specialist chain.
//
//  POST /.netlify/functions/agent-orchestrate
//  Headers:  Authorization: Bearer <HMAC-owner-token | firebase-idToken>
//  Body:     { mode, input, chain?, timeline?, context? }
// ═════════════════════════════════════════════════════════════════════════

'use strict';

const { getAgent, AGENTS } = require('../../agents/registry');
const { callLLM } = require('./lib/llm');

const FIREBASE_PROJECT_ID = () => process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY    = () => process.env.FIREBASE_API_KEY;
const FIRESTORE_BASE      = () =>
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID()}/databases/(default)/documents`;

// Shared auth/token verification (single source of truth)
const { verifyToken, getSystemToken, rawTokenFromEvent } = require('./lib/verify-token');

const VALID_DEDUCTIONS = [5, 15, 20, 50, 75, 150, 250];

const MODE_COSTS = {
  auteur_plan:     50,
  showrunner_cut:  50,
  full_production: 150,
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function roundUpToValidTier(amount) {
  for (const v of VALID_DEDUCTIONS) if (v >= amount) return v;
  return VALID_DEDUCTIONS[VALID_DEDUCTIONS.length - 1];
}



async function readUser(uid) {
  const token = await getSystemToken();
  if (token === 'bypass_system_token_for_owners') {
    return { tier: 'owner', credits: 999999 };
  }
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
  if (token === 'bypass_system_token_for_owners') {
    return; // no-op during bypass
  }
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

// ── Thin agent runner (delegates to the shared LLM abstraction)
//    Supports both 'anthropic' and 'grok' via env LLM_PROVIDER or explicit.
async function runAgent(agent, input, context) {
  const llmResult = await callLLM(agent, input, context);  // provider resolved inside callLLM

  const textBlocks = llmResult.text || llmResult.raw || '';

  // Structured parse (for agents declaring outputFormat: 'json' in registry)
  let structured = llmResult.structured || null;
  let parseError = llmResult.parse_error || null;
  if (!structured && agent.outputFormat === 'json' && typeof textBlocks === 'string') {
    const cleaned = textBlocks.replace(/```json\s*|\s*```/g, '').trim();
    try { structured = JSON.parse(cleaned); }
    catch (e) { parseError = e.message; }
  }

  return {
    raw: textBlocks,
    structured,
    parse_error: parseError,
    usage: llmResult.usage || (llmResult.raw && llmResult.raw.usage) || null,
    provider: llmResult.provider,
    model_used: llmResult.model_used || null,
    fell_back: llmResult.fell_back || false,
  };
}

// ── Chain runners ───────────────────────────────────────────────────────
async function runChain(agentIds, input, seedContext) {
  const results = [];
  let rollingContext = seedContext || {};
  for (const id of agentIds) {
    const agent = getAgent(id);
    const out = await runAgent(agent, input, rollingContext);
    results.push({ agent_id: id, agent_name: agent.name, ...out });
    rollingContext = { ...rollingContext, [id]: out.structured || out.raw };
  }
  return { results, context: rollingContext };
}

// ── Handler ─────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'POST only' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON body' }); }

  const { mode, input, chain, timeline, context } = payload;
  if (!mode) return respond(400, { error: 'mode required' });

  // Compute credit cost up front. For custom chains, round up to a valid tier.
  let cost;
  if (mode === 'custom_chain') {
    if (!Array.isArray(chain) || chain.length === 0) {
      return respond(400, { error: 'chain[] required for custom_chain' });
    }
    let raw = 0;
    try { raw = chain.reduce((n, id) => n + getAgent(id).credits, 0); }
    catch (e) { return respond(404, { error: e.message }); }
    cost = roundUpToValidTier(raw);
  } else if (MODE_COSTS[mode]) {
    cost = MODE_COSTS[mode];
  } else {
    return respond(400, { error: 'Unknown mode: ' + mode });
  }

  // Auth
  let auth;
  try { auth = await verifyToken(event); }
  catch (e) { return respond(401, { error: e.message || 'AUTH_FAIL' }); }

  // Credit pre-check
  let userCredits = 0;
  const bypassActive = (process.env.SYSTEM_TOKEN_BYPASS === 'true' || process.env.SYSTEM_TOKEN_BYPASS === '1');

  if (!auth.isOwner) {
    if (bypassActive) {
      return respond(403, {
        error: 'Temporarily restricted to owners only. The system user is being reconfigured. Please try again later or contact an owner.'
      });
    }

    let user;
    try { user = await readUser(auth.uid); }
    catch (e) { return respond(500, { error: 'Credit lookup failed: ' + e.message }); }
    userCredits = user?.credits || 0;
    if (userCredits < cost) {
      return respond(402, {
        error: 'Insufficient credits', required: cost,
        available: userCredits, credits_remaining: userCredits,
      });
    }
    try { await setCredits(auth.uid, userCredits - cost); }
    catch (e) { return respond(500, { error: 'Credit deduction failed: ' + e.message }); }
  }

  // Run
  let output;
  try {
    if (mode === 'auteur_plan') {
      const auteur = getAgent('auteur');
      const out = await runAgent(auteur, input, context);
      output = { mode, auteur: out, result: out.structured || out.raw };
    } else if (mode === 'showrunner_cut') {
      const showrunner = getAgent('showrunner');
      const out = await runAgent(showrunner, timeline || input, context);
      output = { mode, showrunner: out, result: out.structured || out.raw };
    } else if (mode === 'full_production') {
      const auteur = getAgent('auteur');
      const plan = await runAgent(auteur, input, context);
      const raw_plan = Array.isArray(plan.structured?.agent_plan) ? plan.structured.agent_plan : [];
      const specialists = raw_plan
        .map(step => step && typeof step === 'object' ? step.agent_id : step)
        .filter(id => typeof id === 'string')
        .filter(id => {
          const a = AGENTS.find(x => x.id === id);
          return a && a.wing !== 'orchestrator';
        });
      const chainResult = specialists.length
        ? await runChain(specialists, input, { auteur_plan: plan.structured || plan.raw })
        : { results: [], context: { auteur_plan: plan.structured || plan.raw } };
      const showrunner = getAgent('showrunner');
      const review = await runAgent(showrunner, timeline || input, chainResult.context);
      output = {
        mode,
        auteur:      plan,
        specialists: chainResult.results,
        showrunner:  review,
        result: {
          plan:        plan.structured || plan.raw,
          specialists: chainResult.results.map(r => ({
            agent_id: r.agent_id, agent_name: r.agent_name,
            output: r.structured || r.raw,
          })),
          cut:         review.structured || review.raw,
        },
      };
    } else if (mode === 'custom_chain') {
      const chainResult = await runChain(chain, input, context);
      output = {
        mode,
        chain:   chain,
        results: chainResult.results,
        result:  chainResult.results.map(r => ({
          agent_id: r.agent_id, output: r.structured || r.raw,
        })),
      };
    }
  } catch (e) {
    if (!auth.isOwner) {
      try { await setCredits(auth.uid, userCredits); } catch (_) {}
    }
    return respond(502, { error: 'Orchestration failed', detail: e.message });
  }

  return respond(200, {
    ok:                true,
    ...output,
    credits_charged:   auth.isOwner ? 0 : cost,
    credits_remaining: auth.isOwner ? 999999 : userCredits - cost,
    is_owner:          auth.isOwner,
  });
};