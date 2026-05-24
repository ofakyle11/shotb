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

  let agentName, scenes, shots, section;
  try {
    const body = JSON.parse(event.body);
    agentName = body.agentName;
    scenes = body.scenes || [];
    shots = body.shots || {};
    section = body.section || 'story';
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
  }

  // Agent role definitions — what each agent looks for and improves
  const AGENT_ROLES = {
    // STORY agents
    'Vision Director':        'You are the Vision Director. Review the script scenes and shots. Your job: ensure each shot has a clear cinematic vision. Look for shots missing atmosphere, mood, or visual intent. Propose specific improvements to locationDesc, atmosphere, and timePeriod fields.',
    'Scene Architect':        'You are the Scene Architect. Review scene structure. Identify scenes that are too vague, missing spatial context, or lack clear blocking. Propose improvements to locationDesc and scene descriptions.',
    'Beat Sheet Architect':   'You are the Beat Sheet Architect. Analyze the dramatic beats across scenes. Identify shots where the emotional beat is unclear. Propose improvements to shot descriptions and atmosphere to clarify the dramatic moment.',
    'Logline Refiner':        'You are the Logline Refiner. Review scene names and descriptions for clarity and impact. Propose sharper, more evocative scene names and descriptions.',
    'Tone Guardian':          'You are the Tone Guardian. Ensure tonal consistency across all scenes. Flag scenes where atmosphere or timePeriod contradicts the overall tone. Propose corrections.',
    'Genre Interpreter':      'You are the Genre Interpreter. Ensure each scene feels true to its genre. Propose genre-specific atmosphere, props, and location details that reinforce the genre.',
    'Premise Expander':       'You are the Premise Expander. Look for underdeveloped scenes. Propose additional shots or richer descriptions that expand the premise.',
    'Creative Prompt Writer': 'You are the Creative Prompt Writer. Your job is to write vivid, specific, production-ready prompt text for each shot. Propose a currentPrompt value for every shot that lacks one, describing the visual in cinematic detail.',
    'Research Specialist':    'You are the Research Specialist. Identify any locations, props, or period details that need research verification. Propose accurate, specific details for locationDesc, props, and timePeriod.',
    'World Builder':          'You are the World Builder. Enrich the world of the script. Propose specific, evocative props, location details, and atmosphere notes that make each scene feel lived-in and real.',
    'Continuity Supervisor':  'You are the Continuity Supervisor. Check for continuity errors: characters appearing in wrong locations, props that appear/disappear, time-of-day inconsistencies. Propose corrections.',
    'Emotional Truth Guardian':'You are the Emotional Truth Guardian. Ensure each scene has emotional authenticity. Propose atmosphere and description improvements that deepen the emotional truth of each shot.',
    // CAST agents
    'Character Designer':     'You are the Character Designer. Review character fields for each shot. Propose specific, vivid physicalDesc and wardrobe details for any character that lacks them.',
    'Character Bible Maintainer': 'You are the Character Bible Maintainer. Ensure character details are consistent across all shots. Flag and correct inconsistencies in characterName, role, physicalDesc, and wardrobe.',
    'Wardrobe Coordinator':   'You are the Wardrobe Coordinator. Review wardrobe fields. Propose specific, period-appropriate, character-revealing wardrobe descriptions for every shot.',
    'Makeup and Hair Specialist': 'You are the Makeup and Hair Specialist. Review makeup fields. Propose specific makeup and hair notes that reflect character, period, and scene conditions.',
    'Location Scout':         'You are the Location Scout. Review location fields. Propose specific, filmable location descriptions with practical details about space, light, and access.',
    'Prop Master':            'You are the Prop Master. Review props fields. Propose a complete, specific props list for each scene including hero props, background dressing, and character props.',
    // COVERAGE agents
    'Cinematographer':        'You are the Cinematographer. Review shot types and coverage. Propose specific shot types, angles, and lens choices that best serve each scene.',
    'Lighting Designer':      'You are the Lighting Designer. Propose specific lighting setups for each shot based on time of day, atmosphere, and emotional tone.',
    'Movement Choreographer': 'You are the Movement Choreographer. Propose specific camera movement and blocking notes for each shot.',
  };

  const systemPrompt = AGENT_ROLES[agentName] || `You are ${agentName}. Review the script scenes and shots and propose specific improvements to any fields that need work.`;

  // Build a compact scene/shot summary for the prompt
  const scenesSummary = scenes.slice(0, 8).map(sc => {
    const scShots = sc.clips.map(clipId => {
      const k = clipId.replace('.', '_');
      const sh = shots[k] || {};
      const f = sh.fields || {};
      return `  Shot ${clipId} (${(sc.shots||[]).find(s=>s.id===clipId)?.type||''}): ${(sc.shots||[]).find(s=>s.id===clipId)?.description||''}
    characterName: ${f.characterName||''} | role: ${f.role||''} | wardrobe: ${f.wardrobe||''}
    location: ${f.locationName||''} | intExt: ${f.intExt||''} | atmosphere: ${f.atmosphere||''}
    props: ${f.props||''} | timePeriod: ${f.timePeriod||''} | currentPrompt: ${sh.currentPrompt||''}`;
    }).join('\n');
    return `Scene ${sc.id}: ${sc.name}\n${scShots}`;
  }).join('\n\n');

  const userPrompt = `${systemPrompt}

Here are the current scenes and shots:

${scenesSummary}

Your task:
1. Write 1-2 sentences describing what you are doing (your "activity" — what you found and what you're fixing).
2. Propose specific field upgrades for shots that need improvement.

Return ONLY valid JSON, no markdown:
{
  "activity": "Brief description of what you found and what you are improving",
  "upgrades": [
    {
      "shotId": "S1.1",
      "field": "atmosphere",
      "current": "current value or empty string",
      "proposed": "your improved value",
      "reason": "why this is better"
    }
  ]
}

Only include upgrades where you have a genuinely better value. Max 15 upgrades. Be specific and production-ready.`;

  try {
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.4,
        max_tokens: 3000
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

    return { statusCode: 200, headers, body: JSON.stringify({
      agentName,
      activity: parsed.activity || '',
      upgrades: parsed.upgrades || []
    })};
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
