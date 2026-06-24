const https = require('https');
const crypto = require('crypto');
const { firstEnv } = require('./env');
const { resolveOpenAIApiKey } = require('./server-secrets');

const OPENAI_VIDEO_MAX_DATA_URL_BYTES = 2.5 * 1024 * 1024;

async function getOpenAIApiKey() {
  return resolveOpenAIApiKey();
}

async function callOpenAI(path, payload, method = 'POST') {
  const key = await getOpenAIApiKey();
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  return new Promise((resolve, reject) => {
    const isGet = method.toUpperCase() === 'GET';
    const headers = { Authorization: 'Bearer ' + key };
    let data = null;
    if (!isGet && payload !== undefined && payload !== null) {
      data = Buffer.from(JSON.stringify(payload), 'utf8');
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }

    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: path.startsWith('/') ? path : '/' + path,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          let msg = body;
          try {
            const json = JSON.parse(body);
            msg = (json.error && (json.error.message || json.error.code)) || json.message || body;
          } catch (e) { /* raw body */ }
          reject(new Error('OpenAI API ' + res.statusCode + ': ' + msg));
          return;
        }
        if (!body) {
          resolve({ httpStatus: res.statusCode });
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body, httpStatus: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function downloadOpenAIVideoContent(videoId) {
  const key = await getOpenAIApiKey();
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/videos/' + encodeURIComponent(videoId) + '/content',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + key },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error('OpenAI video content ' + res.statusCode));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function normalizeOpenAIVideoStatus(st) {
  const s = String(st || '').toLowerCase();
  if (s === 'completed') return 'COMPLETED';
  if (s === 'failed') return 'FAILED';
  if (s === 'queued' || s === 'in_progress' || s === 'processing') return 'PROCESSING';
  return 'PROCESSING';
}

function isOpenAIVideoJob(request_id, provider) {
  if (provider === 'openai') return true;
  if (request_id && String(request_id).startsWith('video_')) return true;
  return false;
}

function clampOpenAISeconds(d) {
  const allowed = [4, 8, 12];
  const n = Number(d) || 4;
  if (allowed.includes(n)) return String(n);
  const best = allowed.reduce((pick, v) => (Math.abs(v - n) < Math.abs(pick - n) ? v : pick), 4);
  return String(best);
}

function openAISizeFromAspect(ar, model, resolution) {
  const isPro = openAIModelId(model) === 'sora-2-pro';
  const hi = resolution === '1080p' || isPro;
  if (ar === '9:16') return hi ? '1024x1792' : '720x1280';
  return hi ? '1792x1024' : '1280x720';
}

function openAIModelId(modelId) {
  const m = String(modelId || 'sora-2').toLowerCase();
  if (m.includes('pro')) return 'sora-2-pro';
  return 'sora-2';
}

function humanizeOpenAIError(err) {
  const blob = String(err && err.message ? err.message : err || '').toLowerCase();
  if (/insufficient|quota|billing|payment|funds|credit|rate limit/.test(blob)) {
    return 'OpenAI API credits or quota exhausted. Check billing at platform.openai.com.';
  }
  if (/unauthorized|invalid.*key|api key|forbidden|access denied|401/.test(blob)) {
    return 'OpenAI rejected the API key (401). Create a new key at platform.openai.com/api-keys, then run fix-openai-sora.ps1 or set_openai_key.';
  }
  return String(err && err.message ? err.message : err || 'OpenAI video request failed');
}

async function signOpenAIStreamUrl(videoId, event) {
  const exp = Date.now() + 3600000;
  const secret = (await getOpenAIApiKey()) || firstEnv(['NETLIFY_SITE_ID']) || 'shotbreak';
  const sig = crypto.createHmac('sha256', secret).update(videoId + '|' + exp).digest('hex');
  const host = (event && event.headers && (event.headers.host || event.headers.Host)) || 'shotbreak.io';
  const proto = (event && event.headers && event.headers['x-forwarded-proto']) || 'https';
  return proto + '://' + host + '/.netlify/functions/serve-openai-video?vid=' + encodeURIComponent(videoId) + '&exp=' + exp + '&sig=' + sig;
}

async function verifyOpenAIStreamSig(videoId, exp, sig) {
  if (!videoId || !exp || !sig) return false;
  if (Date.now() > Number(exp)) return false;
  const secret = (await getOpenAIApiKey()) || firstEnv(['NETLIFY_SITE_ID']) || 'shotbreak';
  const expected = crypto.createHmac('sha256', secret).update(videoId + '|' + exp).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

async function bufferToVideoDeliveryUrl(buf, videoId, event) {
  if (!buf || !buf.length) return null;
  if (buf.length <= OPENAI_VIDEO_MAX_DATA_URL_BYTES) {
    return 'data:video/mp4;base64,' + buf.toString('base64');
  }
  return signOpenAIStreamUrl(videoId, event);
}

async function submitOpenAIVideo({ prompt, duration, aspect_ratio, character_image_url, model, resolution }) {
  const payload = {
    model: openAIModelId(model),
    prompt,
    seconds: clampOpenAISeconds(duration),
    size: openAISizeFromAspect(aspect_ratio, model, resolution),
  };
  if (character_image_url) {
    payload.input_reference = { image_url: character_image_url };
  }

  const res = await callOpenAI('/v1/videos', payload, 'POST');
  const rid = res.id;
  if (!rid) throw new Error('OpenAI video submit returned no id');
  return {
    request_id: rid,
    status: normalizeOpenAIVideoStatus(res.status || 'queued'),
    provider: 'openai',
    raw: res,
  };
}

async function getOpenAIVideoStatus(request_id) {
  const res = await callOpenAI('/v1/videos/' + encodeURIComponent(request_id), null, 'GET');
  const st = normalizeOpenAIVideoStatus(res.status);
  if (st === 'FAILED') {
    const errMsg = (res.error && (res.error.message || res.error.code)) || 'OpenAI video failed';
    return { request_id, status: st, error: errMsg, provider: 'openai', raw: res };
  }
  return {
    request_id,
    status: st,
    progress: res.progress,
    provider: 'openai',
    raw: res,
  };
}

async function getOpenAIVideoResult(request_id, event) {
  const res = await callOpenAI('/v1/videos/' + encodeURIComponent(request_id), null, 'GET');
  const st = normalizeOpenAIVideoStatus(res.status);
  if (st === 'FAILED') {
    const errMsg = (res.error && (res.error.message || res.error.code)) || 'OpenAI video generation failed';
    return { request_id, video_url: null, status: st, error: errMsg, provider: 'openai', raw: res };
  }
  if (st !== 'COMPLETED') {
    return { request_id, video_url: null, status: st, provider: 'openai', raw: res };
  }
  const buf = await downloadOpenAIVideoContent(request_id);
  const video_url = await bufferToVideoDeliveryUrl(buf, request_id, event);
  return { request_id, video_url, status: st, provider: 'openai', raw: res };
}

module.exports = {
  getOpenAIApiKey,
  callOpenAI,
  downloadOpenAIVideoContent,
  normalizeOpenAIVideoStatus,
  isOpenAIVideoJob,
  clampOpenAISeconds,
  openAISizeFromAspect,
  openAIModelId,
  humanizeOpenAIError,
  signOpenAIStreamUrl,
  verifyOpenAIStreamSig,
  bufferToVideoDeliveryUrl,
  submitOpenAIVideo,
  getOpenAIVideoStatus,
  getOpenAIVideoResult,
  OPENAI_VIDEO_MAX_DATA_URL_BYTES,
};