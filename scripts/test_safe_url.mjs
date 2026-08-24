/* An address has more than one spelling. Each of these reaches loopback,
 * link-local or a private network, and every one of them passed the previous
 * string-matching version of isSafeUrl.
 *
 * Run: node scripts/test_safe_url.mjs
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { isSafeUrl, filterSafeUrls } = require_('/home/user/shotb/netlify/functions/lib/safe-url.js');

let pass = 0, fail = 0;
const blocked = (label, url) => {
  if (isSafeUrl(url) === false) pass++;
  else { fail++; console.log(`  x ALLOWED ${label}: ${url}`); }
};
const allowed = (label, url) => {
  if (isSafeUrl(url) === true) pass++;
  else { fail++; console.log(`  x BLOCKED ${label}: ${url}`); }
};
const t = (label, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`  x ${label}${detail ? ': ' + detail : ''}`); }
};

/* ── the spellings the old regex could not see ── */
blocked('IPv6 loopback', 'https://[::1]/x');
blocked('IPv6 unspecified', 'https://[::]/x');
blocked('IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/x');
blocked('IPv4-mapped IPv6 private', 'https://[::ffff:10.0.0.1]/x');
blocked('IPv6 link-local', 'https://[fe80::1]/x');
blocked('IPv6 link-local with zone', 'https://[fe80::1%25eth0]/x');
blocked('IPv6 unique-local', 'https://[fd00::1]/x');
blocked('IPv6 multicast', 'https://[ff02::1]/x');
blocked('127.0.0.1 as one decimal', 'https://2130706433/x');
blocked('127.0.0.1 in octal', 'https://0177.0.0.1/x');
blocked('127.0.0.1 in hex', 'https://0x7f.0.0.1/x');
blocked('127.0.0.1 as a.b form', 'https://127.1/x');
blocked('trailing dot on loopback', 'https://127.0.0.1./x');
blocked('carrier-grade NAT', 'https://100.64.0.1/x');
blocked('benchmarking range', 'https://198.18.0.1/x');
blocked('this-network 0.x', 'https://0.0.0.0/x');
blocked('multicast', 'https://224.0.0.1/x');

/* ── the ones it did catch, still caught ── */
blocked('localhost by name', 'https://localhost/x');
blocked('loopback dotted quad', 'https://127.0.0.1/x');
blocked('cloud metadata', 'https://169.254.169.254/latest/meta-data/');
blocked('google metadata by name', 'https://metadata.google.internal/x');
blocked('RFC1918 10/8', 'https://10.1.2.3/x');
blocked('RFC1918 172.16/12', 'https://172.20.0.1/x');
blocked('RFC1918 192.168/16', 'https://192.168.0.1/x');
blocked('.local', 'https://nas.local/x');
blocked('.internal', 'https://vault.internal/x');
blocked('trailing dot on .internal', 'https://vault.internal./x');
blocked('bare intranet label', 'https://fileserver/x');

/* ── scheme handling ── */
blocked('plain http', 'http://example.com/x');
blocked('javascript', 'javascript:alert(1)');
blocked('file', 'file:///etc/passwd');
blocked('empty', '');
blocked('not a string', null);
blocked('non-image data URL', 'data:text/html,<script>alert(1)</script>');

/* ── real URLs must still work ── */
allowed('a poster host', 'https://image.tmdb.org/t/p/w500/abc.jpg');
allowed('wikimedia', 'https://upload.wikimedia.org/a/b.png');
allowed('public IPv4 literal', 'https://8.8.8.8/x');
allowed('public IPv6 literal', 'https://[2001:4860:4860::8888]/x');
allowed('IPv4-mapped public', 'https://[::ffff:8.8.8.8]/x');
t('a small image data URL is allowed', isSafeUrl('data:image/png;base64,AAAA'));
t('an oversized data URL is refused',
  isSafeUrl('data:image/png;base64,' + 'A'.repeat(7 * 1024 * 1024)) === false);

/* ── filterSafeUrls must not carry sibling fields through ── */
{
  const out = filterSafeUrls([
    { url: 'https://image.tmdb.org/a.jpg', onerror: 'alert(1)', name: '<img src=x>' },
    { url: 'https://127.0.0.1/secret', keep: 'no' },
    'https://upload.wikimedia.org/b.png',
    { url: 'not a url' },
    null,
  ]);
  t('only safe entries survive', out.length === 2, JSON.stringify(out));
  t('the loopback entry is gone', !out.some((o) => /127\.0\.0\.1/.test(o.url)));
  t('sibling fields are dropped',
    out.every((o) => Object.keys(o).length === 1 && 'url' in o), JSON.stringify(out));
}

console.log(`test_safe_url: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
