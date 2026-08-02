'use strict';

// Shot-description builder: transcripts and dialogue-heavy scripts produce
// clips whose "description" is just the spoken line — useless for image
// generation. One Grok pass turns each thin shot into a filmable VISUAL
// description (who is in frame, what they physically do, setting cues),
// which then drives storyboards and video prompts.

const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');
const { wrapUserContent, sanitizeField, UNTRUSTED_RULE } = require('./lib/sanitize-prompt');
const { callGrok } = require('./lib/grok-chat');

const SYSTEM_PROMPT =
  'You are a cinematographer doing a shot-list pass for AI video generation.\n\n' +
  'For every shot index provided, write ONE concrete visual description (1-2 sentences, present tense):\n' +
  '- WHO is in frame (use ONLY the trusted character names), their physical action, expression, and blocking.\n' +
  '- WHERE: 3-6 words of setting detail consistent with the scene heading.\n' +
  '- If the shot has dialogue, describe the speaker mid-line (mouth open, gesture) — do NOT quote the dialogue.\n' +
  '- No camera jargon beyond simple framing words (close on, wide, over-the-shoulder).\n' +
  '- Keep continuity: consecutive shots in the same scene share the same space and light.\n\n' +
  'Output ONLY valid JSON, no markdown: {"shots":{"<index>":"<description>"}}';

function parseJsonFromModel(raw) {
  const t = String(raw || '').trim();
  const cleaned = t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
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
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const clips = (Array.isArray(body.clips) ? body.clips : []).slice(0, 50).map(function (c) {
    return {
      i: Number(c.i) || 0,
      heading: sanitizeField(c.heading || '', 120),
      description: sanitizeField(c.description || '', 300),
      dialogue: sanitizeField(c.dialogue || '', 200),
      characters: (Array.isArray(c.characters) ? c.characters : []).slice(0, 6).map(function (n) { return sanitizeField(String(n), 60).toUpperCase(); })
    };
  });
  if (!clips.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'clips required' }) };
  }
  const characters = (Array.isArray(body.characters) ? body.characters : []).slice(0, 60)
    .map(function (c) { return sanitizeField(String(c), 60).toUpperCase().trim(); }).filter(Boolean);

  const userPrompt =
    UNTRUSTED_RULE + '\n\n' +
    'Trusted character names:\n' + characters.map(function (c) { return '- ' + c; }).join('\n') + '\n\n' +
    'Shots needing visual descriptions (index | heading | current description | dialogue | characters):\n' +
    clips.map(function (c) {
      return c.i + ' | ' + c.heading + ' | ' + c.description + ' | ' + c.dialogue + ' | ' + c.characters.join(',');
    }).join('\n') + '\n\n' +
    wrapUserContent('script_excerpt', sanitizeField(body.scriptExcerpt || '', 6000), 6000) + '\n' +
    'Return the {"shots":{...}} JSON with one visual description per index.';

  try {
    const grok = await callGrok(SYSTEM_PROMPT, userPrompt, { temperature: 0.4, max_tokens: 3800 });
    if (grok.fallback) {
      return { statusCode: 200, headers, body: JSON.stringify({ shots: {}, fallback: true, detail: grok.error || 'XAI_API_KEY not configured' }) };
    }
    const parsed = parseJsonFromModel(grok.output);
    const shots = (parsed && parsed.shots && typeof parsed.shots === 'object') ? parsed.shots : {};
    const out = {};
    Object.keys(shots).slice(0, 60).forEach(function (k) {
      const v = sanitizeField(String(shots[k] || ''), 400);
      if (v.length > 15) out[k] = v;
    });
    return { statusCode: 200, headers, body: JSON.stringify({ shots: out, provider: 'grok-3-mini' }) };
  } catch (e) {
    console.error('[enrich-shots] Grok failed:', e);
    return { statusCode: 200, headers, body: JSON.stringify({ shots: {}, fallback: true, detail: e.message }) };
  }
};
