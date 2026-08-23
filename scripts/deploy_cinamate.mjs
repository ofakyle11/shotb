#!/usr/bin/env node
/* Deploy the combined Cinamate site (Studio + Producer Suite) to Netlify,
 * INCLUDING the /verify-owner login function and the /gate application
 * gate (digest-based deploy — the plain zip method cannot ship functions).
 *
 *   NETLIFY_AUTH_TOKEN=nfp_xxx node scripts/deploy_cinamate.mjs [site-name]
 *   node scripts/deploy_cinamate.mjs [site-name] --build-only   # no network
 *
 * Optional env (set once; existing values are left alone unless provided):
 *   OWNER_PW_MZ465 / OWNER_PW_KZ465 / OWNER_PW_HZ465 / OWNER_PW_RZ465 / OWNER_PW_DZ465  owner login passwords
 *   OWNER_TOKEN_SECRET               HMAC secret (auto-generated if absent)
 *
 * Security build (2026-08 lockdown):
 *   · every .js file and inline <script> is minified/mangled with terser
 *   · only the landing page, login page and brand assets go to the public
 *     CDN — the ENTIRE application (modules, js/, css/) is packed inside
 *     the gate function and served only to a valid cin_owner cookie
 *   · _redirects routes protected paths to the gate; _headers hardens all
 */
import { execSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const BUILD_ONLY = process.argv.includes('--build-only');
const NO_MINIFY = process.argv.includes('--no-minify');
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
if (!TOKEN && !BUILD_ONLY) { console.error('NETLIFY_AUTH_TOKEN is required'); process.exit(1); }
const SITE_NAME = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'cinamate';
const API = 'https://api.netlify.com/api/v1';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const require_ = createRequire(join(ROOT, 'package.json'));
let terser = null;
if (!NO_MINIFY) {
  try { terser = require_('terser'); }
  catch (e) { console.error('terser missing — run `npm install --no-save terser@5` first'); process.exit(1); }
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

/* ── 1. assemble the full site ─────────────────────────────────────── */
const EXCLUDE = new Set(['.git', 'local-backend', 'private', 'scripts', 'netlify', 'docs',
  'agents', // server-function imports only — three files are broken placeholders, never page-loaded
  'node_modules', 'package.json', 'package-lock.json',
  'local-server.py', 'netlify.toml', '.netlifyignore', '.firebaserc', '.gitignore',
  'firebase.json', 'database.rules.json']);
const EXCLUDE_EXT = new Set(['.zip', '.jpeg', '.ps1', '.bat']);

const work = mkdtempSync(join(tmpdir(), 'cinamate-'));
const site = join(work, 'site');
mkdirSync(site);
for (const entry of readdirSync(ROOT)) {
  if (EXCLUDE.has(entry) || EXCLUDE_EXT.has(entry.slice(entry.lastIndexOf('.')))) continue;
  cpSync(join(ROOT, entry), join(site, entry), { recursive: true });
}
cpSync(join(ROOT, 'cinamate', 'index.html'), join(site, 'index.html'));
rmSync(join(site, 'cinamate'), { recursive: true, force: true }); // root copy is canonical
/* Root-convention icons: iMessage/Safari/scrapers fetch these paths directly. */
cpSync(join(ROOT, 'assets', 'favicon.ico'), join(site, 'favicon.ico'));
cpSync(join(ROOT, 'assets', 'apple-touch-icon.png'), join(site, 'apple-touch-icon.png'));

const STAMP = 'cm' + Date.now();
const ASSETVER = [
  ['assets/logo.svg"', 'assets/logo.svg?v=' + STAMP + '"'],
  ['assets/logo-mark.svg"', 'assets/logo-mark.svg?v=' + STAMP + '"'],
  ['assets/favicon.svg"', 'assets/favicon.svg?v=' + STAMP + '"'],
];
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
for (const p of walk(site)) {
  if (!p.endsWith('.html')) continue;
  let s = readFileSync(p, 'utf8');
  for (const [from, to] of ASSETVER) s = s.split(from).join(to);
  s = s.replace(/\?v=[A-Za-z0-9-]+/g, '?v=' + STAMP);
  writeFileSync(p, s);
}

/* ── 2. minify every .js file and inline <script> (obfuscation pass) ── */
const TERSER_OPTS = { compress: { passes: 2 }, mangle: true, format: { comments: false } };
async function minifyJs(code, label) {
  let r;
  try { r = await terser.minify(code, TERSER_OPTS); }
  catch (e) { throw new Error('terser failed on ' + label + ': ' + e.message + ' | starts: ' + JSON.stringify(code.slice(0, 80))); }
  if (r.error || typeof r.code !== 'string') throw new Error('terser failed on ' + label + ': ' + (r.error || 'no output'));
  return r.code;
}
if (terser) {
  let files = 0, inline = 0;
  for (const p of walk(site)) {
    const relPath = relative(site, p).replace(/\\/g, '/');
    // Third-party libraries under static/ ship as their vendors published them:
    // they are already minified, and re-mangling a 1 MB worker risks breaking it.
    const isVendor = relPath.startsWith('static/');
    if (p.endsWith('.js') && !isVendor) {
      writeFileSync(p, await minifyJs(readFileSync(p, 'utf8'), relative(site, p)));
      files++;
    } else if (p.endsWith('.html')) {
      const src = readFileSync(p, 'utf8');
      const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
      let out = '', last = 0, m;
      while ((m = re.exec(src)) !== null) {
        out += src.slice(last, m.index);
        const tag = m[1];
        const isExternal = /\bsrc\s*=/i.test(tag);
        const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag);
        const isJs = !type || /javascript|module/i.test(type[1]);
        if (!isExternal && isJs && m[2].trim().length > 80) {
          out += tag + await minifyJs(m[2], relative(site, p) + ' (inline)') + m[3];
          inline++;
        } else out += m[0];
        last = m.index + m[0].length;
      }
      writeFileSync(p, out + src.slice(last));
    }
  }
  console.log(`minified ${files} js files + ${inline} inline scripts`);
}

/* ── 3. partition: public shell vs gated application ──────────────────
   Public: the landing page, sign-in page, brand assets, and the three
   shared files the landing itself loads. EVERYTHING else moves inside
   the gate function — anonymous requests never receive it.            */
const PUBLIC_FILES = new Set(['index.html', 'login.html', 'favicon.ico',
  'manifest.webmanifest', 'sw.js',
  'apple-touch-icon.png', 'robots.txt', 'sitemap.xml', '404.html',
  '_redirects', '_headers', // repo originals — merged/kept below, must stay CDN-side
  'css/theme.css', 'js/cinamate-auth.js', 'js/effects.js']);
/* static/ffmpeg is generic vendor wasm (32 MB) — far over the function
 * response limit and zero proprietary value; it stays on the CDN where the
 * repo _headers give it CORP + immutable caching. */
const PUBLIC_PREFIXES = ['assets/', 'static/'];

const fnRoot = join(work, 'fn-gate');
mkdirSync(join(fnRoot, 'site'), { recursive: true });
const protectedTop = new Set();
for (const p of walk(site)) {
  const rel = relative(site, p).split('\\').join('/');
  const isPublic = PUBLIC_FILES.has(rel) || PUBLIC_PREFIXES.some(pre => rel.startsWith(pre));
  if (isPublic) continue;
  const dest = join(fnRoot, 'site', rel);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(p, dest);
  protectedTop.add(rel.split('/')[0]);
}
/* prune now-empty dirs left in the public site */
(function prune(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { prune(p); if (!readdirSync(p).length) rmSync(p, { recursive: true }); }
  }
})(site);

/* ── 4. routing + headers for the public shell ───────────────────────
   Non-forced 200 rewrites: real public files still win; everything the
   partition moved out of the CDN lands on the gate function.          */
let redirects = existsSync(join(site, '_redirects'))
  ? readFileSync(join(site, '_redirects'), 'utf8').replace(/\s*$/, '\n')
  : '';
redirects = redirects.replace(/^\/app\s+\/app\.html\s+200$/m, '/app /.netlify/functions/gate 200')
                     .replace(/^\/app\/\s+\/app\.html\s+200$/m, '/app/ /.netlify/functions/gate 200');
redirects += '\n# ── application gate: everything below is served only to owner cookies ──\n';
for (const top of [...protectedTop].sort()) {
  const isDir = existsSync(join(fnRoot, 'site', top)) && statSync(join(fnRoot, 'site', top)).isDirectory();
  redirects += `/${top} /.netlify/functions/gate 200\n`;
  if (isDir) redirects += `/${top}/* /.netlify/functions/gate 200\n`;
}
writeFileSync(join(site, '_redirects'), redirects);
/* _headers: the repo original stays as-is — it already carries the security
 * headers, cache busting, and the static/ffmpeg CORP + immutable rules. */

/* ── 5. bundle the functions ─────────────────────────────────────────
   verify-owner: self-contained. gate: gate.js + the protected site.   */
const fnDir = join(work, 'fn');
mkdirSync(fnDir);
cpSync(join(ROOT, 'netlify/functions/verify-owner.js'), join(fnDir, 'verify-owner.js'));
execSync('zip -qj ' + JSON.stringify(join(work, 'verify-owner.zip')) + ' ' + JSON.stringify(join(fnDir, 'verify-owner.js')));
const fnZip = readFileSync(join(work, 'verify-owner.zip'));
const fnSha = createHash('sha256').update(fnZip).digest('hex');

cpSync(join(ROOT, 'netlify/functions/projects-sync.js'), join(fnDir, 'projects-sync.js'));
execSync('zip -qj ' + JSON.stringify(join(work, 'projects-sync.zip')) + ' ' + JSON.stringify(join(fnDir, 'projects-sync.js')));
const syncZip = readFileSync(join(work, 'projects-sync.zip'));
const syncSha = createHash('sha256').update(syncZip).digest('hex');

cpSync(join(ROOT, 'netlify/functions/gate.js'), join(fnRoot, 'gate.js'));
if (terser) {
  writeFileSync(join(fnRoot, 'gate.js'), await minifyJs(readFileSync(join(fnRoot, 'gate.js'), 'utf8'), 'gate.js'));
}
execSync('zip -qr ' + JSON.stringify(join(work, 'gate.zip')) + ' gate.js site', { cwd: fnRoot });
const gateZip = readFileSync(join(work, 'gate.zip'));
const gateSha = createHash('sha256').update(gateZip).digest('hex');

const publicCount = walk(site).length;
const gatedCount = walk(join(fnRoot, 'site')).length;
console.log(`public shell: ${publicCount} files · gated application: ${gatedCount} files (${(gateZip.length / 1048576).toFixed(1)} MB bundle)`);

if (BUILD_ONLY) {
  console.log('BUILD-ONLY — staged at:', work);
  console.log('  public site:', site);
  console.log('  gated tree :', join(fnRoot, 'site'));
  process.exit(0);
}

/* ── 6. find or create the site ────────────────────────────────────── */
let siteId = null;
{
  const r = await api('/sites?name=' + encodeURIComponent(SITE_NAME));
  const hit = Array.isArray(r.body) && r.body.find(s => s.name === SITE_NAME);
  if (hit) siteId = hit.id;
}
if (!siteId) {
  const r = await api('/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: SITE_NAME }) });
  if (!r.ok) { console.error('Site create failed:', r.status, r.body); process.exit(1); }
  siteId = r.body.id;
  console.log('Created site:', SITE_NAME);
}

/* ── 7. env vars (functions scope). Only touches keys passed in env. ── */
const acct = await api('/accounts');
const accountId = Array.isArray(acct.body) && acct.body[0] && acct.body[0].id;
const wanted = {
  CIN_API_TOKEN: process.env.CIN_API_TOKEN,
  CIN_SITE_ID: process.env.CIN_SITE_ID,
  OWNER_PW_MZ465: process.env.OWNER_PW_MZ465,
  OWNER_PW_KZ465: process.env.OWNER_PW_KZ465,
  OWNER_PW_HZ465: process.env.OWNER_PW_HZ465,
  OWNER_PW_RZ465: process.env.OWNER_PW_RZ465,
  OWNER_PW_DZ465: process.env.OWNER_PW_DZ465,
  OWNER_TOKEN_SECRET: process.env.OWNER_TOKEN_SECRET,
};
if (accountId) {
  const existing = await api(`/accounts/${accountId}/env?site_id=${siteId}`);
  const have = new Set(Array.isArray(existing.body) ? existing.body.map(v => v.key) : []);
  if (!wanted.OWNER_TOKEN_SECRET && !have.has('OWNER_TOKEN_SECRET')) {
    wanted.OWNER_TOKEN_SECRET = randomBytes(36).toString('base64url'); // auto-provision once
  }
  for (const [key, value] of Object.entries(wanted)) {
    if (!value) continue;
    // No `scopes` field — Free-plan accounts reject scoped env vars (403).
    const payload = { key, values: [{ context: 'all', value }] };
    if (have.has(key)) {
      const r = await api(`/accounts/${accountId}/env/${key}?site_id=${siteId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      console.log('env updated:', key, r.ok ? 'ok' : r.status);
    } else {
      const r = await api(`/accounts/${accountId}/env?site_id=${siteId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([payload]) });
      console.log('env created:', key, r.ok ? 'ok' : r.status);
    }
  }
} else {
  console.warn('Could not resolve account id — env vars not set');
}

/* ── 8. digest deploy: files (sha1) + functions (sha256) ───────────── */
const files = {};
const bySha = {};
for (const p of walk(site)) {
  const rel = '/' + relative(site, p).split('\\').join('/');
  const sha = createHash('sha1').update(readFileSync(p)).digest('hex');
  files[rel] = sha;
  (bySha[sha] = bySha[sha] || []).push(p);
}
console.log(`Deploying ${Object.keys(files).length} public files + verify-owner/gate/projects-sync functions`);

const dep = await api(`/sites/${siteId}/deploys`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files, functions: { 'verify-owner': fnSha, 'gate': gateSha, 'projects-sync': syncSha } }),
});
if (!dep.ok) { console.error('Deploy create failed:', dep.status, dep.body); process.exit(1); }
const deployId = dep.body.id;

for (const sha of dep.body.required || []) {
  for (const p of bySha[sha] || []) {
    const rel = '/' + relative(site, p).split('\\').join('/');
    const r = await api(`/deploys/${deployId}/files${rel.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: readFileSync(p) });
    if (!r.ok) { console.error('Upload failed:', rel, r.status, r.body); process.exit(1); }
  }
}
const requiredFns = dep.body.required_functions || [];
for (const [name, sha, zip] of [['verify-owner', fnSha, fnZip], ['gate', gateSha, gateZip], ['projects-sync', syncSha, syncZip]]) {
  if (!requiredFns.includes(sha)) continue;
  const r = await api(`/deploys/${deployId}/functions/${name}?runtime=js`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: zip });
  if (!r.ok) { console.error('Function upload failed:', name, r.status, r.body); process.exit(1); }
  console.log(name + ' function uploaded');
}

for (let i = 0; i < 40; i++) {
  const st = await api(`/deploys/${deployId}`);
  const state = st.body && st.body.state;
  console.log('  deploy state:', state);
  if (state === 'ready') {
    console.log('\nLive:', st.body.ssl_url || st.body.url);
    console.log('Admin:', st.body.admin_url || '');
    rmSync(work, { recursive: true, force: true });
    process.exit(0);
  }
  if (state === 'error') { console.error('Deploy errored:', JSON.stringify(st.body.error_message || st.body)); process.exit(1); }
  await new Promise(r => setTimeout(r, 4000));
}
console.error('Timed out waiting for deploy');
process.exit(1);
