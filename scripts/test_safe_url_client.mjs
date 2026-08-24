/* Every href and src in this app was built with esc(), which HTML-escapes.
 * That does nothing to "javascript:alert(1)" — it contains no < > " or ' — and
 * the app's CSP carries 'unsafe-inline', which is exactly when a browser will
 * run a javascript: URL. So a link built from a hostile value executed script
 * in the owner's session, and escaping it never helped.
 *
 * js/safe-url.js is the check that belongs at that sink. This attacks it.
 *
 * Run: node scripts/test_safe_url_client.mjs
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const CinUrl = require_('/home/user/shotb/js/safe-url.js');

let pass = 0, fail = 0;
const blocked = (label, url) => {
  const out = CinUrl.safe(url);
  if (out === '') pass++;
  else { fail++; console.log(`  x ALLOWED ${label}: ${JSON.stringify(url)} -> ${JSON.stringify(out)}`); }
};
const allowed = (label, url) => {
  const out = CinUrl.safe(url);
  if (out !== '') pass++;
  else { fail++; console.log(`  x BLOCKED ${label}: ${JSON.stringify(url)}`); }
};
const t = (label, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`  x ${label}${detail !== undefined ? ': ' + detail : ''}`); }
};

/* ── the thing esc() could never stop ── */
blocked('plain javascript:', 'javascript:alert(1)');
blocked('uppercase', 'JavaScript:alert(1)');
blocked('mixed case', 'JaVaScRiPt:alert(1)');
blocked('leading spaces', '   javascript:alert(1)');
blocked('leading newline', '\njavascript:alert(1)');
blocked('tab inside the scheme', 'java\tscript:alert(1)');
blocked('newline inside the scheme', 'java\nscript:alert(1)');
blocked('NUL inside the scheme', 'java\u0000script:alert(1)');
blocked('carriage return inside', 'java\rscript:alert(1)');
blocked('zero-width space inside', 'java\u200bscript:alert(1)');
blocked('BOM inside', 'java\ufeffscript:alert(1)');
blocked('non-breaking space before', '\u00a0javascript:alert(1)');
blocked('vbscript', 'vbscript:msgbox(1)');
blocked('livescript', 'livescript:alert(1)');
blocked('mocha', 'mocha:alert(1)');
blocked('file', 'file:///C:/Users/operator/.ssh/id_rsa');
blocked('about:blank', 'about:blank');
blocked('view-source', 'view-source:https://example.com');
blocked('filesystem', 'filesystem:https://evil.example/temporary/x');
blocked('data html', 'data:text/html,<script>alert(1)</script>');
blocked('data html base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==');
blocked('data svg', 'data:image/svg+xml,<svg onload=alert(1)>');
blocked('data svg base64', 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+');

/* ── attribute breakout ── */
blocked('double quote breakout', 'https://x.example/" onmouseover="alert(1)');
blocked('single quote breakout', "https://x.example/' onmouseover='alert(1)");
blocked('angle bracket', 'https://x.example/<script>');
blocked('backtick', 'https://x.example/`alert(1)`');

/* ── protocol-relative and junk ── */
blocked('protocol-relative', '//evil.example/x');
blocked('backslash protocol-relative', '\\\\evil.example/x');
blocked('a bare word', 'evil.example');
blocked('empty', '');
blocked('whitespace only', '   ');
blocked('null', null);
blocked('undefined', undefined);
blocked('only control characters', '\u0000\u0001\u0002');
blocked('an unknown scheme', 'gopher://x.example/1');
blocked('intent scheme', 'intent://evil#Intent;scheme=http;end');

/* ── the app's real URLs must survive ── */
allowed('an https link', 'https://image.tmdb.org/t/p/w500/abc.jpg');
allowed('an http link', 'http://example.com/page');
allowed('our own absolute path', '/timeline/');
allowed('our own file', '/assets/logo.svg');
allowed('a relative path', './poster.png');
allowed('a parent path', '../shot.jpg');
allowed('an in-page anchor', '#scene-4');
allowed('a mailto', 'mailto:producer@example.com');
allowed('a tel link', 'tel:+14165550123');
allowed('a bridge blob', 'blob:https://cinamate-studio.netlify.app/8e2f-abc');
allowed('a base64 png', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
allowed('a base64 jpeg', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
allowed('a base64 mp4', 'data:video/mp4;base64,AAAAIGZ0eXBpc29t');

/* ── output must be attribute-safe, and must not double-encode ── */
{
  const out = CinUrl.safe('https://x.example/a?b=1&c=2');
  t('an ampersand is encoded once', out === 'https://x.example/a?b=1&amp;c=2', out);
  t('a clean URL comes back unchanged apart from entities',
    CinUrl.safe('/timeline/') === '/timeline/');
  t('isSafe agrees with safe', CinUrl.isSafe('https://x.example/') === true &&
    CinUrl.isSafe('javascript:alert(1)') === false);
}

/* ── the loopback bridge URLs the Studio really uses ── */
allowed('the bridge media URL', 'http://127.0.0.1:3456/media/i2v5_00002_.mp4');
allowed('the bridge image URL', 'http://localhost:3456/images/up_abc.jpg');

console.log(`test_safe_url_client: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
