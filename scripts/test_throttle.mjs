/* The login throttle must actually stop distributed guessing, must never lock
 * the owners out when its storage is unreachable, and must not keep raw client
 * IPs. Run: node scripts/test_throttle.mjs */
process.env.OWNER_TOKEN_SECRET = 'test-secret-0123456789';
process.env.OWNER_PW_DZ465 = 'correct-horse-battery';
process.env.CIN_API_TOKEN = 'tok';
process.env.CIN_SITE_ID = 'site';

const { createRequire } = await import('module');
const require_ = createRequire(import.meta.url);
const path = '/home/user/shotb/netlify/functions/verify-owner.js';

let pass = 0, fail = 0;
const t = (name, cond, detail) => { cond ? pass++ : (fail++, console.log('  x ' + name + (detail ? '\n      ' + detail : ''))); };

/* a stand-in blob store we can break on demand */
function installStore({ broken = false } = {}) {
  const store = new Map();
  const seenKeys = [];
  global.fetch = async (url, opts = {}) => {
    if (broken) throw new Error('store unreachable');
    const key = decodeURIComponent(String(url).split('/cinamate-auth/')[1] || '');
    seenKeys.push(key);
    const m = (opts.method || 'GET').toUpperCase();
    if (m === 'GET') {
      if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => store.get(key) };
    }
    store.set(key, opts.body);
    return { ok: true, status: 201, text: async () => '' };
  };
  return { store, seenKeys };
}

const ev = (name, password, ip) => ({
  httpMethod: 'POST',
  headers: { 'x-nf-client-connection-ip': ip },
  body: JSON.stringify({ name, password }),
});

/* 1. distributed guessing is stopped even across "instances" (fresh module load) */
let { store, seenKeys } = installStore();
let codes = [];
for (let i = 0; i < 16; i++) {
  delete require_.cache[require_.resolve(path)];        // simulate a cold instance each time
  const { handler } = require_(path);
  codes.push((await handler(ev('dz465', 'wrong' + i, '9.9.9.9'))).statusCode);
}
t('wrong passwords are rejected', codes.filter(c => c === 401).length > 0);
t('a distributed attacker eventually gets 429', codes.includes(429));
t('the limit bites near the configured 12', codes.indexOf(429) >= 12 && codes.indexOf(429) <= 14);

/* 2. the raw IP is never used as a key */
t('client IP is not stored in the clear', !seenKeys.some(k => k.includes('9.9.9.9')));
/* Two families now: t_ per address, n_ per owner name. Both are keyed
   digests — neither the address nor the name is a thing to keep here. */
t('keys are keyed digests', seenKeys.every(k => /^[tn]_[0-9a-f]{32}$/.test(k)));
t('both an address key and a name key are written',
  seenKeys.some(k => k.startsWith('t_')) && seenKeys.some(k => k.startsWith('n_')));

/* 3. a correct password is not charged against the budget */
({ store, seenKeys } = installStore());
delete require_.cache[require_.resolve(path)];
let { handler } = require_(path);
let ok = await handler(ev('dz465', 'correct-horse-battery', '5.5.5.5'));
t('correct password succeeds', ok.statusCode === 200);
t('a success writes no attempt record', store.size === 0);

/* 4. an unreachable store must NOT lock owners out */
installStore({ broken: true });
delete require_.cache[require_.resolve(path)];
({ handler } = require_(path));
ok = await handler(ev('dz465', 'correct-horse-battery', '7.7.7.7'));
t('login still works when the throttle store is down', ok.statusCode === 200);
const bad = await handler(ev('dz465', 'nope', '7.7.7.7'));
t('wrong password still rejected when store is down', bad.statusCode === 401);

/* 5. an unknown owner name is charged and timed like a wrong password */
({ store } = installStore());
delete require_.cache[require_.resolve(path)];
({ handler } = require_(path));
const started = Date.now();
const unknown = await handler(ev('nobody', 'x', '4.4.4.4'));
t('unknown name returns the same 401', unknown.statusCode === 401);
t('unknown name is delayed like a wrong password', Date.now() - started >= 140);
/* One entry for the address, one for the name it claimed. Twelve tries per
   address is no limit to somebody with a thousand of them, and every one is
   aimed at the same five names, so the name is counted too. */
t('unknown name costs attempt budget', store.size === 2, [...store.keys()].join(', '));
t('an invented name shares one bucket rather than minting its own',
  [...store.keys()].filter(k => k.startsWith('n_')).length === 1);

console.log('test_throttle: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
