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
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
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

/* A later review found the name and extension lists were applied only to the
   top level — the recursive filter under them asked about dotfiles and
   nothing else. A .zip under assets/ and a .ps1 under static/ were planted
   and both shipped to the CDN untouched. Extension matching was also
   case-sensitive, and a CDN serves "Backup.ZIP" exactly like "backup.zip". */
const deepPlanted = [
  join('assets', 'build.zip'),
  join('assets', 'Backup.ZIP'),
  join('static', 'vendor-install.ps1'),
  join('static', 'Setup.BAT'),
  join('projects', 'private', 'notes.txt'), // an excluded NAME, one level down
];
for (const rel of deepPlanted) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), 'TOKEN=' + CANARY + '\n');
}

/* A symlink is not its target until something reads it — and reading it is
   precisely what the upload step does. Copied as a link, resolved later, the
   name checks never see where it actually points. */
writeFileSync(join(repo, 'private', 'owner-token.txt'), 'TOKEN=' + CANARY + '\n');
symlinkSync(join(repo, 'private', 'owner-token.txt'), join(repo, 'assets', 'logo-backup.svg'));
symlinkSync(join(repo, 'private'), join(repo, 'assets', 'vault'), 'dir');

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
      /* lstat: a surviving symlink must be reported, not walked through as
         though it were an ordinary part of the staged tree. */
      if (lstatSync(p).isDirectory()) acc.push(...walk(p));
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

  /* 5. the lists reach all the way down, and are blind to case */
  const all = [...publicFiles.map((r) => ['public', r]), ...gatedFiles.map((r) => ['gated', r])];
  for (const bad of ['build.zip', 'Backup.ZIP', 'vendor-install.ps1', 'Setup.BAT']) {
    const hit = all.filter(([, r]) => r.split('/').pop() === bad);
    t('never ships ' + bad + ' from inside a published directory',
      hit.length === 0, hit.map(([l, r]) => l + ':' + r).join(', '));
  }
  const nestedName = all.filter(([, r]) => r.split('/').slice(0, -1).includes('private'));
  t('an excluded name is excluded at depth too',
    nestedName.length === 0, nestedName.map(([l, r]) => l + ':' + r).join(', '));

  /* 6. no symlink survives the copy into either tree */
  const links = [['public', site, publicFiles], ['gated', gated, gatedFiles]]
    .flatMap(([label, dir, list]) => list
      .filter((r) => { try { return lstatSync(join(dir, r)).isSymbolicLink(); } catch { return false; } })
      .map((r) => label + ':' + r));
  t('no symlink survives into either tree', links.length === 0, links.join(', '));

  rmSync(staged[1].trim(), { recursive: true, force: true });
}

/* 7. the hard stop actually stops. Route around the copy filter entirely by
      writing straight into the staged tree, and prove the build still refuses
      — once for each rule, because a guard that only knows about dotfiles is
      how the .zip and .ps1 got out in the first place. */
const ANCHOR = "cpSync(join(ROOT, 'assets', 'favicon.ico'), join(site, 'favicon.ico'));";
const PLANTS = [
  ['dotfile', "writeFileSync(join(site, '.env'), 'x');", /\.env/],
  ['excluded extension', "writeFileSync(join(site, 'leak.zip'), 'x');", /leak\.zip/],
  ['upper-case extension', "writeFileSync(join(site, 'Leak.ZIP'), 'x');", /Leak\.ZIP/],
  ['excluded name', "mkdirSync(join(site, 'private'));writeFileSync(join(site, 'private', 'n.txt'), 'x');", /private/],
  ['symlink', "symlinkSync(join(ROOT, 'package.json'), join(site, 'notes.txt'));", /notes\.txt/],
];
const src = readFileSync(join(repo, 'scripts', 'deploy_cinamate.mjs'), 'utf8');
for (const [label, plant, names] of PLANTS) {
  const probe = join(repo, 'scripts', '_probe_' + label.replace(/\W+/g, '_') + '.mjs');
  writeFileSync(probe, src
    .replace('} from \'fs\';', ', symlinkSync } from \'fs\';')
    .replace(ANCHOR, plant + '\n' + ANCHOR));
  let status = 0, text = '';
  try {
    text = execFileSync(process.execPath, [probe, 'cinamate-studio', '--build-only'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { status = e.status; text = (e.stdout || '') + (e.stderr || ''); }
  t('a ' + label + ' reaching the staged tree fails the build', status !== 0, 'exit ' + status + '\n      ' + text.slice(-300));
  t('the ' + label + ' failure names the file',
    /REFUSING TO DEPLOY/.test(text) && names.test(text), text.slice(-300));
  const stagedAt = /BUILD-ONLY — staged at: (.+)/.exec(text);
  if (stagedAt) rmSync(stagedAt[1].trim(), { recursive: true, force: true });
}

rmSync(work, { recursive: true, force: true });
console.log(`test_deploy_exclusions: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
