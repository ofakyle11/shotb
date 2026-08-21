#!/usr/bin/env node
/* Deploy the combined Cinamate site (Studio + Producer Suite) to Netlify,
 * INCLUDING the /verify-owner login function (digest-based deploy — the
 * plain zip method cannot ship functions).
 *
 *   NETLIFY_AUTH_TOKEN=nfp_xxx node scripts/deploy_cinamate.mjs [site-name]
 *
 * Optional env (set once; existing values are left alone unless provided):
 *   OWNER_PW_MZ465 / OWNER_PW_KZ465 / OWNER_PW_HZ465  owner login passwords
 *   OWNER_TOKEN_SECRET               HMAC secret (auto-generated if absent)
 *
 * Branding lives in the repo itself (2026-08 sweep) — the only deploy-time
 * content change is a cache-bust stamp on every versioned asset reference,
 * applied to ALL html pages so no page can miss the transform list.
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

const STAMP = 'cm' + Date.now();
/* Stamp unversioned brand-asset references, then refresh every existing
 * ?v= stamp, on EVERY html page in the build. */
const ASSETVER = [
  ['assets/logo.svg"', 'assets/logo.svg?v=' + STAMP + '"'],
  ['assets/logo-mark.svg"', 'assets/logo-mark.svg?v=' + STAMP + '"'],
  ['assets/favicon.svg"', 'assets/favicon.svg?v=' + STAMP + '"'],
];
function stampAllHtml(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { stampAllHtml(p); continue; }
    if (!p.endsWith('.html')) continue;
    let s = readFileSync(p, 'utf8');
    for (const [from, to] of ASSETVER) s = s.split(from).join(to);
    s = s.replace(/\?v=[A-Za-z0-9-]+/g, '?v=' + STAMP);
    writeFileSync(p, s);
  }
}
stampAllHtml(site);

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
  OWNER_PW_HZ465: process.env.OWNER_PW_HZ465,
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
