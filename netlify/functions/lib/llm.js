// ═════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — LLM Provider Abstraction Layer
//  Supports multiple providers cleanly (Anthropic + Grok/xAI for now)
//
//  CURRENT MODE: MAX POWER (Grok)
//  - All agents use grok-3 (strongest model)
//  - Higher max_tokens baseline for better structured creative output
//  - Optimized for quality over speed/cost
// ═════════════════════════════════════════════════════════════════════════
//
// Usage:
//   const { callLLM } = require('./lib/llm');
//   const result = await callLLM(agent, input, context, 'grok');
//
// Providers supported:
//   - 'anthropic'  (Claude models via Anthropic API)
//   - 'grok'       (Grok models via xAI API — OpenAI compatible)
//
// Current default behavior (optimized for maximum power):
//   - If you only have a GROK/XAI key → uses Grok + the strongest model on important agents
//   - Tier-1 managers, directors, showrunner, and auteur automatically get grok-3 (not the mini version)
//   - Explicit LLM_PROVIDER env var always wins if you want to force something
//
// Switching / forcing a provider:
//   1. Per-call: callLLM(agent, input, context, 'grok')
//   2. Globally: set LLM_PROVIDER=grok (or anthropic) in Netlify env vars
//
// This is the single place that should know how to talk to different LLMs.

'use strict';

const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const GROK_BASE_URL       = 'https://api.x.ai/v1';

// Power vs speed models — MAX POWER MODE enabled
const GROK_POWER_MODEL    = 'grok-3';        // Most capable model — used for everything in this snapshot
const GROK_FAST_MODEL     = 'grok-3-mini';   // Only use if you later want to trade quality for speed/cost
const GROK_MODEL          = GROK_POWER_MODEL;

// Tuned timeouts / budgets for Netlify 26s ceiling (shared with prior agent-invoke logic)
const SONNET_TIMEOUT_MS = 17000;
const FALLBACK_MODEL    = 'claude-haiku-4-5-20251001';
const FALLBACK_MIN_BUDGET_MS = 8000;
const NETLIFY_BUDGET_MS = 26000;

// ───────────────────────────────────────────────────
// Provider & model resolution (single place to map claude-* names for Grok etc.)
// ───────────────────────────────────────────────────
function getProviderForAgent(agent, explicitProvider) {
  if (explicitProvider) {
    const p = String(explicitProvider).toLowerCase();
    if (p === 'grok' || p === 'xai' || p === 'grok-3') return 'grok';
    if (p === 'anthropic' || p === 'claude') return 'anthropic';
  }
  if (agent && agent.provider) {
    const p = String(agent.provider).toLowerCase();
    if (p === 'grok' || p === 'xai') return 'grok';
    if (p === 'anthropic') return 'anthropic';
  }
  // Smart default: respect explicit LLM_PROVIDER, otherwise auto-detect based on which keys exist.
  // This makes it "just work" when you only have a Grok/xAI key.
  const envProvider = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (envProvider === 'grok' || envProvider === 'xai' || envProvider === 'grok-3') return 'grok';
  if (envProvider === 'anthropic' || envProvider === 'claude') return 'anthropic';

  const hasGrokKey = !!(process.env.GROK_API_KEY || process.env.XAI_API_KEY);
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

  if (hasGrokKey && !hasAnthropicKey) return 'grok';
  if (hasAnthropicKey && !hasGrokKey) return 'anthropic';

  // Both (or neither) present — fall back to explicit env or 'grok' as the new safe default for this project
  return envProvider || 'grok';
}

function resolveModel(agent, provider) {
  const raw = (agent && agent.model) || '';

  if (provider === 'grok' || provider === 'xai') {
    // If the agent already specifies a non-Claude model, respect it
    if (raw && !raw.startsWith('claude')) return raw;

    // MAX POWER MODE: every agent gets the strongest model
    return GROK_POWER_MODEL;
  }

  // Anthropic path — trust the registry
  return raw || 'claude-sonnet-4-6';
}

// ───────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────
async function callLLM(agent, input, context, provider) {
  const chosen = getProviderForAgent(agent, provider);

  if (chosen === 'grok' || chosen === 'xai') {
    return callGrok(agent, input, context);
  }

  return callAnthropic(agent, input, context);
}

// ───────────────────────────────────────────────────
// Internal helpers (salvage + retry logic, adapted from prior robust impl)
// ───────────────────────────────────────────────────
function salvagePartialArray(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:\s*\[/);
  if (!m) return null;
  const key = m[1];
  let i = m.index + m[0].length;
  const items = [];
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length) {
    if (text[i] !== '{') break;
    const start = i;
    let depth = 0;
    let inStr = false;
    let escape = false;
    let closed = false;
    while (i < text.length) {
      const ch = text[i];
      if (escape) { escape = false; i++; continue; }
      if (inStr) {
        if (ch === '\\') { escape = true; i++; continue; }
        if (ch === '"') inStr = false;
        i++; continue;
      }
      if (ch === '"') { inStr = true; i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { i++; closed = true; break; }
      }
      i++;
    }
    if (!closed) break;
    const objText = text.slice(start, i);
    try { items.push(JSON.parse(objText)); } catch (_) { /* malformed */ }
    while (i < text.length && /[ ,\s]/.test(text[i])) i++;
  }
  return items.length ? { key, items } : null;
}

async function tryModel(modelToUse, bodyBase, apiKey, maxRetries, timeoutMs, effectiveTimeout) {
  const effective = timeoutMs || SONNET_TIMEOUT_MS;
  let attempt = 0;
  const localBody = { ...bodyBase, model: modelToUse };
  while (true) {
    const abortCtrl = new AbortController();
    const abortTimer = setTimeout(() => abortCtrl.abort(), effective);
    try {
      const r = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type':      'application/json',
        },
        body:   JSON.stringify(localBody),
        signal: abortCtrl.signal,
      });
      clearTimeout(abortTimer);
      if (r.status !== 429 && r.status !== 529 && r.status !== 503) return r;
      attempt++;
      if (attempt > maxRetries) return r;
      const retryAfter = parseInt(r.headers.get('retry-after') || '0', 10);
      const backoffMs = Math.min(2000, 1000 * attempt);
      const delay = (retryAfter > 0 && retryAfter < 3) ? retryAfter * 1000 : backoffMs;
      await new Promise(r => setTimeout(r, delay));
    } catch (e) {
      clearTimeout(abortTimer);
      if (e.name === 'AbortError') {
        return { _stalled: true, status: 599, headers: { get: () => null } };
      }
      throw e;
    }
  }
}

// ───────────────────────────────────────────────────
// Anthropic Implementation — now the single robust home (retries, Haiku fallback,
// timeouts, partial-JSON salvage). This replaces all previous duplicated copies.
// ───────────────────────────────────────────────────
async function callAnthropic(agent, input, context) {
  const userMessage = typeof input === 'string' ? input : JSON.stringify(input, null, 2);

  // Context trimming (kept for compatibility with large crew contexts)
  let trimmedContext = context;
  if (context && typeof context === 'object') {
    const KEY_CAP = 15 * 1024;
    trimmedContext = {};
    for (const [k, v] of Object.entries(context)) {
      const s = JSON.stringify(v);
      if (s.length <= KEY_CAP) {
        trimmedContext[k] = v;
      } else {
        trimmedContext[k] = {
          _truncated: true,
          _original_size: s.length,
          _preview: s.slice(0, KEY_CAP) + '…[truncated]',
        };
      }
    }
  }

  const contextualBrief = trimmedContext
    ? `\n\n[CONTEXT FROM UPSTREAM AGENTS]\n${JSON.stringify(trimmedContext, null, 2)}`
    : '';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  const body = {
    model:      resolveModel(agent, 'anthropic'),
    // Raised for higher quality output (matches the Grok power-mode philosophy)
    max_tokens: agent.max_tokens || (agent.tier === 1 ? 1600 : 1200),
    system:     agent.systemPrompt,
    messages:   [{ role: 'user', content: `${userMessage}${contextualBrief}` }],
  };

  // Robust path (ported + adapted)
  let res, raw;
  let currentModel = resolveModel(agent, 'anthropic');
  let fellBack = false;

  const callStart = Date.now();

  // Try primary once. On stall/overload → Haiku with remaining budget.
  res = await tryModel(currentModel, body, apiKey, 0, null, SONNET_TIMEOUT_MS);

  const sonnetStalled = res._stalled === true;
  const sonnetOverloaded = res.status === 429 || res.status === 529 || res.status === 503;

  if (sonnetStalled || sonnetOverloaded) {
    const elapsed = Date.now() - callStart;
    const remaining = NETLIFY_BUDGET_MS - elapsed;
    if (remaining < FALLBACK_MIN_BUDGET_MS) {
      throw new Error(`Anthropic Sonnet stalled and only ${Math.round(remaining/1000)}s remaining for Haiku fallback (need ${FALLBACK_MIN_BUDGET_MS/1000}s minimum). Try again.`);
    }
    console.log(JSON.stringify({
      tag: 'SB_FALLBACK',
      ts: new Date().toISOString(),
      agent_id: agent && agent.id,
      primary_status: res.status,
      reason: sonnetStalled ? 'sonnet_stalled_using_haiku' : 'sonnet_overloaded_using_haiku',
      remaining_ms: remaining,
    }));
    currentModel = FALLBACK_MODEL;
    fellBack = true;
    const haikuBudget = Math.max(FALLBACK_MIN_BUDGET_MS, remaining - 500);
    res = await tryModel(FALLBACK_MODEL, body, apiKey, 1, haikuBudget);
    if (res._stalled === true) {
      throw new Error(`Anthropic stalled on both Sonnet and Haiku — agent ${agent && agent.id} timed out twice.`);
    }
  }

  raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`Anthropic returned non-JSON (${res.status}): ${raw.slice(0, 500)}`); }

  if (!res.ok) {
    const msg = parsed.error?.message || raw;
    if (res.status === 429) throw new Error(`Anthropic rate-limited even after Haiku fallback — wait 30s and retry.`);
    if (res.status === 529) throw new Error(`Anthropic overloaded (Sonnet+Haiku). Wait 30s. Check status.anthropic.com.`);
    if (res.status === 503) throw new Error(`Anthropic unavailable. Wait 60s and retry.`);
    throw new Error(`Anthropic error (${res.status}): ${msg}`);
  }

  const textBlocks = (parsed.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  let structured = null;
  let parseError = null;
  if (agent && agent.outputFormat === 'json') {
    const cleaned = textBlocks.replace(/```json\s*|\s*```/g, '').trim();
    try { structured = JSON.parse(cleaned); }
    catch (e) {
      parseError = e.message;
      const salvaged = salvagePartialArray(cleaned);
      if (salvaged && salvaged.key && salvaged.items.length) {
        structured = { [salvaged.key]: salvaged.items, _truncated: true, _recovered_count: salvaged.items.length };
        parseError = `${parseError} (salvaged ${salvaged.items.length} complete ${salvaged.key})`;
      }
    }
  }

  return {
    text:          textBlocks,
    raw:           parsed,
    structured,
    parse_error:   parseError,
    usage:         parsed.usage || null,
    provider:      'anthropic',
    model_used:    currentModel,
    fell_back:     fellBack,
  };
}

// ───────────────────────────────────────────────────
// Grok (xAI) Implementation — OpenAI compatible + basic resilience
// ───────────────────────────────────────────────────
async function callGrokWithRetry(url, body, apiKey, maxRetries = 2) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let parsed;
      try { parsed = JSON.parse(raw); } catch { /* will surface below */ }
      if (res.ok) return { ok: true, parsed, raw, status: res.status };
      // Retry on rate limit / server errors
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        attempt++;
        const delay = Math.min(1500 * attempt, 3000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      const msg = (parsed && parsed.error && parsed.error.message) || raw;
      return { ok: false, parsed, raw, status: res.status, error: `Grok error (${res.status}): ${msg}` };
    } catch (e) {
      if (attempt < maxRetries) {
        attempt++;
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }
      throw e;
    }
  }
}

async function callGrok(agent, input, context) {
  const userMessage = typeof input === 'string' ? input : JSON.stringify(input, null, 2);

  const contextualBrief = context
    ? `\n\n[CONTEXT FROM UPSTREAM AGENTS]\n${JSON.stringify(context, null, 2)}`
    : '';

  const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY (or XAI_API_KEY) environment variable is not set');
  }

  const body = {
    model: resolveModel(agent, 'grok'),
    // Max power mode: give agents more room to produce high-quality structured output
    max_tokens: agent.max_tokens || (agent.tier === 1 ? 1600 : 1200),
    messages: [
      { role: 'system', content: agent.systemPrompt },
      { role: 'user',   content: `${userMessage}${contextualBrief}` },
    ],
  };

  const result = await callGrokWithRetry(`${GROK_BASE_URL}/chat/completions`, body, apiKey);

  if (!result.ok) {
    throw new Error(result.error || 'Grok request failed');
  }

  const parsed = result.parsed;
  const text = (parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || '';

  // Optional partial salvage for JSON agents on Grok too
  let structured = null;
  let parseError = null;
  if (agent && agent.outputFormat === 'json') {
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
    try { structured = JSON.parse(cleaned); }
    catch (e) {
      parseError = e.message;
      const salvaged = salvagePartialArray(cleaned);
      if (salvaged && salvaged.key && salvaged.items.length) {
        structured = { [salvaged.key]: salvaged.items, _truncated: true, _recovered_count: salvaged.items.length };
        parseError = `${parseError} (salvaged ${salvaged.items.length})`;
      }
    }
  }

  return {
    text,
    structured,
    raw: parsed,
    parse_error: parseError,
    usage: parsed && parsed.usage ? parsed.usage : null,
    provider: 'grok',
    model_used: body.model,
  };
}

module.exports = {
  callLLM,
  callAnthropic,
  callGrok,
  getProviderForAgent,
  resolveModel,
};

module.exports.GROK_POWER_MODEL = GROK_POWER_MODEL;
module.exports.GROK_FAST_MODEL = GROK_FAST_MODEL;
module.exports.GROK_MODEL = GROK_MODEL;

// Convenience re-export so agents can easily get the current provider
module.exports.DEFAULT_PROVIDER = () => {
  const env = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (env) return env;
  const hasGrok = !!(process.env.GROK_API_KEY || process.env.XAI_API_KEY);
  return hasGrok ? 'grok' : 'anthropic';
};