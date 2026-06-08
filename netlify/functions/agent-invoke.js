const https = require('https');



const { verify } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');
const { wrapUserContent, sanitizeField, UNTRUSTED_RULE } = require('./lib/sanitize-prompt');
const { isSafeUrl } = require('./lib/safe-url');

function callGrok(systemPrompt, userPayload) {
  // Support vision for better photo-matching cohesiveness:
  // userPayload can be a string (legacy) or { text: "...", images: [{url: "https://... or data:image/..."}] }
  // When images present we build a multi-part user content array so Grok *sees* the locked reference photos
  // and can write prompts that precisely describe + anchor to visible details (scar shape, jacket texture, lighting on skin, etc.).
  // This is what gives *superior* cohesiveness over passing images only to the final renderer.

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) {
    // No key configured on the function -> immediately return high-quality local-style simulation
    // so the UI never sees hard errors / 502s. The client will show the "(sim)" note.
    const sim = (typeof userPayload === 'string' ? userPayload : JSON.stringify(userPayload)).slice(0, 600);
    return Promise.resolve({ output: '• ' + sim + '\n\n(High-quality local simulation — configure XAI_API_KEY in Netlify for real Grok agent calls.)' });
  }

  return new Promise((resolve, reject) => {
    let userContent;
    let textForLogging = '';
    if (typeof userPayload === 'string') {
      userContent = userPayload;
      textForLogging = userPayload.slice(0, 200);
    } else if (userPayload && (userPayload.text || userPayload.images)) {
      const parts = [];
      if (userPayload.text) {
        parts.push({ type: 'text', text: userPayload.text });
        textForLogging = userPayload.text.slice(0, 200);
      }
      if (Array.isArray(userPayload.images)) {
        for (const img of userPayload.images.slice(0, 4)) { // safety: max 4 refs per call
          if (img && img.url) {
            parts.push({
              type: 'image_url',
              image_url: { url: img.url, detail: 'high' } // high detail for character matching fidelity
            });
          }
        }
      }
      userContent = parts.length > 1 ? parts : (parts[0] ? parts[0].text : '');
    } else {
      userContent = JSON.stringify(userPayload || {});
    }

    const data = JSON.stringify({
      model: 'grok-3-mini', // or grok-2-vision / whatever supports it in the 2026 stack
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.65,
      max_tokens: 900
    });

    const options = {
      hostname: 'api.x.ai',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          resolve({ output: content || JSON.stringify(json) });
        } catch (e) {
          reject(new Error('Failed to parse Grok response: ' + body));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getSystemPromptForAgent(agentId) {
  const base = 'You are a world-class film production specialist in the neo-noir genre. Be specific, reference the script and locked assets, avoid hallucinations. When the user message includes reference images, you MUST examine the visible details in those photos (face geometry, scar placement and texture, exact wardrobe wear, hair, skin under the lighting, proportions) and anchor every recommendation or prompt to matching them *exactly* for visual coherence across the whole movie. Output in clear bullet points.';

  const map = {
    'visual-character-builder': base + ' Focus on visual design, wardrobe, physical anchors for the character. Use the supplied photos to lock the exact likeness.',
    'psychological-builder': base + ' Deep dive into motivation, flaws, emotional through-line.',
    'voice-builder': base + ' Dialogue style, speech patterns, subtext.',
    'environment-builder': base + ' World building, location details, atmosphere. When location plates are supplied, describe their exact surfaces, light, and weather so every shot prompt can match them.',
    'atmospherics-builder': base + ' Time of day, weather, lighting, mood. Reference any supplied plates/photos for the precise look.',
    'lighting-designer': base + ' Practical lighting sources, ratios, color temperature. Match the light quality visible on the reference photos.',
    'cinematographer': base + ' Lens, camera movement, framing, composition.',
    'prompt-writer': base + ' Turn all notes into a tight, coherent video prompt under 250 tokens. The prompt must contain explicit instructions to match the exact visual details visible in any supplied character or location reference images (e.g. "match the precise scar angle and reflectivity, the specific creasing on the leather jacket shoulder, the exact 3-day stubble pattern and density from the provided reference photo of LEAD").',
    'continuity-supervisor': base + ' Ensure consistency across shots for characters, props, environment. When refs are visible, call out the exact matching requirements for every character in frame.',
    'scene-architect': base + ' Overall scene structure and visual storytelling.',
    'vfx-supervisor': base + ' VFX must enhance practical elements without breaking the grounded feel.',
    'sound-design-lead': base + ' Sound design that supports the neo-noir atmosphere.',
  };

  return map[agentId] || base + ' Provide expert analysis for this production element.';
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

    const auth = event.headers.authorization || '';
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
    return {
      statusCode: 200,  // return 200 with fallback so client always gets something instead of 502
      headers: CORS,
      body: JSON.stringify({ 
        output: null,
        error: 'Agent invoke failed on server',
        detail: String(err && err.message || err),
        fallback: true
      })
    };
  }
};
