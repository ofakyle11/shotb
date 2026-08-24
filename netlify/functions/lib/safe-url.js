'use strict';

/* Reject URLs that point back into infrastructure rather than out at the web.
 *
 * The previous version checked a five-name block-list and a dotted-quad
 * regex. Both are string tests, and an address has more than one spelling:
 *
 *   https://[::1]/                   IPv6 loopback — the regex sees no dots
 *   https://[::ffff:127.0.0.1]/      IPv4 mapped into IPv6
 *   https://2130706433/              127.0.0.1 as a single decimal
 *   https://0177.0.0.1/              the same address in octal
 *   https://127.0.0.1./              a trailing dot the regex will not match
 *   https://100.64.0.1/              carrier-grade NAT, not RFC1918
 *
 * Every one of those passed. So the shape here is: normalise the host into a
 * canonical address first, and only then decide. A hostname that is not an
 * address at all is allowed — this layer cannot resolve DNS, so callers that
 * fetch must ALSO validate the address they actually connect to.
 */

const BLOCKED_NAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/* Accepts the four spellings inet_aton understands and returns the address as
   four octets, or null if it is not an IPv4 literal at all. */
function toIpv4Octets(host) {
  const parts = host.split('.');
  if (parts.length > 4 || parts.some((p) => p === '')) return null;

  const nums = [];
  for (const p of parts) {
    let n;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isInteger(n) || n < 0) return null;
    nums.push(n);
  }
  /* a, a.b, a.b.c and a.b.c.d all name an address; the final part absorbs the
     remaining octets, which is how 2130706433 spells 127.0.0.1. */
  const last = nums[nums.length - 1];
  const leading = nums.slice(0, -1);
  if (leading.some((n) => n > 255)) return null;
  const room = 4 - leading.length;
  if (last >= Math.pow(256, room)) return null;
  const octets = leading.slice();
  for (let i = room - 1; i >= 0; i--) octets.push((last >> (8 * i)) & 255);
  return octets;
}

function isPrivateIpv4Octets(o) {
  const [a, b] = o;
  if (a === 0) return true;                        // "this network"
  if (a === 10) return true;                       // RFC1918
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;           // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                       // multicast and reserved
  return false;
}

/* Expand a bracketed IPv6 literal to its eight 16-bit groups, or null.
   Working on the expanded groups rather than on the text matters: WHATWG URL
   parsing rewrites the literal, so "[::ffff:127.0.0.1]" arrives here already
   normalised to "[::ffff:7f00:1]" and any check looking for a dotted quad
   sees nothing to check. */
function ipv6Groups(inner) {
  let text = inner;
  /* A trailing dotted quad is the mapped form — fold it into two groups. */
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const o = toIpv4Octets(tail[1]);
    if (!o) return null;
    text = text.slice(0, tail.index) +
      ((o[0] << 8 | o[1]).toString(16)) + ':' + ((o[2] << 8 | o[3]).toString(16));
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (s) => (s === '' ? [] : s.split(':').map((g) => {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return NaN;
    return parseInt(g, 16);
  }));
  const head = parse(halves[0]);
  const tailGroups = halves.length === 2 ? parse(halves[1]) : [];
  if (head.concat(tailGroups).some((n) => !Number.isInteger(n))) return null;

  if (halves.length === 2) {
    const gap = 8 - head.length - tailGroups.length;
    if (gap < 0) return null;
    return head.concat(new Array(gap).fill(0), tailGroups);
  }
  return head.length === 8 ? head : null;
}

function isPrivateIpv6(host) {
  if (!host.startsWith('[') || !host.endsWith(']')) return null;
  let inner = host.slice(1, -1).toLowerCase();
  const zone = inner.indexOf('%');
  if (zone !== -1) inner = inner.slice(0, zone);   // link-local scope id

  const g = ipv6Groups(inner);
  if (!g) return true;                             // unparseable literal — refuse

  /* ::ffff:a.b.c.d and the deprecated ::a.b.c.d both carry an IPv4 address in
     the last two groups; whether they are safe is an IPv4 question. */
  const zeroHead = g.slice(0, 5).every((n) => n === 0);
  if (zeroHead && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
    if (g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
    return isPrivateIpv4Octets(v4);
  }
  const first = g[0];
  if ((first & 0xffc0) === 0xfe80) return true;    // link-local fe80::/10
  if ((first & 0xfe00) === 0xfc00) return true;    // unique local fc00::/7
  if ((first & 0xff00) === 0xff00) return true;    // multicast ff00::/8
  return false;
}

function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/')) {
    return trimmed.length < 6 * 1024 * 1024;
  }
  if (!/^https:\/\//i.test(trimmed)) return false;
  let u;
  try { u = new URL(trimmed); } catch { return false; }

  /* A trailing dot is the same name to a resolver and a different string to a
     comparison, so it comes off before anything is compared. */
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return false;

  const v6 = isPrivateIpv6(host);
  if (v6 !== null) return !v6;

  const octets = toIpv4Octets(host);
  if (octets) return !isPrivateIpv4Octets(octets);

  if (BLOCKED_NAMES.has(host)) return false;
  if (/(^|\.)(local|internal|localdomain|home\.arpa)$/.test(host)) return false;
  if (!host.includes('.')) return false;           // a bare label is an intranet name
  return true;
}

/* Only the URL survives. The previous version did `{ ...item, url: item.url }`,
   which carried every sibling field of an attacker-supplied object through the
   filter untouched — a function named "filterSafeUrls" handing back unfiltered
   data is exactly the kind of thing callers stop checking. */
function filterSafeUrls(urls) {
  if (!Array.isArray(urls)) return [];
  const out = [];
  for (const item of urls) {
    const url = typeof item === 'string' ? item : (item && item.url);
    if (isSafeUrl(url)) out.push({ url: String(url).trim() });
  }
  return out;
}

module.exports = { isSafeUrl, filterSafeUrls };
