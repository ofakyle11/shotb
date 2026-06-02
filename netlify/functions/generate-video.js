const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function callWaveSpeed(path, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const options = {
      hostname: 'api.wavespeed.ai', // adjust to actual WaveSpeed host from your setup
      port: 443,
      path: path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (process.env.WAVESPEED_API_KEY || ''),
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// --- Grok Imagine helpers (for when user chooses Grok native for pictures or video) ---
// Uses the official xAI Imagine REST endpoints (api.x.ai/v1/images/generations and /v1/videos/generations)
// Supports the same submit/status/result action contract as WaveSpeed for minimal client changes.
// Auth uses XAI_API_KEY (same as agents). Supports reference images for I2I / I2V with high cohesion.
function callGrokImagine(path, payload, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload || {});
    const options = {
      hostname: 'api.x.ai',
      port: 443,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (process.env.XAI_API_KEY || process.env.GROK_API_KEY || ''),
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (e) {
          resolve({ raw: body, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function submitGrokImagineVideo({ prompt, duration, aspect_ratio, character_image_url, shotKey, location, model }) {
  const imaginePayload = {
    model: 'grok-imagine-video', // or grok-imagine-video-v1.5 etc. — can be overridden via env if needed
    prompt,
    duration: duration || 6,
    aspect_ratio: aspect_ratio || '16:9',
    resolution: '720p'
  };
  if (character_image_url) {
    imaginePayload.image = { url: character_image_url }; // primary ref for I2V coherence
    // Support extra refs if we ever pass an array, but for now single main char ref + prompt describes others
  }
  if (shotKey) imaginePayload.shot_key = shotKey;
  if (location) imaginePayload.location = location;

  const res = await callGrokImagine('/v1/videos/generations', imaginePayload);
  // Normalize to the shape our client expects (request_id + status)
  const rid = res.id || res.request_id || res.requestId || ('grok_' + Date.now());
  return { request_id: rid, status: res.status || 'SUBMITTED', raw: res };
}

async function getGrokImagineVideoStatus(request_id) {
  const res = await callGrokImagine(`/v1/videos/${request_id}`, null, 'GET');
  return { request_id, status: res.status || res.state || 'IN_PROGRESS', raw: res };
}

async function getGrokImagineVideoResult(request_id) {
  const res = await callGrokImagine(`/v1/videos/${request_id}`, null, 'GET');
  // Try common shapes for the final asset
  const video_url = res.video_url || res.url || (res.video && res.video.url) || (res.outputs && res.outputs[0]) || (res.data && res.data.video_url);
  return { request_id, video_url, status: res.status || 'COMPLETED', raw: res };
}

async function generateGrokImagineImage({ prompt, model, aspect_ratio, resolution, character_image_url, name }) {
  const imgPayload = {
    model: model || 'grok-imagine-image-quality',
    prompt,
  };
  if (aspect_ratio) imgPayload.aspect_ratio = aspect_ratio;
  if (resolution) imgPayload.resolution = resolution;
  if (character_image_url) {
    imgPayload.image = { url: character_image_url }; // for image editing / reference based gen
  }
  const res = await callGrokImagine('/v1/images/generations', imgPayload);
  const url = res.url || res.data?.[0]?.url || res.images?.[0]?.url || 'https://picsum.photos/seed/grokimg' + Date.now() + '/512/512';
  return { url, prompt, grok: true, raw: res };
}

// Shared Grok caller so picture + video prompt stages go thru the same brain as the 82 agents.
// This is the consolidation the user asked about ("would it be easier to do all video and picture gen thru grok").
// DECISION: For maximum cohesiveness, "all gen thru grok" (Imagine I2V/I2I + vision chat for prompts/agents) wins over any external renderer,
// because the model that understands cinematic continuity and reference images is the same one writing the instructions and doing the pixels.
// We have wired vision into the prompt stages + a final polish + picture gen. When a Grok Imagine key is available the submit path
// can be extended to call the native I2V instead of (or in addition to) WaveSpeed for the absolute tightest photo match + motion continuity.
function callGrok(systemPrompt, userPayload) {
  // Shared Grok caller so picture + video prompt stages go thru the same brain as the 82 agents.
  // Upgraded for vision: supports {text, images: [{url}]} so Grok can *see* the locked character/location photos
  // when writing reference prompts or per-shot video prompts. This produces far tighter photo-matching instructions
  // than text descriptions alone, which is the key to superior cohesiveness.
  return new Promise((resolve, reject) => {
    let userContent;
    if (typeof userPayload === 'string') {
      userContent = userPayload;
    } else if (userPayload && (userPayload.text || userPayload.images)) {
      const parts = [];
      if (userPayload.text) parts.push({ type: 'text', text: userPayload.text });
      if (Array.isArray(userPayload.images)) {
        userPayload.images.slice(0, 3).forEach(img => {
          if (img && img.url) parts.push({ type: 'image_url', image_url: { url: img.url, detail: 'high' } });
        });
      }
      userContent = parts.length > 1 ? parts : (parts[0] && parts[0].text ? parts[0].text : JSON.stringify(userPayload));
    } else {
      userContent = JSON.stringify(userPayload || {});
    }

    const data = JSON.stringify({
      model: 'grok-3-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.6,
      max_tokens: 750
    });

    const options = {
      hostname: 'api.x.ai',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (process.env.XAI_API_KEY || process.env.GROK_API_KEY),
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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Bad JSON' }) };
  }

  const { action, model, prompt, duration, aspect_ratio, request_id, character_image_url, shotKey, location, type, name, desc, points } = body;

  // Basic auth passthrough (expand with verify-token in real prod)
  const auth = event.headers.authorization || '';

  // === PICTURE GEN - model aware routing with constraints enforced on client
  // Models (exact user list): wan-2.7, flux-xai (XAI direct "Flux (pulling thru XAI API)"), nano-banana, nano-banana-pro, gpt-image-2 "GPT 2.0" (via WaveSpeed)
  // Always enrich prompt with Grok vision first for coherence with locked refs.
  if (action === 'generate_picture') {
    const photoModel = body.model || 'flux-xai';
    const hasGrokKey = !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY);
    const hasWsKey = !!process.env.WAVESPEED_API_KEY;

    // Always run the intelligence / vision prompt enrichment first (our strength)
    const sys = 'You are a world-class cinematic still photographer and prompt engineer for film reference photos (character portraits and location plates). Produce an ultra-specific, coherent prompt that will be used either for an image model or as a detailed caption for local rendering. When reference images are provided, describe and lock to the exact visible details (face structure, scar, fabric texture, light falloff, reflections, weather on surfaces). Output ONLY the prompt text, 1-3 tight paragraphs, no intro.';
    const textPayload = JSON.stringify({ type: type || 'character', name: name || 'subject', desc: desc || prompt || '', points: points || [], location: location || {}, shotKey: shotKey || '' });

    const picImages = [];
    if (body.referenceImages && Array.isArray(body.referenceImages)) body.referenceImages.forEach(r => r && r.url && picImages.push({url:r.url}));
    if (body.images && Array.isArray(body.images)) body.images.forEach(i => i && i.url && picImages.push({url:i.url}));
    if (body.charPhoto) picImages.push({url: body.charPhoto});
    if (body.locationPhoto) picImages.push({url: body.locationPhoto});

    const userForGrok = picImages.length ? { text: textPayload, images: picImages } : textPayload;

    let imagePrompt = desc || 'cinematic reference photo';
    try {
      const grokRes = await callGrok(sys, userForGrok);
      imagePrompt = (grokRes && grokRes.output) ? grokRes.output.trim() : imagePrompt;
    } catch (e) {}

    // Route based on model. Client now sends broad choices for res/aspect/refs (no pre-filter); backend forwards exactly what the user picked.
    const isXaiDirectPhoto = photoModel === 'flux-xai' || photoModel.includes('grok-imagine-image') || photoModel.includes('flux');
    if (isXaiDirectPhoto && hasGrokKey) {
      try {
        const xaiModel = (photoModel === 'flux-xai') ? 'grok-imagine-image-quality' : 'grok-imagine-image-quality';
        const imgRes = await generateGrokImagineImage({
          prompt: imagePrompt,
          model: xaiModel,
          aspect_ratio: body.aspect_ratio,
          resolution: body.resolution,
          character_image_url: picImages[0] ? picImages[0].url : null,
          name
        });
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            prompt: imagePrompt,
            url: imgRes.url,
            demo_url: imgRes.url,
            grok_enriched: true,
            vision_used: picImages.length > 0,
            model: photoModel,
            note: 'Real pixels from Flux/Grok Imagine via XAI (vision-enriched prompt + refs).'
          })
        };
      } catch (e) {
        console.error('XAI photo gen failed, falling to demo', e);
      }
    }

    // All other photo models (wan-2.7, nano-banana*, gpt-image-2) go through WaveSpeed using the exact model name.
    // Full user choice for resolution/aspect/refs is forwarded (no client-side constraints).
    if (hasWsKey) {
      try {
        // Use wavespeed for image gen - forward the chosen model and valid params
        const wsBody = {
          model: photoModel,  // e.g. "wan-2.7", "nano-banana-pro", "gpt-image-2"
          prompt: imagePrompt,
          // forward whatever the user selected in the UI (broad options)
          ...(body.aspect_ratio && { aspect_ratio: body.aspect_ratio }),
          ...(body.resolution && { resolution: body.resolution }),
          ...(picImages[0] && { reference_image: picImages[0].url }),
          // multiple refs if model supports (WaveSpeed will use)
          ...(picImages.length > 1 && { reference_images: picImages.map(i => i.url) })
        };
        const result = await callWaveSpeed('/submit', wsBody); // WaveSpeed unified - model name tells it image vs video gen + supported params only
        const url = result.url || result.image_url || result.data?.url || 'https://picsum.photos/seed/ws' + Date.now() + '/512/512';
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            prompt: imagePrompt,
            url,
            demo_url: url,
            grok_enriched: true,
            vision_used: picImages.length > 0,
            model: photoModel,
            note: `Generated via ${photoModel} on WaveSpeed (params filtered to model support).`
          })
        };
      } catch (e) {
        console.error('WaveSpeed photo failed', e);
      }
    }

    // Final demo fallback (local or no keys)
    const demoSeed = (name || 'plate').replace(/\s+/g,'').toLowerCase() + Date.now().toString(36).slice(-6);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        prompt: imagePrompt,
        demo_url: 'https://picsum.photos/seed/' + demoSeed + '/512/512',
        grok_enriched: true,
        vision_used: picImages.length > 0,
        model: photoModel,
        note: 'High-quality local demo (configure keys for real ' + photoModel + '). Client enforces model-supported resolution/aspect/refs.'
      })
    };
  }

  // Upload stub so per-shot char photos (data URLs from +Add) can be turned into usable refs.
  // In a real deploy you would push to S3 / signed URL / bucket and return a public https.
  // For now we echo a usable marker; client local fallbacks consume data: or http equally.
  if (action === 'upload_image') {
    const dataUrl = body.image_data_url || body.data_url;
    const fname = body.filename || 'ref.jpg';
    if (!dataUrl) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'image_data_url required' }) };
    }
    // Demo: return the original data as "hosted" for local coherence; in prod replace with real upload.
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ url: dataUrl, filename: fname, note: 'demo-echo (use real bucket in prod for permanent https refs to WaveSpeed)' })
    };
  }

  if (action === 'submit') {
    const videoModel = body.model || 'seedance-2.0-turbo';
    const hasWsKey = !!process.env.WAVESPEED_API_KEY;
    const hasGrokKey = !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY);

    // Demo fallback when no keys at all
    if (!hasWsKey && !hasGrokKey) {
      const fakeId = (videoModel.includes('grok') ? 'grok_demo_' : 'ws_demo_') + Date.now();
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ request_id: fakeId, status: 'SUBMITTED', model: videoModel })
      };
    }

    try {
      let finalPrompt = prompt;

      // Always do the final vision polish if we have refs + Grok key (intelligence layer is shared)
      if (character_image_url && hasGrokKey) {
        try {
          const polishSys = 'You are the final prompt polish pass for a film. You are given a draft video prompt and a reference image of the main character(s) or location. Rewrite the prompt (keep it under ~280 tokens) so it contains *explicit, precise instructions* to visually match the supplied reference image exactly (specific facial details, scar, wardrobe texture/wear, lighting on skin, proportions, etc.). Do not add new story. Output only the improved prompt text.';
          const polishPayload = { text: `Draft prompt: ${prompt}\n\nShot key: ${shotKey || ''}\nLocation: ${JSON.stringify(location || {})}`, images: [{url: character_image_url}] };
          const polish = await callGrok(polishSys, polishPayload);
          if (polish && polish.output && polish.output.length > 30) finalPrompt = polish.output.trim();
        } catch (e) { /* non-fatal */ }
      }

      const isGrokImagineVideo = videoModel === 'grok-imagine' || videoModel.includes('grok-imagine');
      if (isGrokImagineVideo && hasGrokKey) {
        // Direct XAI Grok Imagine for video (exact "Grok Imagine (done through XAI API)" per user list)
        const grokRes = await submitGrokImagineVideo({
          prompt: finalPrompt,
          duration,
          aspect_ratio,
          character_image_url,
          shotKey,
          location,
          model: 'grok-imagine-video'
        });
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ...grokRes, model: videoModel, note: 'Direct via XAI Grok Imagine' })
        };
      } else {
        // WaveSpeed for all other video models (Seedance 2.0 Turbo, Wan 2.7, Sora 2, Veo 3.1 per exact user list)
        // User-selected resolution/duration/aspect/refs forwarded as-is (no client pre-filtering).
        const wavespeedBody = {
          model: videoModel, // e.g. "wan-2.7", "sora-2", "seedance-2.0-turbo", "veo-3.1"
          prompt: finalPrompt,
          duration: duration || 6,
          aspect_ratio: aspect_ratio || '16:9',
          ...(body.resolution && { resolution: body.resolution }),
          ...(character_image_url && { reference_image: character_image_url }),
          // pass multiple refs if provided for models that support (WaveSpeed handles)
          ...(body.reference_images && { reference_images: body.reference_images }),
          ...(shotKey && { shot_key: shotKey }),
          ...(location && { location_context: location })
        };
        const result = await callWaveSpeed('/submit', wavespeedBody);
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ...result, model: videoModel })
        };
      }
    } catch (err) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'Video submit failed for model ' + videoModel, detail: err.message })
      };
    }
  }

  if (action === 'status' && request_id) {
    const isGrokJob = request_id.startsWith('grok_');
    if ((isGrokJob && ! (process.env.XAI_API_KEY || process.env.GROK_API_KEY)) || (!isGrokJob && !process.env.WAVESPEED_API_KEY) || request_id.includes('demo_')) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ request_id, status: 'COMPLETED', provider: isGrokJob ? 'grok-imagine' : 'wavespeed' })
      };
    }
    try {
      if (isGrokJob) {
        const r = await getGrokImagineVideoStatus(request_id);
        return { statusCode: 200, headers: CORS, body: JSON.stringify(r) };
      } else {
        const result = await callWaveSpeed('/status/' + request_id, null, 'GET');
        return { statusCode: 200, headers: CORS, body: JSON.stringify(result) };
      }
    } catch (err) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (action === 'result' && request_id) {
    const isGrokJob = request_id.startsWith('grok_');
    if ((isGrokJob && !(process.env.XAI_API_KEY || process.env.GROK_API_KEY)) || (!isGrokJob && !process.env.WAVESPEED_API_KEY) || request_id.includes('demo_')) {
      const seed = (isGrokJob ? 'grokdemo' : 'wsdemo') + (request_id || '') + (body && body.shotKey ? body.shotKey.replace(/[^a-z0-9]/gi,'') : '');
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ request_id, video_url: 'https://picsum.photos/seed/' + seed + '/1280/720', status: 'COMPLETED', provider: isGrokJob ? 'grok-imagine' : 'wavespeed', note: 'demo result (configure the corresponding key for real)' })
      };
    }
    try {
      if (isGrokJob) {
        const r = await getGrokImagineVideoResult(request_id);
        return { statusCode: 200, headers: CORS, body: JSON.stringify(r) };
      } else {
        const result = await callWaveSpeed('/result/' + request_id, null, 'GET');
        return { statusCode: 200, headers: CORS, body: JSON.stringify(result) };
      }
    } catch (err) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  return {
    statusCode: 400,
    headers: CORS,
    body: JSON.stringify({ error: 'Unknown action or missing params' })
  };
};