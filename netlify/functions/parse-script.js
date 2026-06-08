const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');
const { wrapUserContent, UNTRUSTED_RULE, validateScriptBreakdown } = require('./lib/sanitize-prompt');

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

  let script = '';
  try { script = JSON.parse(event.body).script || ''; } catch(e) {}
  if (!script.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No script provided' }) };

  const prompt = `${UNTRUSTED_RULE}

You are a professional film production supervisor and script breakdown expert.

Analyze the following script and break it down into PRODUCTION SCENES.

Rules:
- A production scene = a continuous block of action in ONE physical location/setting.
- For each scene, determine the EXACT shots needed to film it.
- Shot IDs use format S1.1, S1.2, S2.1, S2.2 etc.
- For each scene, extract ALL production details: characters present, their wardrobe, location details, props, atmosphere.
- For each character in a scene, provide their name, role/function in the scene, physical description, and wardrobe.
- For each shot, include a "characters" array listing ONLY the character names that actually appear in that specific shot. Leave it empty [] for establishing shots, cutaways, or shots with no named characters.
- CRITICAL — shot descriptions: Each shot "description" must describe ONLY what the camera sees in THAT single shot. Do NOT combine multiple shots into one description.
- Keep each shot description under 15 words. Be specific and visual.

Return ONLY valid JSON in this exact format, no markdown, no explanation:
{
  "title": "script title or first line",
  "scenes": [
    {
      "id": "S1",
      "name": "Brief location name",
      "description": "One sentence describing what happens here",
      "intExt": "INT" or "EXT",
      "locationDesc": "Detailed description of the physical location",
      "timePeriod": "e.g. Day, Night",
      "atmosphere": "Mood and tone",
      "props": "Comma-separated list of key props",
      "characters": [{ "name": "CHARACTER NAME", "role": "...", "physicalDesc": "...", "wardrobe": "...", "makeup": "..." }],
      "shots": [{ "id": "S1.1", "type": "Wide", "description": "...", "characters": [] }]
    }
  ],
  "characters": ["CHARACTER NAME 1"],
  "totalShots": 12
}

${wrapUserContent('script', script, 8000)}`;

  try {
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 6000
      })
    });

    if (!resp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Grok API error' }) };
    }

    const data = await resp.json();
    const raw = data.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!validateScriptBreakdown(parsed)) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: 'Invalid breakdown structure from model' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Parse failed' }) };
  }
};