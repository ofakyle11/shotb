/* Run every check in one command, and report honestly.
 *
 * A suite that stops at the first failure hides how much else is broken, and
 * one that swallows a crashed runner reads as "clean" when nothing ran at
 * all — the same failure mode the security review's own tooling had. So every
 * suite runs, a runner that dies is reported as an ERROR distinct from a
 * failing assertion, and the exit code is non-zero if anything at all went
 * wrong.
 *
 *   node scripts/run_all_tests.mjs
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SUITES = [
  ['login redirect',      'node',    ['scripts/test_login_redirect.mjs']],
  ['sign-in throttle',    'node',    ['scripts/test_throttle.mjs']],
  ['vault sanitiser',     'node',    ['scripts/test_vault_sanitize.mjs']],
  ['cloud safety',        'node',    ['scripts/test_cloud_safety.mjs']],
  ['safe URL filter',     'node',    ['scripts/test_safe_url.mjs']],
  ['deploy exclusions',   'node',    ['scripts/test_deploy_exclusions.mjs']],
  ['service worker cache','node',    ['scripts/test_sw_cache.mjs']],
  ['bridge safe fetch',   'python3', ['local-backend/test_safe_fetch.py']],
  ['comfy wait',          'python3', ['scripts/test_comfy_wait.py']],
];

const rows = [];
let failed = 0, errored = 0;

for (const [name, cmd, args] of SUITES) {
  const script = join(ROOT, args[0]);
  if (!existsSync(script)) {
    rows.push({ name, state: 'MISSING', detail: args[0] + ' not found' });
    errored++;
    continue;
  }
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  const out = ((res.stdout || '') + (res.stderr || '')).trim();
  const last = out.split('\n').filter(Boolean).pop() || '';

  if (res.error || res.status === null) {
    rows.push({ name, state: 'ERROR', detail: String(res.error || 'killed') });
    errored++;
  } else if (res.status !== 0) {
    rows.push({ name, state: 'FAIL', detail: last });
    failed++;
    console.log(`\n── ${name} ──\n${out}\n`);
  } else {
    rows.push({ name, state: 'ok', detail: last });
  }
}

const width = Math.max(...rows.map((r) => r.name.length));
console.log('');
for (const r of rows) {
  const mark = r.state === 'ok' ? '  ok  ' : ` ${r.state} `;
  console.log(`${mark} ${r.name.padEnd(width)}  ${r.detail}`);
}

const bad = failed + errored;
console.log(`\n${rows.length - bad}/${rows.length} suites passed` +
  (failed ? ` · ${failed} failing` : '') +
  (errored ? ` · ${errored} could not run` : ''));
process.exit(bad ? 1 : 0);
