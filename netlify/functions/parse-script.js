exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const key = process.env.GROK_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'GROK_API_KEY not set' }) };

  let script = '';
  try { script = JSON.parse(event.body).script || ''; } catch(e) {}
  if (!script.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No script provided' }) };

  const prompt = `You are a professional film production supervisor and script breakdown expert.

Analyze the following script and break it down into PRODUCTION SCENES.

Rules:
- A production scene = a continuous block of action in ONE physical location/setting. If the story moves to a new place, that is a new scene.
- Do NOT use scene heading numbers mechanically. Group by actual location continuity (e.g. everything happening at the airport is one scene even if the script has multiple INT. headings there).
- For each scene, determine the EXACT shots needed to film it. Think like a cinematographer: establish the space, cover the action, capture dialogue, close-ups, inserts, transitions. Be specific and realistic.
- Shot IDs use format S1.1, S1.2, S2.1, S2.2 etc.

Return ONLY valid JSON in this exact format, no markdown, no explanation:
{
  "title": "script title or first line",
  "scenes": [
    {
      "id": "S1",
      "name": "Brief location name (e.g. London Airport - Arrivals)",
      "description": "One sentence describing what happens here",
      "shots": [
        { "id": "S1.1", "type": "Wide", "description": "Establishing shot of arrivals hall" },
        { "id": "S1.2", "type": "Medium", "description": "Character walks through crowd" }
      ]
    }
  ],
  "characters": ["CHARACTER NAME 1", "CHARACTER NAME 2"],
  "totalShots": 12
}

SCRIPT:
${script.substring(0,8000)}`;

  try {
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Grok API error: ' + err }) };
    }

    const data = await resp.json();
    const raw = data.choices[0].message.content.trim();

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
