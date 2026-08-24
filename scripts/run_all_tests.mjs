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
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* Suites are discovered, not listed. A hand-maintained list is exactly how a
   suite goes missing: somebody adds scripts/test_thing.mjs, nobody adds the
   line, and "all tests passed" quietly stops meaning it. Anything matching
   test_*.mjs or test_*.py under scripts/ or local-backend/ runs.

   The security suites are named so they run first and read together; the rest
   follow in alphabetical order. */
const SECURITY_FIRST = [
  'scripts/test_login_redirect.mjs',
  'scripts/test_signin_handshake.mjs',
  'scripts/test_throttle.mjs',
  'scripts/test_gate.mjs',
  'scripts/test_vault_sanitize.mjs',
  'scripts/test_cloud_safety.mjs',
  'scripts/test_projects_sync.mjs',
  'scripts/test_safe_url.mjs',
  'scripts/test_safe_url_client.mjs',
  'scripts/test_deploy_exclusions.mjs',
  'scripts/test_sw_cache.mjs',
  'local-backend/test_safe_fetch.py',
  'local-backend/test_ref_paths.py',
];

function discover() {
  const found = [];
  for (const dir of ['scripts', 'local-backend']) {
    let entries = [];
    try { entries = readdirSync(join(ROOT, dir)); } catch { continue; }
    for (const e of entries) {
      if (!/^test_.*\.(mjs|py)$/.test(e)) continue;
      found.push(dir + '/' + e);
    }
  }
  /* A .py and a .mjs of the same name are the same suite ported; run the .mjs,
     which is the one the app itself is written against. */
  const byStem = new Map();
  for (const rel of found) {
    const stem = rel.replace(/\.(mjs|py)$/, '');
    if (!byStem.has(stem) || rel.endsWith('.mjs')) byStem.set(stem, rel);
  }
  const all = [...byStem.values()];
  const ordered = SECURITY_FIRST.filter((f) => all.includes(f))
    .concat(all.filter((f) => !SECURITY_FIRST.includes(f)).sort());
  return ordered.map((rel) => [
    rel.replace(/^(scripts|local-backend)\/test_/, '').replace(/\.(mjs|py)$/, '').replace(/_/g, ' '),
    rel.endsWith('.py') ? 'python3' : 'node',
    [rel],
  ]);
}

const SUITES = discover();

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
