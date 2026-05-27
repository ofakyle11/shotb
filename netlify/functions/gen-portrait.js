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

  let prompt, modelKey;
  try {
    const body = JSON.parse(event.body);
    prompt = body.prompt;
    modelKey = body.model || 'wan';
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
  }
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt required' }) };

  // Model routing
  const MODELS = {
    wan:    'wavespeed-ai/wan2.1-t2i-1.3b',
    banana: 'wavespeed-ai/nano-banana-pro'
  };
  const MODEL = MODELS[modelKey] || MODELS.wan;
  const submitUrl = `https://api.wavespeed.ai/api/v3/${MODEL}`;

  let requestId;
  try {
    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size: '768*1024', num_images: 1, enable_safety_checker: false })
    });
    const submitData = await submitRes.json();
    requestId = (submitData.data && submitData.data.id) || submitData.id;
    if (!requestId) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No requestId from Wavespeed', detail: submitData }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Wavespeed submit failed: ' + e.message }) };
  }

  // Poll max 24s (8 x 3s) -- stays under Netlify 26s function limit
  const resultUrl = `https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`;
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const pollRes = await fetch(resultUrl, { headers: { 'Authorization': `Bearer ${key}` } });
      const pollData = await pollRes.json();
      const status = (pollData.data && pollData.data.status) || pollData.status;
      if (status === 'completed') {
        const outputs = (pollData.data && pollData.data.outputs) || pollData.outputs || [];
        const imageUrl = outputs[0] || (pollData.data && pollData.data.output && pollData.data.output[0]);
        if (imageUrl) return { statusCode: 200, headers, body: JSON.stringify({ imageUrl }) };
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'No output URL', detail: pollData }) };
      }
      if (status === 'failed') {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Generation failed', detail: pollData }) };
      }
    } catch(e) { /* keep polling */ }
  }

  return { statusCode: 504, headers, body: JSON.stringify({ error: 'Timeout waiting for portrait' }) };
};
