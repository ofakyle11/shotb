exports.handler = async (event) => {
  const key = process.env.WAVESPEED_API_KEY;
  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) return { statusCode: 400, body: 'id required' };
  const urls = [
    `https://api.wavespeed.ai/api/v3/predictions/${id}`,
    `https://api.wavespeed.ai/api/v3/predictions/${id}/result`,
    `https://api.wavespeed.ai/api/v2/predictions/${id}`,
    `https://api.wavespeed.ai/api/v2/predictions/${id}/result`,
  ];
  const results = {};
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${key}` } });
      const text = await r.text();
      results[url] = { status: r.status, body: text.slice(0, 200) };
    } catch(e) { results[url] = { error: e.message }; }
  }
  return { statusCode: 200, headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body: JSON.stringify(results, null, 2) };
};
