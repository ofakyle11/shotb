const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');
const { wrapUserContent, sanitizeField, UNTRUSTED_RULE, validatePromptRewrite } = require('./lib/sanitize-prompt');

exports.handler = async (event) => {
  const headers = corsHeaders(event);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    await requireAuth(event);
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const key = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'GROK_API_KEY not set' }) };

  let currentPrompt, fields, changedField, changedValue, agentName;
  try {
    const body = JSON.parse(event.body);
    currentPrompt = body.currentPrompt || '';
    fields = body.fields || {};
    changedField = body.changedField || '';
    changedValue = body.changedValue || '';
    agentName = body.agentName || 'Agent';
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
  }

  const fieldSummary = Object.entries(fields)
    .filter(([k, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${sanitizeField(v, 500)}`)
    .join('\n');

  const prompt = `${UNTRUSTED_RULE}

You are a professional screenplay and production prompt writer.

A shot's production data has just been updated by the ${sanitizeField(agentName, 100)}.

${wrapUserContent('action_line', currentPrompt || '(empty)', 2000)}

${wrapUserContent('fields', fieldSummary || '(none)', 3000)}

CHANGE JUST APPLIED:
Field: ${sanitizeField(changedField, 100)}
New value: ${sanitizeField(changedValue, 1000)}

Rewrite the action line to incorporate this change. Return ONLY valid JSON:
{ "prompt": "The rewritten action line here" }`;

  try {
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 400
      })
    });

    if (!resp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Grok API error' }) };
    }

    const data = await resp.json();
    const raw = data.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!validatePromptRewrite(parsed)) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: 'Invalid rewrite structure' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ prompt: parsed.prompt || '' }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Rewrite failed' }) };
  }
};