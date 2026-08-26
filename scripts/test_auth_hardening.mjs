#!/usr/bin/env node
/* Three findings against the sign-in path, each proved here.
 *
 *  · Both verifiers read the FIRST cin_owner in the Cookie header and stopped.
 *    A browser will happily send two cookies of the same name, and it sends
 *    the narrower-path one first, so a planted cookie could stand in front of
 *    a real session and hide it.
 *  · verify-owner.js mints the tokens and was the only one of the three
 *    verifiers that never checked the decoded name against the owner list.
 *  · The in-memory throttle emptied itself once it held 500 entries, which
 *    made the whole local layer resettable on demand.
 *
 * Run: node scripts/test_auth_hardening.mjs
 */
import { createHmac } from 'crypto';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
let pass = 0, fail = 0;
const t = (n, c, d) => { if (c) pass++; else { fail++; console.log('  x ' + n + (d ? '\n      ' + d : '')); } };

const SECRET = 'test-secret-for-auth-hardening';
process.env.OWNER_TOKEN_SECRET = SECRET;

const stage = mkdtempSync(join(tmpdir(), 'auth-test-'));
cpSync(join(ROOT, 'netlify/functions/gate.js'), join(stage, 'gate.js'));
mkdirSync(join(stage, 'site'), { recursive: true });
writeFileSync(join(stage, 'site/dashboard.html'), '<html>DASH SECRET</html>');
const gate = require_(join(stage, 'gate.js'));
const vo = require_(join(ROOT, 'netlify/functions/verify-owner.js'));

const mint = (name, expires) => {
  const payload = `owner:${name}:${expires}`;
  return payload + ':' + createHmac('sha256', SECRET).update(payload).digest('hex');
};
const soon = () => Date.now() + 3600000;
const req = (cookie) => ({ rawUrl: 'https://x.example/dashboard.html', headers: { cookie } });
const ok = async (cookie) => (await gate.handler(req(cookie))).statusCode === 200;

/* ── cookie shadowing ─────────────────────────────────────────────── */
{
  const real = encodeURIComponent(mint('hz465', soon()));
  t('a lone valid cookie still works', await ok('cin_owner=' + real));

  /* The attack: a bogus cin_owner placed BEFORE the real one, which is the
     order a browser uses when the bogus cookie has the narrower path. */
  t('a bogus cookie in front of the real one does not hide it',
    await ok('cin_owner=garbage; cin_owner=' + real));
  t('a bogus cookie in front, with other cookies around it, still does not hide it',
    await ok('theme=dark; cin_owner=owner:hz465:1:deadbeef; cin_owner=' + real + '; x=1'));
  t('an empty cin_owner in front does not hide it',
    await ok('cin_owner=; cin_owner=' + real));

  /* And the guard must not have become "accept anything": a header made only
     of forgeries is still refused. */
  t('forged cookies alone are still refused',
    !(await ok('cin_owner=garbage; cin_owner=owner:hz465:' + soon() + ':00')));
  t('an expired token is still refused',
    !(await ok('cin_owner=' + encodeURIComponent(mint('hz465', Date.now() - 1000)))));
  t('a name outside the owner list is still refused',
    !(await ok('cin_owner=' + encodeURIComponent(mint('admin', soon())))));
}

/* ── verify-owner's own verifier ──────────────────────────────────── */
{
  t('verifyOwnerToken accepts a real owner',
    vo.verifyOwnerToken(mint('hz465', soon()))?.name === 'hz465');
  /* Correctly signed, unexpired, and for a name that is not an owner. Before
     the allow-list this returned a session. */
  for (const name of ['admin', 'kyle', 'root', 'mz466', '']) {
    t('verifyOwnerToken rejects a signed token for "' + name + '"',
      vo.verifyOwnerToken(mint(name, soon())) === null);
  }
  t('verifyOwnerToken is case-insensitive about the owner list',
    vo.verifyOwnerToken(mint('HZ465', soon()))?.name === 'hz465');
  t('verifyOwnerToken still rejects a bad signature',
    vo.verifyOwnerToken('owner:hz465:' + soon() + ':00') === null);
  t('verifyOwnerToken still rejects trailing rubbish on the expiry',
    vo.verifyOwnerToken(mint('hz465', String(soon()) + 'abc')) === null);
}

/* ── the local throttle's eviction ────────────────────────────────── */
{
  /* Read the source rather than the behaviour: the map is module-private and
     the handler needs a live blob store to reach it. What matters is that no
     path empties the map wholesale — that is the entire finding. */
  const src = require_('fs').readFileSync(join(ROOT, 'netlify/functions/verify-owner.js'), 'utf8');
  t('the attempt map is never cleared wholesale', !/attempts\.clear\s*\(/.test(src));
  t('the attempt map evicts by age', /byAge|sort\(/.test(src) && /attempts\.delete/.test(src));
  t('failures are counted per name as well as per address',
    /function nameKey/.test(src) && /bump\(nameKey/.test(src));
  t('the shared counter writes conditionally',
    /If-Match/.test(src) && /412/.test(src));
  /* Match the construct, not the word: clientIp already returns "unknown" as
     a fallback, so testing for the bare string passed before the fix existed. */
  t('an unrecognised name cannot mint new counter keys',
    /const countAs = known \? nameLower : "unknown"/.test(src) && /recordFailure\(ip, countAs\)/.test(src));
  t('the per-name pressure check runs on every path, valid name or not',
    /accountPressure\(countAs\)/.test(src));
}

console.log(`test_auth_hardening: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
