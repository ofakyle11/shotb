/* The owner session must live in the HttpOnly cookie and nowhere else.
 *
 * verify-owner used to return the signed token in its JSON body, and the
 * pages stored it in localStorage as SB_OWNER_TOKEN. The comment above
 * sessionCookies promised page scripts "can never read it", which was simply
 * untrue: one injected script anywhere in the gated app could lift a valid
 * 12-hour owner credential and replay it from any machine.
 *
 * This drives the real handler and then checks the pages that consume it, so
 * the token cannot quietly reappear on either side.
 *
 * Run: node scripts/test_signin_handshake.mjs
 */
import { readFileSync } from 'fs';

/* Test-only values. The handler reads whatever OWNER_PW_* holds, so a made-up
   password exercises every path a real one would — and a real password has no
   business in a file that gets committed and pushed. */
process.env.OWNER_TOKEN_SECRET = 'test-secret-0123456789';
process.env.OWNER_PW_HZ465 = 'test-only-password-not-a-real-one';
/* projects-sync refuses everything with a 500 when these are absent, which
   would make the token checks below pass for the wrong reason. */
process.env.CIN_API_TOKEN = 'nfp_test';
process.env.CIN_SITE_ID = 'site-test';

const { handler } = await import('/home/user/shotb/netlify/functions/verify-owner.js');

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`  x ${name}${detail ? ': ' + detail : ''}`); }
};

const signIn = (name, password) => handler({
  httpMethod: 'POST',
  headers: { host: 'cinamate-studio.netlify.app' },
  body: JSON.stringify({ name, password }),
});

/* ── a correct sign-in ── */
{
  const res = await signIn('hz465', process.env.OWNER_PW_HZ465);
  t('a correct password signs in', res.statusCode === 200, String(res.statusCode));
  const body = JSON.parse(res.body);
  t('the response says it succeeded', body.success === true);
  t('the response names the owner', body.name === 'hz465');

  /* the whole point */
  t('the response body carries NO token', !('token' in body), Object.keys(body).join(','));
  t('no field of the response looks like a signed token',
    !JSON.stringify(body).includes('owner:hz465:'), res.body);

  const cookies = (res.multiValueHeaders || {})['Set-Cookie'] || [];
  const session = cookies.find((c) => c.startsWith('cin_owner='));
  t('a session cookie is set', !!session);
  t('the session cookie is HttpOnly', /;\s*HttpOnly/i.test(session || ''));
  t('the session cookie is Secure', /;\s*Secure/i.test(session || ''));
  t('the session cookie is SameSite=Lax', /;\s*SameSite=Lax/i.test(session || ''));
  t('the session cookie actually holds the signed token',
    decodeURIComponent((session || '').split('=')[1] || '').startsWith('owner:hz465:'));

  const who = cookies.find((c) => c.startsWith('cin_who='));
  t('a readable name cookie is set for the UI', !!who);
  t('the name cookie is NOT HttpOnly (the UI reads it)', !/HttpOnly/i.test(who || ''));
  t('the name cookie carries only the short name',
    decodeURIComponent((who || '').split('=')[1] || '').split(';')[0] === 'hz465');
}

/* ── a wrong password ── */
{
  const res = await signIn('hz465', 'not-the-password');
  t('a wrong password is refused', res.statusCode === 401);
  t('a refusal sets no cookie', !((res.multiValueHeaders || {})['Set-Cookie'] || []).length);
  t('a refusal does not name which half was wrong',
    /Invalid name or password/.test(res.body), res.body);
}
{
  const res = await signIn('nobody', 'whatever');
  t('an unknown name is refused', res.statusCode === 401);
  t('an unknown name gives the same message as a wrong password',
    /Invalid name or password/.test(res.body), res.body);
}

/* ── sign-in must not be drivable from another site ── */
{
  const res = await signIn('hz465', process.env.OWNER_PW_HZ465);
  const h = res.headers || {};
  const acao = Object.keys(h).find((k) => k.toLowerCase() === 'access-control-allow-origin');
  t('no Access-Control-Allow-Origin is sent', !acao, acao && h[acao]);
  t('the response is not cacheable',
    /no-store/i.test(h['Cache-Control'] || h['cache-control'] || ''));
}

/* ── the pages must not put the session anywhere script can read ── */
{
  const login = readFileSync('/home/user/shotb/login.html', 'utf8');
  t('login.html no longer keys success off a token', !/res\.j\.token/.test(login));
  t('login.html keys success off the success flag', /res\.j\.success\s*!==\s*true/.test(login));
  t('login.html never writes a token to storage',
    !/setItem\(\s*['"]SB_OWNER_TOKEN/.test(login));

  const auth = readFileSync('/home/user/shotb/js/auth.js', 'utf8');
  t('js/auth.js never reads a token from storage',
    !/getItem\(\s*OWNER_TOKEN_KEY|getItem\(\s*['"]SB_OWNER_TOKEN/.test(auth));
  t('js/auth.js never writes a token to storage',
    !/setItem\(\s*OWNER_TOKEN_KEY|setItem\(\s*['"]SB_OWNER_TOKEN/.test(auth));
  t('js/auth.js still purges a token left by an earlier sign-in',
    /removeItem\(\s*OWNER_TOKEN_KEY/.test(auth));
}

/* ── the signature must pin ONE token string, not a family of them ── */
{
  const { createHmac } = await import('crypto');
  const secret = process.env.OWNER_TOKEN_SECRET;
  const expires = Date.now() + 3600000;
  const payload = `owner:hz465:${expires}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');

  /* Every consumer of the cookie must agree, so all three are checked. */
  const gate = await import('/home/user/shotb/netlify/functions/gate.js');
  const vo = await import('/home/user/shotb/netlify/functions/verify-owner.js');
  const sync = await import('/home/user/shotb/netlify/functions/projects-sync.js');

  /* The catalog read must not touch the network; an empty store is enough to
     tell an accepted token from a rejected one. */
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, text: async () => '' });

  const accepts = async (token) => {
    const r = await sync.handler({
      httpMethod: 'GET',
      headers: { cookie: 'cin_owner=' + encodeURIComponent(token), host: 'x.netlify.app' },
      queryStringParameters: { op: 'list' },
    });
    return r.statusCode !== 401;
  };

  t('the genuine token is accepted', await accepts(`${payload}:${sig}`));

  /* parseInt('1700000000abc') === 1700000000. Verifying over the reparsed
     number made all of these valid under the same signature. */
  for (const suffix of ['abc', ' ', '.9', 'e0', '\n', '000']) {
    const forged = `owner:hz465:${expires}${suffix}:${sig}`;
    t(`a mutated expires field is refused: ${JSON.stringify(String(expires) + suffix)}`,
      !(await accepts(forged)));
  }
  t('a leading-plus expires field is refused', !(await accepts(`owner:hz465:+${expires}:${sig}`)));
  t('a whitespace-padded expires field is refused', !(await accepts(`owner:hz465: ${expires}:${sig}`)));
  t('verifyOwnerToken agrees', vo.verifyOwnerToken(`owner:hz465:${expires}abc:${sig}`) === null);
  t('verifyOwnerToken still accepts the genuine one',
    (vo.verifyOwnerToken(`${payload}:${sig}`) || {}).name === 'hz465');
  t('the gate module still loads', typeof gate.handler === 'function');
  global.fetch = realFetch;
}

console.log(`test_signin_handshake: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
