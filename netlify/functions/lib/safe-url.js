'use strict';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
]);

function isPrivateIpv4(host) {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/')) {
    return trimmed.length < 6 * 1024 * 1024;
  }
  if (!trimmed.startsWith('https://')) return false;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return false;
    if (isPrivateIpv4(host)) return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    return true;
  } catch {
    return false;
  }
}

function filterSafeUrls(urls) {
  if (!Array.isArray(urls)) return [];
  return urls.filter((item) => {
    const url = typeof item === 'string' ? item : item && item.url;
    return isSafeUrl(url);
  }).map((item) => {
    if (typeof item === 'string') return { url: item };
    return { ...item, url: item.url };
  });
}

module.exports = { isSafeUrl, filterSafeUrls };