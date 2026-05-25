exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const key = process.env.WAVESPEED_API_KEY;
  if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'WAVESPEED_API_KEY not set' }) };

  let prompt, quality;
  try {
    const body = JSON.parse(event.body);
    prompt = body.prompt;
    quality = body.quality || 'standard';
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
  }
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt required' }) };

  // Correct Wavespeed model IDs (use slashes: wan-2.1/t2v-...)
  const MODEL_MAP = {
    standard: 'wavespeed-ai/wan-2.1/t2v-720p',
    pro:      'wavespeed-ai/wan-2.1/t2v-720p',
    veo:      'wavespeed-ai/wan-2.1/t2v-720p'
  };
  const model = MODEL_MAP[quality] || MODEL_MAP.standard;
  const submitUrl = `https://api.wavespeed.ai/api/v3/${model}`;

  let requestId;
  try {
    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        duration: 5,
        size: '1280*720',
        num_inference_steps: 30,
        guidance_scale: 5,
        flow_shift: 5,
        seed: -1,
        enable_safety_checker: false
      })
    });
    const submitData = await submitRes.json();
    console.log('Wavespeed submit response:', JSON.stringify(submitData));
    requestId = (submitData.data && submitData.data.id) || submitData.id;
    if (!requestId) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No requestId from Wavespeed', detail: submitData }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Wavespeed submit failed: ' + e.message }) };
  }

  // Return requestId immediately -- client polls /gen-clip-status?id=...
  return { statusCode: 202, headers, body: JSON.stringify({ requestId, status: 'processing' }) };
};
