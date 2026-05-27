exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let prompt, model, duration;
  try {
    const body = JSON.parse(event.body);
    prompt   = body.prompt;
    model    = body.model    || 'kling-3.0';
    duration = body.duration || 5;
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
  }
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt required' }) };

  const WAVESPEED_KEY = process.env.WAVESPEED_API_KEY;

  const MODEL_CONFIG = {
    'kling-3.0': {
      key: WAVESPEED_KEY,
      endpoint: 'https://api.wavespeed.ai/api/v3/kwaivgi/kling-v2.1-t2v-master',
      allowedDurations: [5, 10],
      buildBody: (p, d) => ({
        prompt: p,
        duration: d,
        aspect_ratio: '16:9',
        mode: 'std',
        cfg_scale: 0.5
      })
    },
    'kling-pro': {
      key: WAVESPEED_KEY,
      endpoint: 'https://api.wavespeed.ai/api/v3/kwaivgi/kling-v2.6-pro-text-to-video',
      allowedDurations: [5, 10],
      buildBody: (p, d) => ({
        prompt: p,
        duration: d,
        aspect_ratio: '16:9',
        mode: 'pro',
        cfg_scale: 0.5
      })
    },
    'veo-3.1': {
      key: WAVESPEED_KEY,
      endpoint: 'https://api.wavespeed.ai/api/v3/google/veo3.1/text-to-video',
      allowedDurations: [5, 8],
      buildBody: (p, d) => ({
        prompt: p,
        duration: d,
        aspect_ratio: '16:9',
        generate_audio: false
      })
    },
    'wan-2.7': {
      key: WAVESPEED_KEY,
      endpoint: 'https://api.wavespeed.ai/api/v3/alibaba/wan-2.6-text-to-video',
      allowedDurations: [5, 10],
      buildBody: (p, d) => ({
        prompt: p,
        duration: d,
        size: '1280*720',
        num_inference_steps: 30,
        guidance_scale: 5,
        flow_shift: 5,
        seed: -1,
        enable_safety_checker: false
      })
    },
    'seedance-turbo': {
      key: WAVESPEED_KEY,
      endpoint: 'https://api.wavespeed.ai/api/v3/wavespeed-ai/seedance-1-0-lite-t2v-480p',
      allowedDurations: [5],
      buildBody: (p, d) => ({
        prompt: p,
        duration: 5,
        size: '854*480',
        seed: -1
      })
    }
  };

  const cfg = MODEL_CONFIG[model];
  if (!cfg) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown model: ' + model }) };
  if (!cfg.key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured for model: ' + model }) };

  // Clamp duration to what the model supports
  const safeDuration = cfg.allowedDurations.includes(Number(duration))
    ? Number(duration)
    : cfg.allowedDurations[0];

  // Submit generation request with 25s timeout
  let requestId;
  const submitCtrl = new AbortController();
  const submitTmo  = setTimeout(() => submitCtrl.abort(), 25000);
  try {
    const submitRes = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg.buildBody(prompt, safeDuration)),
      signal: submitCtrl.signal
    });
    const submitData = await submitRes.json();
    console.log('gen-clip submit:', model, JSON.stringify(submitData).slice(0, 300));
    requestId = (submitData.data && submitData.data.id)
      || submitData.id
      || (submitData.data && submitData.data.task_id)
      || submitData.task_id;
    if (!requestId) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No requestId from API', detail: submitData }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Submit failed: ' + e.message }) };
  } finally {
    clearTimeout(submitTmo);
  }

  return { statusCode: 202, headers, body: JSON.stringify({ requestId, model, duration: safeDuration, status: 'processing' }) };
};
