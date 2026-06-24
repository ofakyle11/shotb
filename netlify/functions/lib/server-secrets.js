'use strict';

const { firstEnv } = require('./env');
const { fbGet, fbPatch } = require('./firebase-db');

const OPENAI_ENV_NAMES = ['OPENAI_API_KEY', 'SORA_API_KEY', 'OPENAI_KEY'];
const AIVIDEO_ENV_NAMES = ['AIVIDEOAPI_API_KEY', 'AI_VIDEO_API_KEY', 'AIVIDEO_API_KEY'];
const FB_OPENAI_KEY = 'openai_api_key';
const FB_AIVIDEO_KEY = 'aivideoapi_api_key';
const cache = {};

async function readFirebaseSecrets() {
  try {
    return await fbGet('server_secrets') || {};
  } catch (e) {
    return {};
  }
}

async function resolveOpenAIApiKey() {
  const fromEnv = firstEnv(OPENAI_ENV_NAMES);
  if (fromEnv) return fromEnv;
  if (cache[FB_OPENAI_KEY]) return cache[FB_OPENAI_KEY];
  const row = await readFirebaseSecrets();
  const fromDb = row[FB_OPENAI_KEY];
  if (fromDb && typeof fromDb === 'string' && fromDb.trim()) {
    cache[FB_OPENAI_KEY] = fromDb.trim();
    return cache[FB_OPENAI_KEY];
  }
  return '';
}

async function resolveAIVideoApiKey() {
  const fromEnv = firstEnv(AIVIDEO_ENV_NAMES);
  if (fromEnv) return fromEnv;
  if (cache[FB_AIVIDEO_KEY]) return cache[FB_AIVIDEO_KEY];
  const row = await readFirebaseSecrets();
  let fromDb = row[FB_AIVIDEO_KEY];
  if ((!fromDb || !String(fromDb).trim()) && row[FB_OPENAI_KEY]) {
    fromDb = row[FB_OPENAI_KEY];
  }
  if (fromDb && typeof fromDb === 'string' && fromDb.trim()) {
    cache[FB_AIVIDEO_KEY] = fromDb.trim();
    return cache[FB_AIVIDEO_KEY];
  }
  return '';
}

async function storeOpenAIApiKey(value) {
  const key = String(value || '').trim();
  if (!key) throw new Error('api_key required');
  await fbPatch('server_secrets', {
    [FB_OPENAI_KEY]: key,
    openai_updated_at: new Date().toISOString(),
  });
  cache[FB_OPENAI_KEY] = key;
  return true;
}

async function storeAIVideoApiKey(value) {
  const key = String(value || '').trim();
  if (!key) throw new Error('api_key required');
  await fbPatch('server_secrets', {
    [FB_AIVIDEO_KEY]: key,
    aivideoapi_updated_at: new Date().toISOString(),
  });
  cache[FB_AIVIDEO_KEY] = key;
  return true;
}

async function providerKeyDiagnostics() {
  const openaiEnv = firstEnv(OPENAI_ENV_NAMES);
  const avEnv = firstEnv(AIVIDEO_ENV_NAMES);
  const row = await readFirebaseSecrets();
  const openaiDb = row[FB_OPENAI_KEY] ? String(row[FB_OPENAI_KEY]).trim() : '';
  const avDb = row[FB_AIVIDEO_KEY] ? String(row[FB_AIVIDEO_KEY]).trim() : '';
  const avResolved = avEnv || avDb || openaiDb || '';
  const openaiResolved = openaiEnv || openaiDb || '';

  return {
    openai: !!openaiResolved,
    openai_key_len: openaiResolved ? openaiResolved.length : 0,
    openai_env: !!openaiEnv,
    openai_firebase: !!openaiDb,
    aivideoapi: !!avResolved,
    aivideoapi_key_len: avResolved ? avResolved.length : 0,
    aivideoapi_env: !!avEnv,
    aivideoapi_firebase: !!(avDb || openaiDb),
    firebase_db_configured: !!require('./firebase-db').dbSecret(),
    sora_provider: avResolved ? 'aivideoapi' : (openaiResolved ? 'openai' : 'wavespeed'),
  };
}

module.exports = {
  resolveOpenAIApiKey,
  resolveAIVideoApiKey,
  storeOpenAIApiKey,
  storeAIVideoApiKey,
  openAIKeyDiagnostics: providerKeyDiagnostics,
  providerKeyDiagnostics,
};