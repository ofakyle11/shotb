'use strict';

const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');
const { wrapUserContent, sanitizeField, UNTRUSTED_RULE } = require('./lib/sanitize-prompt');
const { validateLocationEnrich, filterEnrichedLocations } = require('./lib/validate-locations');
const { buildAliasMap } = require('./lib/location-aliases');
const { callGrok } = require('./lib/grok-chat');

const SYSTEM_PROMPT =
  'You are a production designer and location scout building a location bible for AI image/video generation.\n\n' +
  'RULES:\n' +
  '- Output ONLY valid JSON. No markdown.\n' +
  '- Merge locations that are the SAME PHYSICAL PLACE under different slugline names (e.g. AIRPORT TERMINAL + PIERRE TRUDEAU INTERNATIONAL AIRPORT).\n' +
  '- aliases: map each canonical KEY to an array of alternate location names/keys that are the same set.\n' +
  '- description = visible environment: architecture, surfaces, weather, lighting, props, scale.\n' +
  '- consistencyPhrase = one tight line injected into every shot at this location (under 25 words).\n' +
  '- atmosphere = mood/time/weather feel.\n' +
  '- Only use location keys from the trusted list. Do NOT invent new locations.\n' +
  '- If evidence is thin, use confidence "low" and shorter text.\n\n' +
  'JSON shape:\n' +
  '{"aliases":{"CANONICAL_KEY":["ALIAS_KEY","OTHER_ALIAS"]},"locations":{"CANONICAL_KEY":{"canonicalName":"Display Name","description":"...","consistencyPhrase":"...","atmosphere":"cold rain night","confidence":"high"}}}';

function parseJsonFromModel(raw) {
  const t = String(raw || '').trim();
  const cleaned = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

function fallbackResponse(headers, trustedKeys, detail, localAliases) {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      aliases: localAliases || {},
      locations: {},
      enriched: 0,
      merged: Object.keys(localAliases || {}).length,
      total: trustedKeys.length,
      provider: 'grok-3-mini',
      fallback: true,
      detail: detail || 'Location enrich unavailable',
    }),
  };
}

exports.handler = async function handler(event) {
  const headers = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    await requireAuth(event);
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized', fallback: true }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const trustedKeys = Array.isArray(body.trustedKeys) ? body.trustedKeys : [];
  if (!trustedKeys.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'trustedKeys required' }) };
  }

  const evidence = body.evidence && typeof body.evidence === 'object' ? body.evidence : {};
  const scriptExcerpt = sanitizeField(body.scriptExcerpt || '', 7000);
  // Per-project anchors (from state.continuityRules, built by enrich-continuity)
  // override the Trudeau-airport default so alias merging generalizes past one screenplay.
  const anchors = Array.isArray(body.anchors) ? body.anchors.slice(0, 12).filter((a) => a && typeof a.canonicalLocation === 'string') : null;
  const localAliases = buildAliasMap(
    trustedKeys.map(function (k) { return String(k).replace(/_/g, ' '); }),
    scriptExcerpt,
    anchors
  );

  const userPrompt =
    UNTRUSTED_RULE + '\n\n' +
    'Trusted location keys (ONLY these may appear in output):\n' +
    trustedKeys.map(function (k) { return '- ' + String(k).toUpperCase().trim(); }).join('\n') + '\n\n' +
    'Local alias hints (merge these if script evidence agrees):\n' +
    JSON.stringify(localAliases, null, 0) + '\n\n' +
    'Per-location evidence packs:\n' +
    wrapUserContent('evidence', JSON.stringify(evidence, null, 0), 12000) + '\n' +
    wrapUserContent('script_excerpt', scriptExcerpt, 7000) + '\n' +
    'Return aliases for same-place locations and enriched location bible entries. Prefer one canonical key per physical set.';

  try {
    const grok = await callGrok(SYSTEM_PROMPT, userPrompt, { temperature: 0.2, max_tokens: 3000 });
    if (grok.fallback) {
      return fallbackResponse(headers, trustedKeys, grok.error || 'XAI_API_KEY not configured', localAliases);
    }

    const parsed = parseJsonFromModel(grok.output);
    if (!validateLocationEnrich(parsed)) {
      return fallbackResponse(headers, trustedKeys, 'Invalid location enrich structure', localAliases);
    }

    const filtered = filterEnrichedLocations(parsed, trustedKeys, sanitizeField);
    const mergedAliases = Object.assign({}, localAliases, filtered.aliases || {});

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        aliases: mergedAliases,
        locations: filtered.locations,
        enriched: Object.keys(filtered.locations).length,
        merged: Object.keys(mergedAliases).length,
        total: trustedKeys.length,
        provider: 'grok-3-mini',
      }),
    };
  } catch (e) {
    console.error('[enrich-locations] Grok failed:', e);
    return fallbackResponse(headers, trustedKeys, e.message || 'Location enrich failed', localAliases);
  }
};