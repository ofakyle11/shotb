#!/usr/bin/env node
/* Node tests for netlify/functions/gate.js — run: node scripts/test_gate.mjs */
import { createHmac } from 'crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

/* Stage: gate.js next to a fake protected site tree, exactly as the bundle. */
const stage = mkdtempSync(join(tmpdir(), 'gate-test-'));
cpSync(join(ROOT, 'netlify/functions/gate.js'), join(stage, 'gate.js'));
mkdirSync(join(stage, 'site/timeline'), { recursive: true });
mkdirSync(join(stage, 'site/js'), { recursive: true });
writeFileSync(join(stage, 'site/timeline/index.html'), '<html>STUDIO SECRET</html>');
writeFileSync(join(stage, 'site/js/learn.js'), 'window.CLearn={secret:1}');
writeFileSync(join(stage, 'site/dashboard.html'), '<html>DASH SECRET</html>');

const SECRET = 'test-secret-abc';
process.env.OWNER_TOKEN_SECRET = SECRET;
const { handler } = require_(join(stage, 'gate.js'));

function mint(name, expires) {
  const payload = `owner:${name}:${expires}`;
  return payload + ':' + createHmac('sha256', SECRET).update(payload).digest('hex');
}
function ev(path, cookie) {
  return { rawUrl: 'https://x.example' + path,
           headers: cookie ? { cookie: 'other=1; cin_owner=' + encodeURIComponent(cookie) } : {} };
}
const good = mint('hz465', Date.now() + 3600000);

/* anonymous */
let r = await handler(ev('/timeline/'));
t('anon page → 302 to login with target', r.statusCode === 302 && /\/login\.html\?to=%2Ftimeline%2F/.test(r.headers.Location));
r = await handler(ev('/js/learn.js'));
t('anon asset → 401, no content', r.statusCode === 401 && !/CLearn/.test(r.body));
t('anon never gets file bytes', !/STUDIO SECRET/.test(JSON.stringify(await handler(ev('/timeline/')))));

/* broken credentials */
r = await handler(ev('/dashboard.html', good.slice(0, -4) + 'beef'));
t('tampered hmac → 302', r.statusCode === 302);
r = await handler(ev('/dashboard.html', mint('hz465', Date.now() - 1000)));
t('expired token → 302', r.statusCode === 302);
const wrongSecret = 'owner:hz465:' + (Date.now() + 3600000);
r = await handler(ev('/dashboard.html', wrongSecret + ':' + createHmac('sha256', 'other').update(wrongSecret).digest('hex')));
t('wrong secret → 302', r.statusCode === 302);
r = await handler(ev('/dashboard.html', mint('intruder', Date.now() + 3600000)));
t('unknown owner name → 302', r.statusCode === 302);

/* authenticated */
r = await handler(ev('/timeline/', good));
t('authed dir → 200 index.html', r.statusCode === 200 && /STUDIO SECRET/.test(r.body));
t('html content-type + no-store', /text\/html/.test(r.headers['Content-Type']) && /no-store/.test(r.headers['Cache-Control']));
r = await handler(ev('/timeline', good));
t('authed dir without slash works', r.statusCode === 200 && /STUDIO SECRET/.test(r.body));
r = await handler(ev('/js/learn.js', good));
t('authed js → 200 with js type', r.statusCode === 200 && /CLearn/.test(r.body) && /javascript/.test(r.headers['Content-Type']));
r = await handler(ev('/dashboard.html', good));
t('authed top-level file → 200', r.statusCode === 200 && /DASH SECRET/.test(r.body));
r = await handler(ev('/nope/none.js', good));
t('authed missing → 404', r.statusCode === 404);
r = await handler(ev('/timeline/../../../etc/passwd', good));
t('traversal blocked', r.statusCode === 400 || r.statusCode === 404);
r = await handler(ev('/%2e%2e/%2e%2e/etc/passwd', good));
t('encoded traversal blocked', r.statusCode === 400 || r.statusCode === 404);

rmSync(stage, { recursive: true, force: true });
console.log(`test_gate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
