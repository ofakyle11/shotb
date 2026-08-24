/* The deploy script decides what the world can download. A review found that
 * its two exclusion lists cannot see a dotfile at all — ".env" has an
 * "extension" of ".env", so the extension list never matches it, and the
 * named list only excludes what somebody remembered to name. A single stray
 * .env at the repo root would have been published to the CDN.
 *
 * This plants real-looking secrets in a throwaway copy of the repo, runs the
 * real build, and reads back everything the build would have uploaded.
 *
 * Run: node scripts/test_deploy_exclusions.mjs
 */
import { execFileSync } from 'child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log('  x ' + name + (detail ? '\n      ' + detail : '')); }
};

/* A copy of the repo we can plant secrets in without touching the real one.
   node_modules and .git are the bulk of the tree and neither is needed. */
const work = mkdtempSync(join(tmpdir(), 'cin-deploytest-'));
const repo = join(work, 'repo');
mkdirSync(repo);
for (const entry of readdirSync(ROOT)) {
  if (entry === '.git' || entry === 'node_modules') continue;
  cpSync(join(ROOT, entry), join(repo, entry), { recursive: true });
}

const CANARY = 'CANARY_SECRET_' + 'do_not_publish';
const planted = [
  '.env',
  '.env.local',
  '.htpasswd',
  '.npmrc',
  join('projects', '.env'),          // nested, reached by the recursive copy
  join('assets', '.env.production'), // inside a directory that IS public
];
for (const rel of planted) {
  writeFileSync(join(repo, rel), 'TOKEN=' + CANARY + '\n');
}

/* package.json came across with the copy; terser and its own dependencies
   resolve from node_modules, which is linked rather than copied — it is by
   far the largest thing in the tree and nothing here writes to it. */
symlinkSync(join(ROOT, 'node_modules'), join(repo, 'node_modules'), 'dir');

let out = '';
try {
  out = execFileSync(process.execPath, [join(repo, 'scripts', 'deploy_cinamate.mjs'), 'cinamate-studio', '--build-only'],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
  t('the build completes', false, 'exit ' + e.status + '\n      ' + out.slice(-600));
}

const staged = /BUILD-ONLY — staged at: (.+)/.exec(out);
t('the build reports where it staged the site', !!staged, out.slice(-400));

if (staged) {
  const site = join(staged[1].trim(), 'site');
  const gated = join(staged[1].trim(), 'fn-gate', 'site');
  const walk = (dir) => {
    const acc = [];
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) acc.push(...walk(p));
      else acc.push(p);
    }
    return acc;
  };

  const publicFiles = walk(site).map((p) => relative(site, p).split('\\').join('/'));
  const gatedFiles = walk(gated).map((p) => relative(gated, p).split('\\').join('/'));

  /* 1. no dot-path anywhere in what gets uploaded */
  const publicDots = publicFiles.filter((r) => r.split('/').some((s) => s.charAt(0) === '.'));
  t('no dotfile is published to the CDN', publicDots.length === 0, publicDots.join(', '));
  const gatedDots = gatedFiles.filter((r) => r.split('/').some((s) => s.charAt(0) === '.'));
  t('no dotfile is packed into the gate bundle', gatedDots.length === 0, gatedDots.join(', '));

  /* 2. the secret's CONTENT is nowhere in either tree, whatever it got named */
  const leaks = [];
  for (const [label, dir, list] of [['public', site, publicFiles], ['gated', gated, gatedFiles]]) {
    for (const rel of list) {
      let body;
      try { body = readFileSync(join(dir, rel), 'utf8'); } catch { continue; }
      if (body.includes(CANARY)) leaks.push(label + ':' + rel);
    }
  }
  t('the planted secret appears in no shipped file', leaks.length === 0, leaks.join(', '));

  /* 3. the build still ships the things it is supposed to ship — an
        exclusion rule that quietly ate the site would also pass test 1 */
  for (const need of ['index.html', 'login.html', 'css/theme.css', 'js/cinamate-auth.js']) {
    t('still publishes ' + need, publicFiles.includes(need));
  }
  t('still gates the dashboard', gatedFiles.includes('dashboard.html'));
  t('the gated tree is substantial', gatedFiles.length > 100, gatedFiles.length + ' files');

  /* 4. named exclusions are still honoured */
  for (const never of ['netlify.toml', 'package.json']) {
    t('never publishes ' + never, !publicFiles.includes(never) && !gatedFiles.includes(never));
  }
  for (const dir of ['private', 'scripts', 'local-backend', 'netlify', 'agents']) {
    const hit = [...publicFiles, ...gatedFiles].filter((r) => r.startsWith(dir + '/'));
    t('never publishes ' + dir + '/', hit.length === 0, hit.slice(0, 3).join(', '));
  }

  rmSync(staged[1].trim(), { recursive: true, force: true });
}

/* 5. the hard stop actually stops. Route around the copy filter by writing a
      dotfile straight into the staged tree, and prove the build refuses. */
{
  const patched = readFileSync(join(repo, 'scripts', 'deploy_cinamate.mjs'), 'utf8').replace(
    "cpSync(join(ROOT, 'assets', 'favicon.ico'), join(site, 'favicon.ico'));",
    "writeFileSync(join(site, '.env'), 'TOKEN=" + CANARY + "');\n" +
    "cpSync(join(ROOT, 'assets', 'favicon.ico'), join(site, 'favicon.ico'));");
  const probe = join(repo, 'scripts', '_probe_deploy.mjs');
  writeFileSync(probe, patched);
  let status = 0, text = '';
  try {
    text = execFileSync(process.execPath, [probe, 'cinamate-studio', '--build-only'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { status = e.status; text = (e.stdout || '') + (e.stderr || ''); }
  t('a dotfile that reaches the staged tree fails the build', status !== 0, 'exit ' + status);
  t('the failure names the file', /REFUSING TO DEPLOY/.test(text) && /\.env/.test(text), text.slice(-300));
  const stagedAt = /BUILD-ONLY — staged at: (.+)/.exec(text);
  if (stagedAt) rmSync(stagedAt[1].trim(), { recursive: true, force: true });
}

rmSync(work, { recursive: true, force: true });
console.log(`test_deploy_exclusions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
