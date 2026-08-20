#!/usr/bin/env node
/* Deploy the combined Cinamate site (Studio + Producer Suite) to Netlify,
 * INCLUDING the /verify-owner login function (digest-based deploy — the
 * plain zip method cannot ship functions).
 *
 *   NETLIFY_AUTH_TOKEN=nfp_xxx node scripts/deploy_cinamate.mjs [site-name]
 *
 * Optional env (set once; existing values are left alone unless provided):
 *   OWNER_PW_MZ465 / OWNER_PW_KZ465  owner login passwords
 *   OWNER_TOKEN_SECRET               HMAC secret (auto-generated if absent)
 *
 * Static content transforms (deployed copy only — repo stays Shotbreak):
 * Cinamate landing at root, CINAMATE topbars/titles, space-navy + cyan theme.
 */
import { execSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
if (!TOKEN) { console.error('NETLIFY_AUTH_TOKEN is required'); process.exit(1); }
const SITE_NAME = process.argv[2] || 'cinamate';
const API = 'https://api.netlify.com/api/v1';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

/* ── 1. assemble the static site ───────────────────────────────────── */
const EXCLUDE = new Set(['.git', 'local-backend', 'private', 'scripts', 'netlify', 'docs',
  'local-server.py', 'package.json', 'netlify.toml', '.netlifyignore', '.firebaserc',
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
/* Root-convention icons: iMessage/Safari/scrapers fetch these paths directly,
 * so the deployed root must carry the CINAMATE versions, not Shotbreak's. */
cpSync(join(ROOT, 'assets', 'favicon.ico'), join(site, 'favicon.ico'));
cpSync(join(ROOT, 'assets', 'apple-touch-icon.png'), join(site, 'apple-touch-icon.png'));

function transform(file, pairs) {
  let s = readFileSync(file, 'utf8');
  for (const [from, to] of pairs) s = s.split(from).join(to);
  writeFileSync(file, s);
}
const STAMP = 'cm' + Date.now();
/* Brand-kit logo system (Blue Patina Edition §2): aperture icon + wordmark
 * for navigation headers; icon mark alone for favicons. */
const LOGO_IMG = '<img src="/assets/logo-mark.svg?v=' + STAMP + '" alt="" style="width:22px;height:22px;vertical-align:-5px;margin-right:9px">';
const SITE_BASE = 'https://cinamate-studio.netlify.app';
/* Social/link-preview meta (iMessage, Slack, Twitter read these) */
function ogTags(title, desc) {
  return '\n<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">' +
    '\n<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">' +
    '\n<link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png">' +
    '\n<meta property="og:site_name" content="CINAMATE">' +
    '\n<meta property="og:type" content="website">' +
    '\n<meta property="og:title" content="' + title + '">' +
    '\n<meta property="og:description" content="' + desc + '">' +
    '\n<meta property="og:image" content="' + SITE_BASE + '/assets/og-image.png">' +
    '\n<meta property="og:image:width" content="1200">' +
    '\n<meta property="og:image:height" content="630">' +
    '\n<meta name="twitter:card" content="summary_large_image">' +
    '\n<meta name="twitter:image" content="' + SITE_BASE + '/assets/og-image.png">';
}
const BRAND = [
  ['<div class="logo">SHOT<span>BREAK</span></div>', '<div class="logo">' + LOGO_IMG + 'CINA<span>MATE</span></div>'],
  ['<link rel="icon" href="/favicon.ico">', '<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg?v=' + STAMP + '">'],
];
/* CINAMATE Blue Patina Edition (brand identity toolkit 2026):
 * Deep Navy #0A1628 base, cards #12253A / Dark Lens #1A2F4A, Blue Patina
 * #8BA3B8 wordmark, Action Blue #5B8DB8 interactive, semantic teal/gold/red,
 * Cinzel display serif + Inter body. */
const THEME = [
  ['--bg:#050507;--surface:#0c0c12;--surface2:#131319;--surface3:#1a1a22;', '--bg:#0A1628;--surface:#0F1F33;--surface2:#12253A;--surface3:#1A2F4A;'],
  ['--border:rgba(255,255,255,.06);--border2:rgba(255,255,255,.1);', '--border:rgba(139,163,184,.12);--border2:rgba(139,163,184,.22);'],
  ['--gold:#d4a843;--gold2:#e8c36a;', '--gold:#5B8DB8;--gold2:#7FA8CC;'],
  ['--green:#22c55e;--blue:#60a5fa;', '--green:#4A8B7A;--blue:#5B8DB8;'],
  ['--red:#f87171;--text:#e8e8ec;--text2:#8e8e9e;--dim:#5a5a6a;', '--red:#A65D5D;--text:#E8EEF2;--text2:#A0B4C8;--dim:#6A7E94;'],
  ["--display:'Syne',sans-serif;--body:'Anybody',sans-serif;--mono:'JetBrains Mono',monospace;", "--display:'Cinzel',serif;--body:'Inter',sans-serif;--mono:'IBM Plex Mono',monospace;"],
  ['.logo span{color:var(--gold)}', '.logo span{color:#8BA3B8}'],
  ['212,168,67', '91,141,184'],
  ['#d4a843', '#5B8DB8'],
  ['#e8c36a', '#7FA8CC'],
  ['34,197,94', '74,139,122'],
  ['#22c55e', '#4A8B7A'],
  ['#f87171', '#A65D5D'],
  ['#60a5fa', '#5B8DB8'],
];
const FONTS = [['family=Syne:wght@400;600;700;800&family=Anybody:wght@400;600;700&family=JetBrains+Mono:wght@400;500',
  'family=Cinzel:wght@400;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500']];
// Cache-bust every versioned asset so browsers always fetch the new build.
const BUST = [[/\?v=[A-Za-z0-9-]+/g, '?v=cm' + Date.now()]];
function bust(file) {
  let s = readFileSync(file, 'utf8');
  for (const [re, to] of BUST) s = s.replace(re, to);
  writeFileSync(file, s);
}
transform(join(site, 'timeline/index.html'), [...BRAND, ...FONTS,
  ['<title>SHOTBREAK — Text-to-Video Movie System</title>', '<title>CINAMATE — Studio</title>' +
   ogTags('CINAMATE — Studio', 'Script-to-screen AI previsualization with cost and time priced before a frame renders.')],
  // Brand voice (Blue Patina kit): sophisticated, cinematic, collaborative
  ['<h1>Text-to-Video <span>Studio</span></h1>', '<h1>CINAMATE <span>Studio</span></h1>'],
  ['<p>Sign in to generate video. Script parsing works offline.</p>', '<p>Sign in to begin production. Script parsing works offline.</p>'],
  ['<h3>Start with a script</h3>', '<h3>Every picture begins with the page</h3>']]);
transform(join(site, 'producer/index.html'), [...BRAND, ...FONTS,
  ['<title>SHOTBREAK — Producer Suite</title>', '<title>CINAMATE — Producer Suite</title>' +
   ogTags('CINAMATE — Producer Suite', 'Budgets, schedules, tax incentives and sales forecasts calibrated to published industry rates.')]]);
/* app.html — legacy app surface: brand-kit logos, favicon, navy theme */
transform(join(site, 'app.html'), [...FONTS, ...THEME,
  ['<title>SHOTBREAK — App</title>', '<title>CINAMATE — App</title>'],
  ['<link rel="icon" type="image/x-icon" href="favicon.ico">', '<link rel="icon" type="image/svg+xml" href="assets/favicon.svg?v=' + STAMP + '">'],
  ['<link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">', '<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">'],
  ['<link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">', '<link rel="icon" type="image/png" sizes="16x16" href="assets/favicon-16.png">'],
  ['<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">', '<link rel="apple-touch-icon" sizes="180x180" href="assets/apple-touch-icon.png">'],
  ['<meta property="og:title" content="SHOTBREAK — Script to Screen">', '<meta property="og:site_name" content="CINAMATE">\n<meta property="og:title" content="CINAMATE — App">'],
  ['<meta property="og:description" content="Screenplay shot breakdown and script formatting tool for filmmakers.">', '<meta property="og:description" content="CINAMATE production app — generation, media and workflow.">'],
  ['https://shotbreak.io/og-image.png', SITE_BASE + '/assets/og-image.png'],
  ['<div class="login-logo">SHOT<span>BREAK</span></div>', '<div class="login-logo">CINA<span>MATE</span></div>'],
  ["<div class=\"logo\" onclick=\"showMode('media')\">SHOT<span>BREAK</span></div>",
   "<div class=\"logo\" onclick=\"showMode('media')\">" + LOGO_IMG + "CINA<span>MATE</span></div>"],
  ['#050507', '#0A1628'], ['#0c0c12', '#0F1F33'], ['#131319', '#12253A'], ['#1a1a22', '#1A2F4A'],
]);
/* Cache-bust the brand SVGs where the Cinamate pages reference them */
const ASSETVER = [
  ['assets/logo.svg', 'assets/logo.svg?v=' + STAMP],
  ['assets/logo-mark.svg"', 'assets/logo-mark.svg?v=' + STAMP + '"'],
  ['assets/favicon.svg', 'assets/favicon.svg?v=' + STAMP],
];
transform(join(site, 'index.html'), ASSETVER);
transform(join(site, 'cinamate/index.html'), ASSETVER);
transform(join(site, 'dashboard.html'), ASSETVER);
bust(join(site, 'timeline/index.html'));
bust(join(site, 'producer/index.html'));
transform(join(site, 'timeline/timeline.css'), THEME);
transform(join(site, 'producer/producer.css'), THEME);

/* ── 2. bundle the verify-owner function (self-contained, crypto only) ── */
const fnDir = join(work, 'fn');
mkdirSync(fnDir);
cpSync(join(ROOT, 'netlify/functions/verify-owner.js'), join(fnDir, 'verify-owner.js'));
execSync('zip -qj ' + JSON.stringify(join(work, 'verify-owner.zip')) + ' ' + JSON.stringify(join(fnDir, 'verify-owner.js')));
const fnZip = readFileSync(join(work, 'verify-owner.zip'));
const fnSha = createHash('sha256').update(fnZip).digest('hex');

/* ── 3. find or create the site ────────────────────────────────────── */
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

/* ── 4. env vars (functions scope). Only touches keys passed in env. ── */
const acct = await api('/accounts');
const accountId = Array.isArray(acct.body) && acct.body[0] && acct.body[0].id;
const wanted = {
  OWNER_PW_MZ465: process.env.OWNER_PW_MZ465,
  OWNER_PW_KZ465: process.env.OWNER_PW_KZ465,
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

/* ── 5. digest deploy: files (sha1) + functions (sha256) ───────────── */
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = {};
const bySha = {};
for (const p of walk(site)) {
  const rel = '/' + relative(site, p).split('\\').join('/');
  const sha = createHash('sha1').update(readFileSync(p)).digest('hex');
  files[rel] = sha;
  (bySha[sha] = bySha[sha] || []).push(p);
}
console.log(`Deploying ${Object.keys(files).length} files + verify-owner function`);

const dep = await api(`/sites/${siteId}/deploys`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files, functions: { 'verify-owner': fnSha } }),
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
if ((dep.body.required_functions || []).includes(fnSha)) {
  const r = await api(`/deploys/${deployId}/functions/verify-owner?runtime=js`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: fnZip });
  if (!r.ok) { console.error('Function upload failed:', r.status, r.body); process.exit(1); }
  console.log('verify-owner function uploaded');
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
