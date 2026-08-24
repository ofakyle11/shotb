/* The sign-in page must never bounce an owner off-site after they authenticate.
 *
 * Two real bypasses have been found here, both of which looked safe:
 *   "/\evil.com"    — browsers normalise the backslash to a slash
 *   "/..//evil.com" — resolves against our own origin (so an origin check on the
 *                     RESOLVED url passes) but leaves "//evil.com" as the
 *                     pathname, which location.replace() then treats as
 *                     protocol-relative and jumps off-site
 * Both are covered below. Run: node scripts/test_login_redirect.mjs
 */
import { readFileSync } from 'fs';

const ORIGIN = 'https://cinamate-studio.netlify.app';
const src = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
const fnSrc = src.match(/function dest\(\) \{[\s\S]*?\n  \}/)?.[0];
if (!fnSrc) {
  console.error('test_login_redirect: could not find dest() in login.html');
  process.exit(1);
}

/* Rebuild dest() with a controllable query string and a stubbed `location`. */
function dest(to) {
  const body = fnSrc
    .replace('function dest()', 'function ()')
    .replace('location.search', JSON.stringify('?to=' + encodeURIComponent(to)))
    .replaceAll('location.origin', JSON.stringify(ORIGIN));
  // eslint-disable-next-line no-eval
  return eval('(' + body + ')')();
}

/* Resolve the returned value the way the browser will, and report the origin. */
function resolvesTo(value) {
  try { return new URL(value, ORIGIN).origin; } catch { return 'parse-error'; }
}

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.log('  x ' + name)); };

const OFFSITE_ATTEMPTS = [
  '//evil.com',
  '/\\evil.com',
  '/\\/evil.com',
  'https://evil.com',
  'http://evil.com',
  'javascript:alert(1)',
  '/..//evil.com',
  '/..///evil.com',
  '/../..//evil.com',
  '/a/../..//evil.com',
  '/..//evil.com/path',
  '/%2e%2e//evil.com',
  '/..//..//evil.com',
  '/\r\n//evil.com',
  '/\t//evil.com',
];

for (const attempt of OFFSITE_ATTEMPTS) {
  const got = dest(attempt);
  t(`blocked: ${JSON.stringify(attempt)} (returned ${JSON.stringify(got)})`,
    resolvesTo(got) === ORIGIN);
}

/* Legitimate destinations must survive untouched — a guard that breaks real
   navigation would just get removed by the next person. */
t('plain path preserved', dest('/dashboard.html') === '/dashboard.html');
t('module path preserved', dest('/music/') === '/music/');
t('query and hash preserved', dest('/today/?d=2#call') === '/today/?d=2#call');
t('deep path preserved', dest('/producer/#sales') === '/producer/#sales');
t('no target falls back home', dest('') === '/dashboard.html');

/* Whatever comes back must always be a single-slash absolute path. */
for (const attempt of [...OFFSITE_ATTEMPTS, '/dashboard.html', '/music/']) {
  const got = String(dest(attempt));
  t(`single-slash absolute path for ${JSON.stringify(attempt)}`,
    got.startsWith('/') && !got.startsWith('//'));
}

console.log(`test_login_redirect: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
