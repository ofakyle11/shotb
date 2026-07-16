'use strict';

// Continuity enrichment: one Grok pass that extracts (a) a structured prop
// bible, (b) per-scene character outfits, and (c) data-driven crowd/anchor
// rules — replacing the client's previously hardcoded screenplay-specific
// regexes. The client (timeline/timeline-props.js) validates and merges.

const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');
const { wrapUserContent, sanitizeField, UNTRUSTED_RULE } = require('./lib/sanitize-prompt');
const { callGrok } = require('./lib/grok-chat');

const SYSTEM_PROMPT =
  'You are a film continuity supervisor and props master doing a script breakdown for AI video generation.\n\n' +
  'RULES:\n' +
  '- Output ONLY valid JSON. No markdown.\n' +
  '- props: physical objects that must stay visually consistent. importance "hero" only for story-critical objects handled on camera (a letter, a weapon, a pendant); everything else "set-dressing". scenes = 0-based indices from the provided scene list. heldBy = character name if one character owns/carries it.\n' +
  '- outfits: per character, one entry per DISTINCT costume, with the 0-based scene index where that outfit first appears. Describe only visible clothing (color, garment, condition). Skip characters whose wardrobe never changes AND is unknown.\n' +
  '- rules.crowds: only when the script has a uniform group treated as one unit (a squad, clones, a choir). name = ONE_WORD_UNIT_NAME (underscores), leaderName = the named individual within the group if any. detectPatterns = 1-3 case-insensitive regex strings that appear in the script when this crowd is present. triggerWords / wideShotWords = uppercase words from the script that mark shots containing the crowd.\n' +
  '- rules.anchors: locations referred to by multiple names; canonicalLocation = the full proper name, matchWords = uppercase words that identify it.\n' +
  '- Only use character names from the trusted list. Empty arrays are fine — do not invent.\n\n' +
  'JSON shape:\n' +
  '{"props":[{"name":"","description":"","importance":"hero","scenes":[0],"heldBy":""}],' +
  '"outfits":{"NAME":[{"scene":0,"description":""}]},' +
  '"rules":{"crowds":[{"name":"","leaderName":"","leaderDescription":"","description":"","leaderNote":"","detectPatterns":[""],"triggerWords":[""],"wideShotWords":[""]}],' +
  '"anchors":[{"canonicalLocation":"","matchWords":[""]}]}}';

function parseJsonFromModel(raw) {
  const t = String(raw || '').trim();
  const cleaned = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

function fallbackResponse(headers, detail) {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      props: [],
      outfits: {},
      rules: { crowds: [], anchors: [] },
      provider: 'grok-3-mini',
      fallback: true,
      detail: detail || 'Continuity enrich unavailable',
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

  const scriptExcerpt = sanitizeField(body.scriptExcerpt || '', 9000);
  if (!scriptExcerpt.trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'scriptExcerpt required' }) };
  }
  const scenes = (Array.isArray(body.scenes) ? body.scenes : []).slice(0, 200).map(function (s) {
    return { i: Number(s.i) || 0, heading: sanitizeField(s.heading || '', 160) };
  });
  const characters = (Array.isArray(body.characters) ? body.characters : []).slice(0, 60)
    .map(function (c) { return sanitizeField(String(c), 60).toUpperCase().trim(); })
    .filter(Boolean);

  const userPrompt =
    UNTRUSTED_RULE + '\n\n' +
    'Trusted character names (ONLY these may appear in outfits/heldBy/leaderName):\n' +
    characters.map(function (c) { return '- ' + c; }).join('\n') + '\n\n' +
    'Scene list (0-based index → heading):\n' +
    scenes.map(function (s) { return s.i + ': ' + s.heading; }).join('\n') + '\n\n' +
    wrapUserContent('script_excerpt', scriptExcerpt, 9000) + '\n' +
    'Return the props / outfits / rules breakdown JSON.';

  try {
    const grok = await callGrok(SYSTEM_PROMPT, userPrompt, { temperature: 0.2, max_tokens: 3500 });
    if (grok.fallback) {
      return fallbackResponse(headers, grok.error || 'XAI_API_KEY not configured');
    }
    const parsed = parseJsonFromModel(grok.output);
    if (!parsed || typeof parsed !== 'object') {
      return fallbackResponse(headers, 'Invalid continuity enrich structure');
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        props: Array.isArray(parsed.props) ? parsed.props.slice(0, 40) : [],
        outfits: parsed.outfits && typeof parsed.outfits === 'object' ? parsed.outfits : {},
        rules: parsed.rules && typeof parsed.rules === 'object' ? parsed.rules : { crowds: [], anchors: [] },
        provider: 'grok-3-mini',
      }),
    };
  } catch (e) {
    console.error('[enrich-continuity] Grok failed:', e);
    return fallbackResponse(headers, e.message || 'Continuity enrich failed');
  }
};
