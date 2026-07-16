'use strict';

const ALLOWED_ORIGINS = new Set([
  'https://shotbreak.io',
  'https://www.shotbreak.io',
  'http://localhost:8888',
  'http://localhost:3000',
  'http://127.0.0.1:8888',
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Netlify test/staging deployments (branch deploys, deploy previews, or a
  // separate test site) — the page and functions share the domain there.
  if (/^https:\/\/[a-z0-9-]+(--[a-z0-9-]+)?\.netlify\.app$/.test(origin)) return true;
  return /^http:\/\/localhost(:\d+)?$/.test(origin);
}

function corsHeaders(event) {
  const origin = (event && event.headers && (event.headers.origin || event.headers.Origin)) || '';
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : 'https://shotbreak.io',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function respond(event, statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(event),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function getAuthHeader(event) {
  if (typeof event === 'string') return event;
  if (!event || !event.headers) return '';
  return event.headers.authorization || event.headers.Authorization || '';
}

module.exports = { corsHeaders, respond, getAuthHeader, isAllowedOrigin };