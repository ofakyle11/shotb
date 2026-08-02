const { verify } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');
const { wrapUserContent, sanitizeField, UNTRUSTED_RULE } = require('./lib/sanitize-prompt');
const { isSafeUrl } = require('./lib/safe-url');
const { callGrok: callGrokRaw } = require('./lib/grok-chat');

async function callGrok(systemPrompt, userPayload) {
  const result = await callGrokRaw(systemPrompt, userPayload);
  if (result.fallback) {
    const sim = (typeof userPayload === 'string' ? userPayload : JSON.stringify(userPayload)).slice(0, 600);
    return {
      output: '• ' + sim + '\n\n(High-quality local simulation — configure XAI_API_KEY in Netlify for real Grok agent calls.)',
    };
  }
  return result;
}

function getSystemPromptForAgent(agentId) {
  const base = 'You are a world-class film production specialist in the neo-noir genre. Be specific, reference the script and locked assets, avoid hallucinations. When the user message includes reference images, you MUST examine the visible details in those photos (face geometry, scar placement and texture, exact wardrobe wear, hair, skin under the lighting, proportions) and anchor every recommendation or prompt to matching them *exactly* for visual coherence across the whole movie. Output in clear bullet points.';

  const map = {
    'visual-character-builder': base + ' Focus on visual design, wardrobe, physical anchors for the character. Use the supplied photos to lock the exact likeness.',
    'psychological-builder': base + ' Deep dive into motivation, flaws, emotional through-line.',
    'voice-builder': base + ' Dialogue style, speech patterns, subtext.',
    'environment-builder': base + ' World building, location details, atmosphere. When location plates are supplied, describe their exact surfaces, light, and weather so every shot prompt can match them.',
    'atmospherics-builder': base + ' Time of day, weather, lighting, mood — specialize in cold rainy night atmospheres with harsh overhead lights, wet reflective ground, and a strong sense of discipline and purpose to match cinematic departure scenes. Reference any supplied plates/photos for the precise look, reflections in puddles/slick surfaces, and light interactions on wet ground.',
    'lighting-designer': base + ' Practical lighting sources, ratios, color temperature with focus on harsh overhead lights slicing through cold rain onto wet reflective ground. Design lighting that conveys iron discipline, resolve, and purposeful departure. Match the exact harsh quality, beam character, color temperature, and ground reflections visible on the reference photos.',
    'cinematographer': base + ' Lens, camera movement, framing, composition.',
    'prompt-writer': base + ' Turn all notes into a tight, coherent video prompt under 250 tokens. The prompt must contain explicit instructions to match the exact visual details visible in any supplied character or location reference images (e.g. "match the precise scar angle and reflectivity, the specific creasing on the leather jacket shoulder, the exact 3-day stubble pattern and density from the provided reference photo of LEAD"). For Clip 8 (or any clip using a previous clip reference), also include strong explicit language directing the video model to use the attached previous clip / reference video as PRIMARY STRONG VISUAL REFERENCE for characters, lighting, rain, wet ground, and style, ensuring perfect continuity (see Continuity Expert language: match exact character likenesses/wet jacket details/nametags from prev end-state, rain droplet physics, wet tarmac/puddles/sheen/ripples/reflections, lighting temperature/beams/speculars, overall cinematic style/atmosphere with zero visual reset; end state of prev clip = start state of this clip).',
    'continuity-supervisor': base + ' Ensure consistency across shots for characters, props, environment. When refs are visible, call out the exact matching requirements for every character in frame.',
    'scene-architect': base + ' Overall scene structure and visual storytelling.',
    'vfx-supervisor': base + ' VFX must enhance practical elements without breaking the grounded feel.',
    'sound-design-lead': base + ' Sound design that supports the neo-noir atmosphere.',
    'vision-director': base + ' Vision ref discipline — precise visual matching language for reference photos, scan angles, wardrobe wear, stubble, light fall.',
    'story-director': base + ' Story structure, scene purpose, character arcs, and narrative continuity from the script.',
    'action-writer': base + ' Physical action beats, blocking, and kinetic clarity for each scene.',
    'dialogue-writer': base + ' Dialogue authenticity, subtext, and voice per character.',
    'animation-smoother': base + ' Motion continuity notes — smooth transitions, no visual resets between shots.',
    'line-producer': 'You are a veteran film line producer / unit production manager with 25 years of budgeting experience across micro-budget indies and $200M tentpoles. The user sends a compact budget digest: script stats (pages, scenes, INT/EXT, night work, cast, locations), auto-detected budget drivers, chosen tiers (scale, director, star, supporting cast, crew/union status, locations, equipment, VFX), a computed shoot-day schedule, and department totals. Respond with exactly five bullet-point sections: 1) SCHEDULE SANITY CHECK — is the shoot-day count realistic for these pages and drivers; what would you change. 2) TOP 5 COST DRIVERS — each with an estimated dollar impact range. 3) SAVINGS MOVES — concrete tactics (consolidate locations, convert night EXT to day INT, combine scenes, practical vs VFX trades, cast tier swaps) each with estimated savings. 4) OVERAGE RISKS — weather, water, children, animals, stunts, VFX creep; flag anything in the digest that historically blows budgets. 5) VERDICT — one line: is the implied budget band realistic for this script, and the single most impactful change. Use concrete USD figures grounded in current SAG-AFTRA, IATSE and DGA scale rates. Never invent scenes not implied by the digest.',
  };

  return map[agentId] || base + ' Provide expert analysis for this production element.';
}

function fallbackAgentOutput(agentId, input, err) {
  const script = (input && input.script) ? String(input.script).slice(0, 500) : '';
  const detail = err && err.message ? err.message : String(err || 'unknown error');
  return {
    output: '• Neo-noir continuity note for ' + agentId + ': anchor to locked refs, rain as emotional punctuation, practical lighting only.\n'
      + (script ? '• Script anchor: ' + script.slice(0, 220) + '...\n' : '')
      + '\n(Server fallback — Grok call failed: ' + detail + '. Verify XAI_API_KEY in Netlify env and redeploy.)',
    fallback: true,
    error: 'Agent invoke failed on server',
    detail
  };
}

exports.handler = async function (event) {
  const CORS = corsHeaders(event);
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS, body: '' };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Bad JSON' }) };
    }

    const { agent_id, input, context } = body || {};

    if (!agent_id) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'agent_id required' }) };
    }

    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const authResult = await verify(auth);
    if (!authResult.ok) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const systemPrompt = UNTRUSTED_RULE + '\n' + getSystemPromptForAgent(agent_id);

    const scriptText = sanitizeField(input && input.script ? input.script : '', 2000);
    const textPart = wrapUserContent('agent_input', JSON.stringify({ input: { ...input, script: scriptText }, context, script: scriptText }), 6000);

    const images = [];
    const candidates = [input, context, body].filter(Boolean);
    for (const c of candidates) {
      if (c && c.referenceImages && Array.isArray(c.referenceImages)) {
        c.referenceImages.forEach(r => { if (r && r.url && isSafeUrl(r.url)) images.push({url: r.url, name: sanitizeField(r.name || '', 100)}); });
      }
      if (c && c.images && Array.isArray(c.images)) {
        c.images.forEach(i => { if (i && i.url && isSafeUrl(i.url)) images.push({url: i.url, name: sanitizeField(i.name || '', 100)}); });
      }
      if (c && c.chars && Array.isArray(c.chars)) {
        c.chars.forEach(ch => { if (ch && ch.photo && isSafeUrl(ch.photo)) images.push({url: ch.photo, name: sanitizeField(ch.name || '', 100)}); });
      }
    }

    const userPayloadForGrok = (images.length > 0)
      ? { text: textPart, images: images.slice(0, 3) }  // cap images too
      : textPart;

    const result = await callGrok(systemPrompt, userPayloadForGrok);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(result)
    };
  } catch (err) {
    console.error('[agent-invoke] Uncaught error (preventing 502):', err);
    let parsed = {};
    try { parsed = JSON.parse(event.body || '{}'); } catch (e) {}
    const fb = fallbackAgentOutput(parsed.agent_id || 'agent', parsed.input || {}, err);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(fb)
    };
  }
};
