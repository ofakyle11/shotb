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

  // ── AGENT ROLE DEFINITIONS ────────────────────────────────────────────────
  // Every agent has a precise mandate. Agents that touch currentPrompt are
  // flagged with WRITES_PROMPT=true so the client can enforce the mutex.
  const AGENT_ROLES = {

    // ── STORY agents ─────────────────────────────────────────────────────────
    'Vision Director': {
      WRITES_PROMPT: false,
      prompt: `You are the Vision Director. Your job is to ensure every shot has a clear, intentional cinematic vision.
Scan each shot's atmosphere, timePeriod, and locationDesc. If any of these are vague, generic, or missing, propose specific replacements.
Do NOT invent characters, props, or locations that are not already present in the scene data.
Focus fields: atmosphere, timePeriod, locationDesc.`
    },
    'Scene Architect': {
      WRITES_PROMPT: false,
      prompt: `You are the Scene Architect. Your job is to ensure every scene has clear spatial logic and physical grounding.
Look for scenes where the location is ambiguous, the blocking is unclear, or the physical space is undefined.
Propose specific, filmable locationDesc values. Do NOT add characters or props not already in the scene.
Focus fields: locationDesc, intExt, atmosphere.`
    },
    'Beat Sheet Architect': {
      WRITES_PROMPT: false,
      prompt: `You are the Beat Sheet Architect. Your job is to ensure the dramatic beat of each shot is clear.
Look for shots where the emotional moment is undefined or the action line is too vague to direct.
Propose sharper, more specific shot descriptions. Do NOT invent story elements not in the script.
Focus fields: shot description (description field), atmosphere.`
    },
    'Logline Refiner': {
      WRITES_PROMPT: false,
      prompt: `You are the Logline Refiner. Your job is to sharpen scene names and descriptions for clarity and impact.
Look for scene names that are generic or descriptions that are too long or vague.
Propose concise, evocative scene names and one-sentence descriptions.
Focus fields: scene name, scene description.`
    },
    'Tone Guardian': {
      WRITES_PROMPT: false,
      prompt: `You are the Tone Guardian. Your job is to ensure tonal consistency across all scenes.
Look for shots where the atmosphere or timePeriod contradicts the overall tone established in other scenes.
Propose corrections that bring the shot in line with the project's tone. Do NOT change story content.
Focus fields: atmosphere, timePeriod.`
    },
    'Genre Interpreter': {
      WRITES_PROMPT: false,
      prompt: `You are the Genre Interpreter. Your job is to ensure each scene feels true to its genre.
Look for scenes where the atmosphere, props, or location feel generic or genre-inconsistent.
Propose specific genre-appropriate details. Only use details that fit what is already in the scene.
Focus fields: atmosphere, props, locationDesc.`
    },
    'Premise Expander': {
      WRITES_PROMPT: false,
      prompt: `You are the Premise Expander. Your job is to identify underdeveloped shots and propose richer descriptions.
Look for shots with minimal description or missing context. Propose additions that deepen the scene without inventing new story elements.
Focus fields: shot description, atmosphere, locationDesc.`
    },
    'Creative Prompt Writer': {
      WRITES_PROMPT: true,
      prompt: `You are the Creative Prompt Writer. Your job is to write vivid, production-ready currentPrompt values for shots that lack them.
ONLY write a currentPrompt for shots where currentPrompt is empty or fewer than 20 characters.
The prompt must describe the visual in cinematic detail: camera angle, subject, action, lighting, mood.
Do NOT fabricate characters, locations, or props not present in the shot data.
Focus fields: currentPrompt ONLY.`
    },
    'Research Specialist': {
      WRITES_PROMPT: false,
      prompt: `You are the Research Specialist. Your job is to verify and improve period, location, and prop accuracy.
Look for shots where timePeriod, locationDesc, or props are anachronistic, vague, or implausible.
Propose accurate, specific replacements based only on what is already established in the scene.
Focus fields: timePeriod, locationDesc, props.`
    },
    'World Builder': {
      WRITES_PROMPT: false,
      prompt: `You are the World Builder. Your job is to make each scene feel lived-in and specific.
Look for shots with generic or empty props, atmosphere, or location details.
Propose specific, evocative details that enrich the world. Only add details consistent with what is already in the scene.
Focus fields: props, atmosphere, locationDesc.`
    },
    'Continuity Supervisor': {
      WRITES_PROMPT: false,
      prompt: `You are the Continuity Supervisor. Your job is to catch continuity errors across shots and scenes.
Look for: characters appearing in wrong locations, props that appear/disappear without explanation, time-of-day inconsistencies between consecutive shots.
Propose specific corrections. Only flag real inconsistencies visible in the data.
Focus fields: timePeriod, props, characterName, locationName.`
    },
    'Emotional Truth Guardian': {
      WRITES_PROMPT: false,
      prompt: `You are the Emotional Truth Guardian. Your job is to ensure each scene has emotional authenticity.
Look for shots where the atmosphere or description feels flat, generic, or emotionally disconnected from the scene's dramatic purpose.
Propose atmosphere and description improvements that deepen the emotional truth. Do NOT change story facts.
Focus fields: atmosphere, shot description.`
    },

    // ── CAST agents ──────────────────────────────────────────────────────────
    'Character Designer': {
      WRITES_PROMPT: false,
      prompt: `You are the Character Designer. Your job is to ensure every character has a specific, vivid physical presence.
Look for shots where characterName is present but physicalDesc or wardrobe is empty or generic.
Propose specific physicalDesc and wardrobe values that are consistent with the character's role and the scene's period/atmosphere.
Do NOT invent new characters. Only improve existing ones.
Focus fields: physicalDesc, wardrobe, makeup.`
    },
    'Character Bible Maintainer': {
      WRITES_PROMPT: false,
      prompt: `You are the Character Bible Maintainer. Your job is to ensure character details are consistent across all shots.
Look for the same character appearing with different physicalDesc, wardrobe, or role descriptions across shots.
Propose corrections that bring inconsistent shots in line with the most detailed/accurate version.
Focus fields: characterName, physicalDesc, wardrobe, role.`
    },
    'Character Arc Guardian': {
      WRITES_PROMPT: false,
      prompt: `You are the Character Arc Guardian. Your job is to ensure character wardrobe and appearance evolve logically across the story.
Look for characters whose wardrobe or appearance should change between scenes (e.g. after a fight, after a time jump) but doesn't.
Propose specific wardrobe or appearance notes that reflect the character's arc. Only flag real arc moments visible in the scene data.
Focus fields: wardrobe, makeup, physicalDesc.`
    },
    'Wardrobe Coordinator': {
      WRITES_PROMPT: false,
      prompt: `You are the Wardrobe Coordinator. Your job is to ensure every character has a complete, specific wardrobe description.
Look for shots where wardrobe is empty, vague (e.g. "casual clothes"), or inconsistent with the scene's period and atmosphere.
Propose specific, production-ready wardrobe descriptions. Stay consistent with established character details.
Focus fields: wardrobe.`
    },
    'Makeup and Hair Specialist': {
      WRITES_PROMPT: false,
      prompt: `You are the Makeup and Hair Specialist. Your job is to ensure every character has specific makeup and hair notes.
Look for shots where makeup is empty or generic. Propose specific notes that reflect the character's age, condition, period, and scene context.
Do NOT invent new characters. Only improve existing makeup fields.
Focus fields: makeup.`
    },
    'Location Scout': {
      WRITES_PROMPT: false,
      prompt: `You are the Location Scout. Your job is to ensure every location is specific, filmable, and well-described.
Look for shots where locationName is generic or locationDesc is vague or missing.
Propose specific, practical location descriptions that include spatial details, light quality, and access notes.
Do NOT invent locations not already in the scene.
Focus fields: locationName, locationDesc, intExt.`
    },
    'Prop Master': {
      WRITES_PROMPT: false,
      prompt: `You are the Prop Master. Your job is to ensure every shot has a complete, specific props list.
Look for shots where props is empty or only lists one or two items.
Propose a complete props list including hero props, background dressing, and character props — but ONLY props that logically belong in this specific scene based on the script data.
Do NOT invent props for scenes where none are mentioned.
Focus fields: props.`
    },
    'Crowd Coordinator': {
      WRITES_PROMPT: false,
      prompt: `You are the Crowd Coordinator. Your job is to identify shots that require background performers and specify their details.
Look for scenes set in public spaces, events, or locations where background action is implied by the script.
Propose specific background performer notes (number, type, wardrobe direction) only where the scene clearly calls for them.
Focus fields: props (background dressing notes), atmosphere.`
    },
    'Wardrobe and Prop Auditor': {
      WRITES_PROMPT: false,
      prompt: `You are the Wardrobe and Prop Auditor. Your job is to cross-check wardrobe and props for period accuracy and internal consistency.
Look for wardrobe or props that are anachronistic, implausible for the location, or inconsistent with the established period.
Propose specific corrections. Only flag real issues visible in the data.
Focus fields: wardrobe, props, timePeriod.`
    },
    'Geography and Set Guardian': {
      WRITES_PROMPT: false,
      prompt: `You are the Geography and Set Guardian. Your job is to ensure spatial and geographic consistency across scenes.
Look for scenes where the geography is contradictory (e.g. a character travels an impossible distance between shots) or the set dressing is inconsistent with the established location.
Propose specific corrections. Only flag real inconsistencies in the data.
Focus fields: locationName, locationDesc, intExt.`
    },

    // ── COVERAGE agents ──────────────────────────────────────────────────────
    'Cinematographer': {
      WRITES_PROMPT: false,
      prompt: `You are the Cinematographer. Your job is to ensure every shot has a specific, intentional shot type, angle, and lens choice.
Look for shots where shotType, angle, or lens is empty or generic (e.g. "medium shot" with no further detail).
Propose specific, production-ready values that serve the scene's dramatic purpose and atmosphere.
Focus fields: shotType, angle, lens.`
    },
    'Lighting Designer': {
      WRITES_PROMPT: false,
      prompt: `You are the Lighting Designer. Your job is to ensure every shot has a specific lighting setup.
Look for shots where the lighting fields are empty or inconsistent with the scene's timePeriod and atmosphere.
Propose specific lighting setups: key light direction, quality (hard/soft), colour temperature, practical sources.
Focus fields: temperature, contrast, exposure, style.`
    },
    'Movement Choreographer': {
      WRITES_PROMPT: false,
      prompt: `You are the Movement Choreographer. Your job is to ensure every shot has specific camera movement and blocking notes.
Look for shots where cameraMove is empty or generic (e.g. "static").
Propose specific camera movement descriptions that serve the scene's emotional beat and action.
Focus fields: cameraMove, shotType.`
    },
    'Director of Photography Assistant': {
      WRITES_PROMPT: false,
      prompt: `You are the Director of Photography Assistant. Your job is to ensure depth of field and lens choices are consistent and intentional.
Look for shots where depthOfField or lens is empty or inconsistent with the shot type and scene mood.
Propose specific depth of field and lens values that match the cinematographic intent.
Focus fields: depthOfField, lens, distortion.`
    },
    'Gaffer': {
      WRITES_PROMPT: false,
      prompt: `You are the Gaffer. Your job is to ensure the lighting plan is practical and achievable.
Look for shots where the lighting implied by atmosphere and timePeriod would require specific electrical or grip equipment.
Propose specific film grain, contrast, and exposure values that reflect a practical lighting plan for this scene.
Focus fields: filmGrain, contrast, exposure.`
    },
    'Key Grip': {
      WRITES_PROMPT: false,
      prompt: `You are the Key Grip. Your job is to ensure camera support and movement notes are practical and specific.
Look for shots where cameraMove is ambitious but unspecified (e.g. "moving shot") or where the shot type implies specific rigging.
Propose specific camera movement descriptions that reflect practical grip equipment choices.
Focus fields: cameraMove, distortion.`
    },
    'Stunt Coordinator': {
      WRITES_PROMPT: false,
      prompt: `You are the Stunt Coordinator. Your job is to identify shots that involve physical action, stunts, or safety considerations.
Look for shots where the description implies physical action (fights, falls, vehicle work, etc.).
Propose specific cinematics and camera movement notes that account for the stunt action.
Only flag shots where action is clearly implied by the script data.
Focus fields: cinematics, cameraMove, shotType.`
    },
    'Practical Effects Supervisor': {
      WRITES_PROMPT: false,
      prompt: `You are the Practical Effects Supervisor. Your job is to identify shots that require practical effects and specify their visual impact.
Look for shots where the description implies weather, fire, smoke, water, or other practical effects.
Propose specific style, atmosphere, and cinematics values that account for the practical effect.
Only flag shots where effects are clearly implied by the script data.
Focus fields: style, cinematics, atmosphere.`
    },
    'Stunt Performer Coordinator': {
      WRITES_PROMPT: false,
      prompt: `You are the Stunt Performer Coordinator. Your job is to ensure shots involving stunt performers have correct coverage notes.
Look for action shots where the shot type or angle doesn't account for stunt performer safety or coverage needs.
Propose specific angle and shotType values that allow for safe stunt coverage.
Only flag shots where stunt action is clearly implied.
Focus fields: angle, shotType, cameraMove.`
    },
    'Visual Consistency Guardian': {
      WRITES_PROMPT: false,
      prompt: `You are the Visual Consistency Guardian. Your job is to ensure visual style is consistent across all shots in a scene and across scenes.
Look for shots where style, colourTheme, or filmGrain is inconsistent with adjacent shots in the same scene.
Propose corrections that bring the shot in line with the established visual language.
Focus fields: style, colourTheme, filmGrain, contrast.`
    },
    'Performance Consistency Checker': {
      WRITES_PROMPT: false,
      prompt: `You are the Performance Consistency Checker. Your job is to ensure coverage choices support consistent performance capture.
Look for scenes where the shot sequence doesn't include adequate coverage for performance (e.g. no close-up in an emotional scene, no reaction shot).
Propose additional shot type notes or angle adjustments that ensure performance is captured.
Focus fields: shotType, angle, depthOfField.`
    },
    'Timeline Consistency Checker': {
      WRITES_PROMPT: false,
      prompt: `You are the Timeline Consistency Checker. Your job is to ensure time-of-day and season are consistent within scenes and logical across the story.
Look for shots where timePeriod or season contradicts adjacent shots or creates an impossible timeline.
Propose specific corrections. Only flag real inconsistencies visible in the data.
Focus fields: timeOfDay, season, timePeriod.`
    }
  };

  const agentDef = AGENT_ROLES[agentName];
  const systemPrompt = agentDef
    ? agentDef.prompt
    : `You are ${agentName}. Review the script scenes and shots and propose specific, production-ready improvements to fields that need work. Do NOT invent story elements not present in the script.`;

  const writesPrompt = agentDef ? agentDef.WRITES_PROMPT : false;

  // ── Build compact scene/shot summary ─────────────────────────────────────
  const scenesSummary = scenes.slice(0, 10).map(sc => {
    const scShots = sc.clips.map(clipId => {
      const k = clipId.replace('.', '_');
      const sh = shots[k] || {};
      const f = sh.fields || {};
      return `  Shot ${clipId}:
    description: ${(sc.shots||[]).find(s=>s.id===clipId)?.description||''}
    characterName: ${f.characterName||''} | role: ${f.role||''} | physicalDesc: ${f.physicalDesc||''}
    wardrobe: ${f.wardrobe||''} | makeup: ${f.makeup||''}
    locationName: ${f.locationName||''} | intExt: ${f.intExt||''} | locationDesc: ${f.locationDesc||''}
    atmosphere: ${f.atmosphere||''} | timePeriod: ${f.timePeriod||''} | props: ${f.props||''}
    shotType: ${f.shotType||''} | angle: ${f.angle||''} | lens: ${f.lens||''}
    cameraMove: ${f.cameraMove||''} | depthOfField: ${f.depthOfField||''} | style: ${f.style||''}
    filmGrain: ${f.filmGrain||''} | contrast: ${f.contrast||''} | exposure: ${f.exposure||''}
    colourTheme: ${f.colourTheme||''} | temperature: ${f.temperature||''} | season: ${f.season||''}
    timeOfDay: ${f.timeOfDay||''} | distortion: ${f.distortion||''} | cinematics: ${f.cinematics||''}
    currentPrompt: ${sh.currentPrompt||''}`;
    }).join('\n');
    return `Scene ${sc.id}: ${sc.name} | ${sc.description||''} | ${sc.intExt||''} | ${sc.atmosphere||''}
${scShots}`;
  }).join('\n\n');

  // ── Prompt construction ───────────────────────────────────────────────────
  const promptWriteRule = writesPrompt
    ? `You MAY propose upgrades to the "currentPrompt" field. Only do so for shots where currentPrompt is empty or fewer than 20 characters.`
    : `You MUST NOT propose upgrades to the "currentPrompt" field. Leave it alone entirely.`;

  const userPrompt = `${systemPrompt}

${promptWriteRule}

STRICT RULES:
- You MUST propose upgrades for ALL fields that are empty or contain fewer than 5 characters. Empty fields are your primary target.
- For fields that already have a specific, detailed value: skip them.
- Do NOT invent characters, locations, props, or story elements not present in the scene data.
- Aim for 5-12 upgrades. Be specific and production-ready. If all fields are empty, fill as many as you can.
- IMPORTANT: If you see empty fields, that is your job — fill them based on the scene context.

Here are the current scenes and shots:

${scenesSummary}

Return ONLY valid JSON, no markdown:
{
  "activity": "One sentence: what you found and what you are fixing",
  "upgrades": [
    {
      "shotId": "S1.1",
      "field": "atmosphere",
      "current": "current value or empty string",
      "proposed": "your improved value",
      "reason": "why this is better"
    }
  ]
}`;

  try {
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3,
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

    const upgrades = parsed.upgrades || [];
    console.log('[run-agent]', agentName, '-> upgrades:', upgrades.length, '| activity:', parsed.activity);
    return { statusCode: 200, headers, body: JSON.stringify({
      agentName,
      writesPrompt,
      activity: parsed.activity || '',
      upgrades
    })};
  } catch(e) {
    console.error('[run-agent] Grok call failed:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
