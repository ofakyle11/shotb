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
- A production scene = a continuous block of action in ONE physical location/setting.
- For each scene, determine the EXACT shots needed to film it.
- Shot IDs use format S1.1, S1.2, S2.1, S2.2 etc.
- For each scene, extract ALL production details: characters present, their wardrobe, location details, props, atmosphere.
- For each character in a scene, provide their name, role/function in the scene, physical description, and wardrobe.
- For each shot, include a "characters" array listing ONLY the character names that actually appear in that specific shot. Leave it empty [] for establishing shots, cutaways, or shots with no named characters.

Return ONLY valid JSON in this exact format, no markdown, no explanation:
{
  "title": "script title or first line",
  "scenes": [
    {
      "id": "S1",
      "name": "Brief location name (e.g. London Airport - Arrivals)",
      "description": "One sentence describing what happens here",
      "intExt": "INT" or "EXT",
      "locationDesc": "Detailed description of the physical location and set dressing",
      "timePeriod": "e.g. Day, Night, Dawn, Dusk, or specific era",
      "atmosphere": "Mood and tone of the scene (e.g. tense, warm, chaotic)",
      "props": "Comma-separated list of key props needed",
      "characters": [
        {
          "name": "CHARACTER NAME",
          "role": "Their function in this scene (e.g. Protagonist, Detective, Bystander)",
          "physicalDesc": "Age, build, distinguishing features",
          "wardrobe": "What they are wearing in this scene",
          "makeup": "Any notable makeup or hair notes"
        }
      ],
      "shots": [
        { "id": "S1.1", "type": "Wide", "description": "Establishing shot of arrivals hall", "characters": [] },
        { "id": "S1.2", "type": "Medium", "description": "Character walks through crowd", "characters": ["CHARACTER NAME"] }
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
        max_tokens: 6000
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Grok API error: ' + err }) };
    }

    const data = await resp.json();
    const raw = data.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
