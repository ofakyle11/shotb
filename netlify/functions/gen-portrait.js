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

  let prompt;
  try {
    const body = JSON.parse(event.body);
    prompt = body.prompt;
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid body' }) };
  }
  if (!prompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'prompt required' }) };

  // Submit task to Wavespeed nano banana 2 (Gemini 3.1 Flash Image — fast)
  const MODEL = 'google/nano-banana-2/text-to-image-fast';
  const submitUrl = `https://api.wavespeed.ai/api/v3/${MODEL}`;

  let requestId;
  try {
    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt,
        size: '768*1024',
        num_images: 1
      })
    });
    const submitData = await submitRes.json();
    // Wavespeed v3 returns { data: { id: '...' } } or { id: '...' }
    requestId = (submitData.data && submitData.data.id) || submitData.id;
    if (!requestId) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'No requestId from Wavespeed', detail: submitData }) };
    }
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Wavespeed submit failed: ' + e.message }) };
  }

  // Poll for result — max 60s (12 x 5s)
  const resultUrl = `https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const pollRes = await fetch(resultUrl, {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      const pollData = await pollRes.json();
      const status = (pollData.data && pollData.data.status) || pollData.status;
      if (status === 'completed' || status === 'succeeded') {
        // outputs is array of image URLs
        const outputs = (pollData.data && pollData.data.outputs) || pollData.outputs || [];
        const imageUrl = outputs[0] || null;
        if (imageUrl) {
          return { statusCode: 200, headers, body: JSON.stringify({ imageUrl }) };
        }
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'No output URL', detail: pollData }) };
      }
      if (status === 'failed' || status === 'error') {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Generation failed', detail: pollData }) };
      }
      // still processing — keep polling
    } catch(e) {
      // transient poll error — keep trying
    }
  }

  return { statusCode: 504, headers, body: JSON.stringify({ error: 'Timeout waiting for portrait generation' }) };
};
