const https = require('https');

const { requireAuth } = require('./lib/verify-token');
const { corsHeaders } = require('./lib/http');
const { wrapUserContent, sanitizeField, UNTRUSTED_RULE } = require('./lib/sanitize-prompt');
const { isSafeUrl } = require('./lib/safe-url');
const {
  getOpenAIApiKey,
  isOpenAIVideoJob,
  humanizeOpenAIError,
  submitOpenAIVideo,
  getOpenAIVideoStatus,
  getOpenAIVideoResult,
} = require('./lib/openai-video');
const {
  submitAIVideoAPISora,
  getAIVideoAPITaskStatus,
  getAIVideoAPITaskResult,
  isAIVideoAPIJob,
  humanizeAIVideoAPIError,
} = require('./lib/aivideoapi');
const { env, hasEnv } = require('./lib/env');
const {
  storeOpenAIApiKey,
  storeAIVideoApiKey,
  resolveAIVideoApiKey,
  providerKeyDiagnostics,
} = require('./lib/server-secrets');

function jsonResponse(event, statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(event),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function callWaveSpeed(path, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const isGet = method.toUpperCase() === 'GET';
    let data = '';
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (process.env.WAVESPEED_API_KEY || '')
    };
    if (!isGet && body) {
      data = JSON.stringify(body);
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const options = {
      hostname: 'api.wavespeed.ai',
      port: 443,
      path: path.startsWith('/') ? path : '/' + path,
      method,
      headers
    };

    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(buf);
          parsed.httpStatus = res.statusCode;
          resolve(parsed);
        } catch (e) {
          resolve({ raw: buf, status: res.statusCode, code: res.statusCode, httpStatus: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// WaveSpeed v3: GET /predictions/{id} is canonical; /result is a fallback alias.
function normalizeWaveSpeedStatus(st) {
  const s = String(st || '').toLowerCase();
  if (['completed', 'succeeded', 'success', 'done', 'finished'].includes(s)) return 'COMPLETED';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'FAILED';
  return 'PROCESSING';
}

function isFakeWaveSpeedId(request_id) {
  if (!request_id) return true;
  if (request_id.includes('demo_')) return true;
  if (request_id.startsWith('ws_')) return true;
  return false;
}

async function fetchWaveSpeedPrediction(request_id) {
  const paths = [
    '/api/v3/predictions/' + request_id,
    '/api/v3/predictions/' + request_id + '/result',
  ];
  let last = null;
  for (const path of paths) {
    try {
      const res = await callWaveSpeed(path, null, 'GET');
      last = res;
      const httpOk = res && res.httpStatus && res.httpStatus < 400;
      const codeOk = !res.code || res.code === 200;
      const hasPayload = !!(res.data && (res.data.status || res.data.outputs || res.data.id));
      if (httpOk && codeOk && hasPayload) return res;
    } catch (e) {
      last = { error: e.message, httpStatus: 500 };
    }
  }
  return last || { code: 404, message: 'prediction not found', httpStatus: 404 };
}

function humanizeWaveSpeedError(result) {
  const parts = [];
  if (result) {
    if (result.message) parts.push(String(result.message));
    if (result.error) parts.push(String(result.error));
    if (result.raw) parts.push(typeof result.raw === 'string' ? result.raw : JSON.stringify(result.raw));
    if (result.data && result.data.error) parts.push(String(result.data.error));
    if (result.data && result.data.message) parts.push(String(result.data.message));
  }
  const blob = parts.join(' ').toLowerCase();
  if (/insufficient|balance|credit|quota|billing|payment|funds|not enough/.test(blob)) {
    return 'WaveSpeed API credits exhausted on the platform account. Top up WaveSpeed billing or contact support.';
  }
  if (/unauthorized|invalid.*key|api key|forbidden|access denied/.test(blob)) {
    return 'WaveSpeed API key invalid or missing. Check WAVESPEED_API_KEY in Netlify env.';
  }
  return parts.filter(Boolean).join(' — ') || 'no job id returned';
}

function extractWaveSpeedOutput(result) {
  if (!result) return null;
  const data = result.data || result;
  const candidates = [];
  if (Array.isArray(data.outputs) && data.outputs.length) candidates.push(data.outputs[0]);
  if (Array.isArray(result.outputs) && result.outputs.length) candidates.push(result.outputs[0]);
  if (data.output) candidates.push(data.output);
  if (data.video_url) candidates.push(data.video_url);
  if (data.url) candidates.push(data.url);
  if (result.video_url) candidates.push(result.video_url);
  if (result.url) candidates.push(result.url);
  for (const out of candidates) {
    if (!out) continue;
    if (typeof out === 'string' && /^https?:\/\//i.test(out)) return out;
    if (out && typeof out === 'object' && out.url) return out.url;
  }
  return null;
}

// --- Grok Imagine helpers (for when user chooses Grok native for pictures or video) ---
// Uses the official xAI Imagine REST endpoints (api.x.ai/v1/images/generations and /v1/videos/generations)
// Supports the same submit/status/result action contract as WaveSpeed for minimal client changes.
// Auth uses XAI_API_KEY (same as agents). Supports reference images for I2I / I2V with high cohesion.
function callGrokImagine(path, payload, method = 'POST') {
  return new Promise((resolve, reject) => {
    const isGet = method.toUpperCase() === 'GET';
    const data = isGet ? null : Buffer.from(JSON.stringify(payload || {}), 'utf8');
    const headers = {
      'Authorization': 'Bearer ' + (process.env.XAI_API_KEY || process.env.GROK_API_KEY || ''),
    };
    if (!isGet) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const options = {
      hostname: 'api.x.ai',
      port: 443,
      path,
      method,
      headers
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            const msg = (json.error && (json.error.message || json.error)) || json.message || body;
            reject(new Error('XAI API ' + res.statusCode + ': ' + msg));
            return;
          }
          resolve(json);
        } catch (e) {
          if (res.statusCode >= 400) {
            reject(new Error('XAI API ' + res.statusCode + ': ' + body));
            return;
          }
          resolve({ raw: body, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function normalizeGrokVideoStatus(st) {
  const s = String(st || '').toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'success' || s === 'succeeded') return 'COMPLETED';
  if (s === 'failed' || s === 'error' || s === 'expired' || s === 'cancelled' || s === 'canceled') return 'FAILED';
  if (s === 'pending' || s === 'processing' || s === 'in_progress' || s === 'queued' || s === 'submitted') return 'PROCESSING';
  return 'PROCESSING';
}

function normalizeXaiResolution(res) {
  if (!res) return '1k';
  const r = String(res).toLowerCase().replace(/\s/g, '');
  if (r === '1k' || r === '1024' || r === '1024x1024' || r === '720p') return '1k';
  if (r === '2k' || r === '1080p') return '2k';
  return r;
}

function isGrokVideoJob(request_id, provider, model) {
  if (provider === 'grok-imagine' || provider === 'xai') return true;
  if (model && String(model).includes('grok')) return true;
  if (request_id && String(request_id).startsWith('grok_')) return true;
  return false;
}

function extractGrokImageUrl(res) {
  if (!res) throw new Error('Empty XAI image response');
  if (res.error) {
    const err = res.error.message || res.error.code || JSON.stringify(res.error);
    throw new Error('XAI image error: ' + err);
  }
  const url = res.url
    || (Array.isArray(res.data) && res.data[0] && res.data[0].url)
    || (res.images && res.images[0] && (res.images[0].url || res.images[0]))
    || null;
  if (!url || typeof url !== 'string') {
    throw new Error('XAI image API returned no URL — check XAI_API_KEY and model grok-imagine-image-quality');
  }
  return url;
}

function extractGrokVideoUrl(res) {
  if (!res) return null;
  if (res.video && res.video.url) return res.video.url;
  return res.video_url || res.url || (res.outputs && res.outputs[0]) || (res.data && res.data.video_url) || null;
}

async function submitGrokImagineVideo({ prompt, duration, aspect_ratio, character_image_url, resolution }) {
  const imaginePayload = {
    model: 'grok-imagine-video',
    prompt,
    duration: Math.min(15, Math.max(1, Number(duration) || 6)),
    aspect_ratio: aspect_ratio || '16:9',
    resolution: resolution || '720p'
  };
  if (character_image_url && isSafeUrl(character_image_url)) {
    imaginePayload.image = { url: character_image_url };
  }

  const res = await callGrokImagine('/v1/videos/generations', imaginePayload);
  const rid = res.request_id || res.id || res.requestId;
  if (!rid) throw new Error('XAI video submit returned no request_id');
  return { request_id: rid, status: 'SUBMITTED', provider: 'grok-imagine', raw: res };
}

async function getGrokImagineVideoStatus(request_id) {
  const res = await callGrokImagine(`/v1/videos/${request_id}`, null, 'GET');
  const st = normalizeGrokVideoStatus(res.status || res.state);
  const video_url = st === 'COMPLETED' ? extractGrokVideoUrl(res) : null;
  if (st === 'FAILED' && res.error) {
    return {
      request_id,
      status: st,
      error: res.error.message || res.error.code || 'Grok video failed',
      provider: 'grok-imagine',
      raw: res
    };
  }
  return { request_id, status: st, video_url, provider: 'grok-imagine', raw: res };
}

async function getGrokImagineVideoResult(request_id) {
  const res = await callGrokImagine(`/v1/videos/${request_id}`, null, 'GET');
  const st = normalizeGrokVideoStatus(res.status || res.state);
  const video_url = extractGrokVideoUrl(res);
  if (st === 'FAILED') {
    return {
      request_id,
      video_url: null,
      status: st,
      error: (res.error && (res.error.message || res.error.code)) || 'Grok video generation failed',
      provider: 'grok-imagine',
      raw: res
    };
  }
  return { request_id, video_url, status: st, provider: 'grok-imagine', raw: res };
}

async function generateGrokImagineImage({ prompt, model, aspect_ratio, resolution, character_image_url }) {
  const imgPayload = {
    model: model || 'grok-imagine-image-quality',
    prompt,
  };
  if (aspect_ratio) imgPayload.aspect_ratio = aspect_ratio;
  if (resolution) imgPayload.resolution = normalizeXaiResolution(resolution);
  if (character_image_url && isSafeUrl(character_image_url)) {
    imgPayload.image = { url: character_image_url };
  }
  const res = await callGrokImagine('/v1/images/generations', imgPayload);
  const url = extractGrokImageUrl(res);
  return { url, prompt, grok: true, raw: res };
}

function isKlingModel(modelId) {
  return (modelId || '').toLowerCase().includes('kling');
}

function isVeoModel(modelId) {
  return (modelId || '').toLowerCase().includes('veo');
}

function isSoraModel(modelId) {
  return (modelId || '').toLowerCase().includes('sora');
}

function isWanVideoModel(modelId) {
  const m = (modelId || '').toLowerCase();
  return m.includes('wan');
}

function isSeedanceModel(modelId) {
  return (modelId || '').toLowerCase().includes('seedance');
}

function clampVeoDuration(d) {
  const allowed = [4, 6, 8];
  const n = Number(d) || 8;
  if (allowed.includes(n)) return n;
  return allowed.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), 8);
}

function clampVeoAspect(ar) {
  return ar === '9:16' ? '9:16' : '16:9';
}

function clampVeoResolution(res) {
  return res === '1080p' ? '1080p' : '720p';
}

function collectRefImageUrls(fields) {
  const urls = [];
  const primary = pickRefImageUrl(fields);
  if (primary) urls.push(primary);
  if (Array.isArray(fields.reference_images)) {
    for (const r of fields.reference_images) {
      if (r && isSafeUrl(r) && !urls.includes(r)) urls.push(r);
    }
  }
  return urls.slice(0, 3);
}

function getKlingTier(modelId) {
  const m = (modelId || '').toLowerCase();
  if (m.includes('turbo') || m === 'kling-pro') return 'kling-v3-turbo-pro';
  return 'kling-v3.0-pro';
}

function clampKlingDuration(d) {
  const n = Number(d) || 5;
  return Math.min(15, Math.max(3, Math.round(n)));
}

function clampSoraDuration(d) {
  const allowed = [4, 8, 12, 16, 20];
  const n = Number(d) || 4;
  if (allowed.includes(n)) return n;
  return allowed.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), 4);
}

function soraSizeFromAspect(ar) {
  return ar === '9:16' ? '720*1280' : '1280*720';
}

function clampWanDuration(d) {
  const n = Number(d) || 5;
  return Math.min(15, Math.max(2, Math.round(n)));
}

function clampWanResolution(res) {
  return res === '1080p' ? '1080p' : '720p';
}

function clampSeedanceDuration(d) {
  const n = Number(d) || 5;
  return Math.min(15, Math.max(4, Math.round(n)));
}

function clampSeedanceResolution(res) {
  return res === '1080p' ? '1080p' : '720p';
}

function pickRefImageUrl(body) {
  if (body.character_image_url && isSafeUrl(body.character_image_url)) return body.character_image_url;
  if (Array.isArray(body.reference_images)) {
    for (const r of body.reference_images) {
      if (r && isSafeUrl(r)) return r;
    }
  }
  return null;
}

// Map client model ids (exact user list) to WaveSpeed /api/v3/ path slugs.
// These are derived from WaveSpeed docs + model library (bytedance/ for Seedance, alibaba/ or wavespeed-ai/ for Wan, etc).
// For I2V prefer image-to-video variants when refs present (client passes character_image_url / reference_image).
function getWaveSpeedPath(modelId, hasRefImage = false) {
  const m = (modelId || '').toLowerCase();
  if (m.includes('kling')) {
    const tier = getKlingTier(modelId);
    return hasRefImage ? `kwaivgi/${tier}/image-to-video` : `kwaivgi/${tier}/text-to-video`;
  }
  if (m.includes('seedance') || m.includes('seedance-2.0-turbo')) {
    return hasRefImage ? 'bytedance/seedance-2.0/image-to-video-turbo' : 'bytedance/seedance-2.0/text-to-video-turbo';
  }
  if (m.includes('wan-2.7') || m === 'wan-2.7') {
    // Wan 2.7 family has strong I2V/ref support on WaveSpeed
    return hasRefImage ? 'alibaba/wan-2.7/image-to-video' : 'alibaba/wan-2.7/text-to-video';
  }
  if (m.includes('sora') || m === 'sora-2') {
    return hasRefImage ? 'openai/sora-2/image-to-video' : 'openai/sora-2/text-to-video';
  }
  if (m.includes('veo') || m === 'veo-3.1') {
    return hasRefImage
      ? 'google/veo3.1-fast/reference-to-video'
      : 'google/veo3.1/text-to-video';
  }
  // photo models that go WS
  if (m.includes('nano-banana')) return 'wavespeed-ai/' + (m.includes('pro') ? 'nano-banana-pro' : 'nano-banana');
  if (m.includes('gpt-image') || m.includes('gpt-2.0')) return 'openai/gpt-image-2';
  // fallback — many models live under wavespeed-ai/ or bytedance/ etc; the model id in body helps platform route
  return `wavespeed-ai/${modelId || 'flux-dev'}`;
}

function buildWaveSpeedBody(videoModel, fields, hasRef) {
  const refUrl = pickRefImageUrl(fields);
  const refUrls = collectRefImageUrls(fields);

  if (isKlingModel(videoModel)) {
    const wsBody = {
      prompt: fields.prompt,
      duration: clampKlingDuration(fields.duration),
      aspect_ratio: fields.aspect_ratio || '16:9',
      cfg_scale: 0.5,
      sound: false,
    };
    if (hasRef && refUrl) wsBody.image = refUrl;
    if (fields.negative_prompt) wsBody.negative_prompt = sanitizeField(fields.negative_prompt, 500);
    return wsBody;
  }

  if (isVeoModel(videoModel)) {
    const wsBody = {
      prompt: fields.prompt,
      aspect_ratio: clampVeoAspect(fields.aspect_ratio),
      resolution: clampVeoResolution(fields.resolution),
      generate_audio: false,
    };
    if (hasRef && refUrls.length) {
      wsBody.images = refUrls;
    } else {
      wsBody.duration = clampVeoDuration(fields.duration);
    }
    if (fields.negative_prompt) wsBody.negative_prompt = sanitizeField(fields.negative_prompt, 500);
    return wsBody;
  }

  if (isSoraModel(videoModel)) {
    const wsBody = {
      prompt: fields.prompt,
      duration: clampSoraDuration(fields.duration),
    };
    if (hasRef && refUrl) {
      wsBody.image = refUrl;
    } else {
      wsBody.size = soraSizeFromAspect(fields.aspect_ratio);
    }
    return wsBody;
  }

  if (isWanVideoModel(videoModel)) {
    const wsBody = {
      prompt: fields.prompt,
      duration: clampWanDuration(fields.duration),
      resolution: clampWanResolution(fields.resolution),
    };
    if (hasRef && refUrl) {
      wsBody.image = refUrl;
    } else {
      wsBody.aspect_ratio = fields.aspect_ratio || '16:9';
    }
    if (fields.negative_prompt) wsBody.negative_prompt = sanitizeField(fields.negative_prompt, 500);
    return wsBody;
  }

  if (isSeedanceModel(videoModel)) {
    const wsBody = {
      prompt: fields.prompt,
      duration: clampSeedanceDuration(fields.duration),
      aspect_ratio: fields.aspect_ratio || '16:9',
      resolution: clampSeedanceResolution(fields.resolution),
      generate_audio: false,
      enable_web_search: false,
    };
    if (hasRef && refUrl) {
      wsBody.image = refUrl;
    } else if (refUrls.length) {
      wsBody.reference_images = refUrls;
    }
    return wsBody;
  }

  return {
    prompt: fields.prompt,
    duration: fields.duration || 6,
    aspect_ratio: fields.aspect_ratio || '16:9',
    ...(fields.resolution && { resolution: fields.resolution }),
    ...(refUrl && { image: refUrl }),
    ...(fields.shotKey && { shot_key: fields.shotKey }),
    ...(fields.location && { location_context: fields.location }),
  };
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

    const data = Buffer.from(JSON.stringify({
      model: 'grok-3-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.6,
      max_tokens: 750
    }), 'utf8');

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
  const CORS = corsHeaders(event);

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

  let authResult;
  try {
    authResult = await requireAuth(event);
  } catch (e) {
    return jsonResponse(event, 401, { error: 'Unauthorized - login required' });
  }
  const isOwner = !!authResult.isOwner;

  if (action === 'providers') {
    const diag = await providerKeyDiagnostics();
    let hint = 'No Sora key. Set AIVIDEOAPI_API_KEY in Netlify OR owner action set_aivideoapi_key (key from https://aivideoapi.ai/api-keys).';
    if (diag.aivideoapi) {
      hint = diag.aivideoapi_env
        ? 'Sora 2 via aivideoapi.ai (key from Netlify env).'
        : 'Sora 2 via aivideoapi.ai (key from Firebase server_secrets).';
    } else if (diag.openai) {
      hint = diag.openai_env
        ? 'Sora 2 via direct OpenAI (key from Netlify env).'
        : 'Sora 2 via direct OpenAI (key from Firebase server_secrets).';
    } else if (hasEnv('WAVESPEED_API_KEY')) {
      hint = 'Sora 2 will route via WaveSpeed (no aivideoapi/OpenAI key).';
    }
    return jsonResponse(event, 200, {
      ...diag,
      wavespeed: hasEnv('WAVESPEED_API_KEY'),
      grok: hasEnv('XAI_API_KEY') || hasEnv('GROK_API_KEY'),
      deploy_context: env('CONTEXT') || env('NETLIFY_CONTEXT') || null,
      hint,
    });
  }

  if (action === 'set_openai_key') {
    if (!isOwner) {
      return jsonResponse(event, 403, { error: 'Owner only — sign in as kylef/scott/steve owner' });
    }
    const apiKey = body.api_key || body.openai_api_key;
    if (!apiKey || !String(apiKey).trim().startsWith('sk-')) {
      return jsonResponse(event, 400, { error: 'api_key required (must start with sk-)' });
    }
    try {
      await storeOpenAIApiKey(apiKey);
      const diag = await providerKeyDiagnostics();
      return jsonResponse(event, 200, {
        ok: true,
        message: 'OpenAI key stored in Firebase server_secrets (server-only).',
        ...diag,
      });
    } catch (e) {
      return jsonResponse(event, 500, { error: 'Failed to store OpenAI key', detail: e.message });
    }
  }

  if (action === 'set_aivideoapi_key') {
    if (!isOwner) {
      return jsonResponse(event, 403, { error: 'Owner only — sign in as kylef/scott/steve owner' });
    }
    const apiKey = body.api_key || body.aivideoapi_api_key;
    if (!apiKey || !String(apiKey).trim().startsWith('sk-')) {
      return jsonResponse(event, 400, { error: 'api_key required (must start with sk-)' });
    }
    try {
      await storeAIVideoApiKey(apiKey);
      const diag = await providerKeyDiagnostics();
      return jsonResponse(event, 200, {
        ok: true,
        message: 'AI Video API key stored in Firebase server_secrets (server-only). Sora 2 will use aivideoapi.ai.',
        ...diag,
      });
    } catch (e) {
      return jsonResponse(event, 500, { error: 'Failed to store AI Video API key', detail: e.message });
    }
  }

  // === PICTURE GEN - model aware routing with constraints enforced on client
  // Models (exact user list): wan-2.7, flux-xai (XAI direct "Flux (pulling thru XAI API)"), nano-banana, nano-banana-pro, gpt-image-2 "GPT 2.0" (via WaveSpeed)
  // Always enrich prompt with Grok vision first for coherence with locked refs.
  if (action === 'generate_picture') {
    const photoModel = body.model || 'flux-xai';
    const hasGrokKey = !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY);
    const hasWsKey = !!process.env.WAVESPEED_API_KEY;

    // Always run the intelligence / vision prompt enrichment first (our strength)
    const sys = UNTRUSTED_RULE + ' You are a world-class cinematic still photographer and prompt engineer for film reference photos. When reference images are provided, describe visible details precisely. Output ONLY the prompt text, 1-3 tight paragraphs, no intro.';
    const textPayload = JSON.stringify({
      type: sanitizeField(type || 'character', 64),
      name: sanitizeField(name || 'subject', 200),
      desc: sanitizeField(desc || prompt || '', 2000),
      points: Array.isArray(points) ? points.slice(0, 20).map(p => sanitizeField(p, 500)) : [],
      location: location || {},
      shotKey: sanitizeField(shotKey || '', 200),
    });

    const picImages = [];
    if (body.referenceImages && Array.isArray(body.referenceImages)) body.referenceImages.forEach(r => { if (r && r.url && isSafeUrl(r.url)) picImages.push({url:r.url}); });
    if (body.images && Array.isArray(body.images)) body.images.forEach(i => { if (i && i.url && isSafeUrl(i.url)) picImages.push({url:i.url}); });
    if (body.charPhoto && isSafeUrl(body.charPhoto)) picImages.push({url: body.charPhoto});
    if (body.locationPhoto && isSafeUrl(body.locationPhoto)) picImages.push({url: body.locationPhoto});

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
        return jsonResponse(event, 200, {
          prompt: imagePrompt,
          url: imgRes.url,
          grok_enriched: true,
          vision_used: picImages.length > 0,
          model: photoModel,
          provider: 'grok-imagine',
          note: 'Real pixels from Grok Imagine via XAI (vision-enriched prompt + refs).'
        });
      } catch (e) {
        console.error('XAI photo gen failed', e);
        if (!hasWsKey) {
          return jsonResponse(event, 502, {
            error: 'Grok image generation failed',
            detail: e.message || String(e),
            model: photoModel,
            provider: 'grok-imagine',
            hint: 'Verify XAI_API_KEY is set in Netlify (Deploy + Preview) and the account has Imagine access.'
          });
        }
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
        const wsPath = '/api/v3/' + getWaveSpeedPath(photoModel, !!picImages.length);
        const result = await callWaveSpeed(wsPath, wsBody);
        const url = (result.data && result.data.outputs && result.data.outputs[0]) || result.url || result.image_url || result.data?.url || null;
        if (!url) {
          return jsonResponse(event, 502, {
            error: 'WaveSpeed photo returned no image URL',
            model: photoModel,
            provider: 'wavespeed',
            raw: result
          });
        }
        return jsonResponse(event, 200, {
          prompt: imagePrompt,
          url,
          grok_enriched: true,
          vision_used: picImages.length > 0,
          model: photoModel,
          provider: 'wavespeed',
          note: `Generated via ${photoModel} on WaveSpeed.`
        });
      } catch (e) {
        console.error('WaveSpeed photo failed', e);
      }
    }

    return jsonResponse(event, 503, {
      error: 'No image generation provider available',
      detail: isXaiDirectPhoto
        ? 'Set XAI_API_KEY for Grok/flux-xai photo models.'
        : 'Set WAVESPEED_API_KEY for ' + photoModel + '.',
      model: photoModel,
      grok_enriched: !!imagePrompt,
      vision_used: picImages.length > 0
    });
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
    const hasOpenAIKey = !!(await getOpenAIApiKey());
    const hasAIVideoKey = !!(await resolveAIVideoApiKey());

    if (!hasWsKey && !hasGrokKey && !hasOpenAIKey && !hasAIVideoKey) {
      return jsonResponse(event, 503, {
        error: 'No video generation API keys configured',
        detail: 'Set AIVIDEOAPI_API_KEY, OPENAI_API_KEY, WAVESPEED_API_KEY, and/or XAI_API_KEY in Netlify environment variables (Deploy + Preview).',
        model: videoModel
      });
    }

    try {
      let finalPrompt = prompt;

      // Always do the final vision polish if we have refs + Grok key (intelligence layer is shared)
      if (character_image_url && isSafeUrl(character_image_url) && hasGrokKey) {
        try {
          const polishSys = UNTRUSTED_RULE + ' You are the final prompt polish pass for a film. Rewrite the draft to match the reference image visually. Output only the improved prompt text (max ~280 tokens).';
          const polishPayload = { text: wrapUserContent('draft', sanitizeField(prompt, 2000) + '\nShot key: ' + sanitizeField(shotKey || '', 200)), images: [{url: character_image_url}] };
          const polish = await callGrok(polishSys, polishPayload);
          if (polish && polish.output && polish.output.length > 30) finalPrompt = polish.output.trim();
        } catch (e) { /* non-fatal */ }
      }

      const isGrokImagineVideo = videoModel === 'grok-imagine' || videoModel.includes('grok-imagine');
      const wantsOpenAI = body.provider === 'openai';
      const wantsAIVideo = body.provider === 'aivideoapi' || (!wantsOpenAI && isSoraModel(videoModel));
      const isSoraAIVideo = isSoraModel(videoModel) && hasAIVideoKey && wantsAIVideo;
      const isSoraDirect = isSoraModel(videoModel) && hasOpenAIKey && wantsOpenAI;
      if (isSoraModel(videoModel) && wantsOpenAI && !hasOpenAIKey) {
        return jsonResponse(event, 503, {
          error: 'OpenAI Sora not configured on server',
          detail: 'No OpenAI key in Netlify env or Firebase. Owner: POST {action:"set_openai_key",api_key:"sk-..."} or set OPENAI_API_KEY in Netlify (Functions scope) and redeploy.',
          model: videoModel,
          provider: 'openai',
          openai: false,
          aivideoapi: hasAIVideoKey,
          wavespeed: hasWsKey,
        });
      }
      if (isSoraModel(videoModel) && wantsAIVideo && !hasAIVideoKey && !hasOpenAIKey && !hasWsKey) {
        return jsonResponse(event, 503, {
          error: 'Sora 2 not configured on server',
          detail: 'No aivideoapi key. Owner: POST {action:"set_aivideoapi_key",api_key:"sk-..."} with key from https://aivideoapi.ai/api-keys',
          model: videoModel,
          provider: 'aivideoapi',
          aivideoapi: false,
          wavespeed: hasWsKey,
        });
      }
      if (isGrokImagineVideo && hasGrokKey) {
        // Direct XAI Grok Imagine for video (exact "Grok Imagine (done through XAI API)" per user list)
        const grokRes = await submitGrokImagineVideo({
          prompt: finalPrompt,
          duration,
          aspect_ratio,
          character_image_url,
          resolution: body.resolution
        });
        return jsonResponse(event, 200, {
          ...grokRes,
          model: videoModel,
          note: 'Direct via XAI Grok Imagine'
        });
      } else if (isSoraAIVideo) {
        const refUrl = pickRefImageUrl({ character_image_url, reference_images: body.reference_images });
        const avRes = await submitAIVideoAPISora({
          prompt: finalPrompt,
          duration,
          aspect_ratio,
          character_image_url: refUrl || character_image_url,
        });
        return jsonResponse(event, 200, {
          ...avRes,
          model: videoModel,
          note: 'Sora 2 via aivideoapi.ai (AIVIDEOAPI_API_KEY)',
        });
      } else if (isSoraDirect) {
        const refUrl = pickRefImageUrl({ character_image_url, reference_images: body.reference_images });
        const openaiRes = await submitOpenAIVideo({
          prompt: finalPrompt,
          duration,
          aspect_ratio,
          character_image_url: refUrl || character_image_url,
          model: videoModel,
          resolution: body.resolution,
        });
        return jsonResponse(event, 200, {
          ...openaiRes,
          model: videoModel,
          note: 'Direct via OpenAI Sora API (OPENAI_API_KEY)',
        });
      } else {
        // WaveSpeed for all other video models (Seedance 2.0 Turbo, Wan 2.7, Sora 2, Veo 3.1, Kling 3.0 Pro, etc.)
        // User-selected resolution/duration/aspect/refs forwarded as-is (no client pre-filtering).
        const refUrl = pickRefImageUrl({ character_image_url, reference_images: body.reference_images });
        const hasRef = !!refUrl;
        const wsPath = '/api/v3/' + getWaveSpeedPath(videoModel, hasRef);
        const wavespeedBody = buildWaveSpeedBody(videoModel, {
          prompt: finalPrompt,
          duration,
          aspect_ratio,
          resolution: body.resolution,
          character_image_url: refUrl || character_image_url,
          reference_images: body.reference_images,
          shotKey,
          location,
          negative_prompt: body.negative_prompt,
        }, hasRef);
        const result = await callWaveSpeed(wsPath, wavespeedBody);
        const rid = (result.data && result.data.id) || result.id || result.request_id || null;
        const apiOk = result && result.httpStatus < 400 && (!result.code || result.code === 200) && rid;
        if (!apiOk) {
          const detail = humanizeWaveSpeedError(result);
          return jsonResponse(event, 502, {
            error: 'WaveSpeed submit failed for model ' + videoModel,
            detail,
            provider: 'wavespeed',
            raw: result
          });
        }
        const st = normalizeWaveSpeedStatus((result.data && result.data.status) || result.status || 'created');
        return jsonResponse(event, 200, {
          request_id: rid,
          status: st,
          model: videoModel,
          provider: 'wavespeed',
          fallback: isSoraModel(videoModel) && !hasAIVideoKey && !hasOpenAIKey ? 'No aivideoapi/OpenAI key — routed sora-2 via WaveSpeed' : undefined,
          raw: result
        });
      }
    } catch (err) {
      let detail = err.message || String(err);
      if (isSoraModel(videoModel)) {
        if (await resolveAIVideoApiKey()) detail = humanizeAIVideoAPIError(err);
        else if (await getOpenAIApiKey()) detail = humanizeOpenAIError(err);
      }
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'Video submit failed for model ' + videoModel, detail })
      };
    }
  }

  if (action === 'status' && request_id) {
    const isGrokJob = isGrokVideoJob(request_id, body.provider, body.model || model);
    const isOpenAIJob = isOpenAIVideoJob(request_id, body.provider);
    const isAVJob = isAIVideoAPIJob(request_id, body.provider);
    if (request_id.includes('demo_')) {
      const prov = isGrokJob ? 'grok-imagine' : (isAVJob ? 'aivideoapi' : (isOpenAIJob ? 'openai' : 'wavespeed'));
      return jsonResponse(event, 400, { request_id, status: 'FAILED', error: 'Demo job id — configure API keys and resubmit', provider: prov });
    }
    if (isGrokJob && !(process.env.XAI_API_KEY || process.env.GROK_API_KEY)) {
      return jsonResponse(event, 503, { request_id, status: 'FAILED', error: 'XAI_API_KEY not configured', provider: 'grok-imagine' });
    }
    if (isOpenAIJob && !(await getOpenAIApiKey())) {
      return jsonResponse(event, 503, { request_id, status: 'FAILED', error: 'OPENAI_API_KEY not configured', provider: 'openai' });
    }
    if (isAVJob && !(await resolveAIVideoApiKey())) {
      return jsonResponse(event, 503, { request_id, status: 'FAILED', error: 'AIVIDEOAPI_API_KEY not configured', provider: 'aivideoapi' });
    }
    if (!isGrokJob && !isOpenAIJob && !isAVJob && !process.env.WAVESPEED_API_KEY) {
      return jsonResponse(event, 503, { request_id, status: 'FAILED', error: 'WAVESPEED_API_KEY not configured', provider: 'wavespeed' });
    }
    if (!isGrokJob && !isOpenAIJob && !isAVJob && isFakeWaveSpeedId(request_id)) {
      return jsonResponse(event, 400, { request_id, status: 'FAILED', error: 'Invalid WaveSpeed job id — submit did not reach WaveSpeed', provider: 'wavespeed' });
    }
    try {
      if (isGrokJob) {
        const r = await getGrokImagineVideoStatus(request_id);
        return jsonResponse(event, 200, r);
      } else if (isAVJob) {
        const r = await getAIVideoAPITaskStatus(request_id);
        return jsonResponse(event, 200, r);
      } else if (isOpenAIJob) {
        const r = await getOpenAIVideoStatus(request_id);
        return jsonResponse(event, 200, r);
      } else {
        const result = await fetchWaveSpeedPrediction(request_id);
        const rawSt = (result.data && result.data.status) || result.status || 'processing';
        const st = normalizeWaveSpeedStatus(rawSt);
        const out = extractWaveSpeedOutput(result);
        return jsonResponse(event, 200, {
          request_id,
          status: st,
          video_url: out || null,
          provider: 'wavespeed',
          raw: result
        });
      }
    } catch (err) {
      return jsonResponse(event, 500, { error: err.message });
    }
  }

  if (action === 'cancel' && request_id) {
    const isGrokJob = request_id.startsWith('grok_');
    const isOpenAIJob = isOpenAIVideoJob(request_id, body.provider);
    const isAVJob = isAIVideoAPIJob(request_id, body.provider);
    let providerNote = 'Client polling stopped; provider job may still finish on their side.';
    if (!isGrokJob && !isOpenAIJob && process.env.WAVESPEED_API_KEY && !isFakeWaveSpeedId(request_id)) {
      try {
        const cancelPaths = [
          '/api/v3/predictions/' + request_id + '/cancel',
          '/api/v3/predictions/' + request_id,
        ];
        for (const path of cancelPaths) {
          const res = await callWaveSpeed(path, null, 'DELETE');
          if (res && res.httpStatus && res.httpStatus < 500) {
            providerNote = 'Best-effort WaveSpeed cancel sent.';
            break;
          }
        }
      } catch (e) {
        providerNote = 'Client cancelled; WaveSpeed cancel not confirmed.';
      }
    }
    return jsonResponse(event, 200, {
      request_id,
      status: 'CANCELLED',
      provider: isGrokJob ? 'grok-imagine' : (isAVJob ? 'aivideoapi' : (isOpenAIJob ? 'openai' : 'wavespeed')),
      note: providerNote,
    });
  }

  if (action === 'result' && request_id) {
    const isGrokJob = isGrokVideoJob(request_id, body.provider, body.model || model);
    const isOpenAIJob = isOpenAIVideoJob(request_id, body.provider);
    const isAVJob = isAIVideoAPIJob(request_id, body.provider);
    if (request_id.includes('demo_')) {
      const prov = isGrokJob ? 'grok-imagine' : (isAVJob ? 'aivideoapi' : (isOpenAIJob ? 'openai' : 'wavespeed'));
      return jsonResponse(event, 400, { request_id, status: 'FAILED', error: 'Demo job id — configure API keys and resubmit', provider: prov });
    }
    if (isGrokJob && !(process.env.XAI_API_KEY || process.env.GROK_API_KEY)) {
      return jsonResponse(event, 503, { request_id, status: 'FAILED', error: 'XAI_API_KEY not configured', provider: 'grok-imagine' });
    }
    if (isOpenAIJob && !(await getOpenAIApiKey())) {
      return jsonResponse(event, 503, { request_id, status: 'FAILED', error: 'OPENAI_API_KEY not configured', provider: 'openai' });
    }
    if (isAVJob && !(await resolveAIVideoApiKey())) {
      return jsonResponse(event, 503, { request_id, status: 'FAILED', error: 'AIVIDEOAPI_API_KEY not configured', provider: 'aivideoapi' });
    }
    if (!isGrokJob && !isOpenAIJob && !isAVJob && !process.env.WAVESPEED_API_KEY) {
      return jsonResponse(event, 503, { request_id, status: 'FAILED', error: 'WAVESPEED_API_KEY not configured', provider: 'wavespeed' });
    }
    if (!isGrokJob && !isOpenAIJob && !isAVJob && isFakeWaveSpeedId(request_id)) {
      return jsonResponse(event, 400, { request_id, status: 'FAILED', error: 'Invalid WaveSpeed job id — submit did not reach WaveSpeed', provider: 'wavespeed' });
    }
    try {
      if (isGrokJob) {
        const r = await getGrokImagineVideoResult(request_id);
        return jsonResponse(event, 200, r);
      } else if (isAVJob) {
        const r = await getAIVideoAPITaskResult(request_id);
        return jsonResponse(event, 200, r);
      } else if (isOpenAIJob) {
        const r = await getOpenAIVideoResult(request_id, event);
        return jsonResponse(event, 200, r);
      } else {
        const result = await fetchWaveSpeedPrediction(request_id);
        const rawSt = (result.data && result.data.status) || result.status || 'processing';
        const st = normalizeWaveSpeedStatus(rawSt);
        const out = extractWaveSpeedOutput(result);
        return jsonResponse(event, 200, { request_id, video_url: out, status: st, provider: 'wavespeed', raw: result });
      }
    } catch (err) {
      return jsonResponse(event, 500, { error: err.message });
    }
  }

  return {
    statusCode: 400,
    headers: CORS,
    body: JSON.stringify({ error: 'Unknown action or missing params' })
  };
};
