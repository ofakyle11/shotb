/* Load the real pages in a real browser and fail on anything broken.
 *
 * The security work touched page-load paths — login.html's success check,
 * js/auth.js's session handling, sw.js's caching rule, and an escaping sweep
 * across every module. Unit tests do not catch a syntax error in an inline
 * script or a template that stopped closing, so this opens each page and
 * watches for page errors, failed requests and empty renders.
 *
 * The sandbox has no internet, so requests to any external host are aborted
 * and not counted as failures — that also proves no page NEEDS one to render.
 *
 *   node scripts/smoke_pages.mjs
 */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require_('playwright');

const PORT = 8123;
const EXECUTABLE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

/* Pages worth loading: the public shell plus one page per module family. */
const PAGES = [
  '/index.html', '/login.html', '/404.html',
  '/dashboard.html',
  '/timeline/', '/editor/', '/boards/', '/projects/', '/producer/',
  '/tools/', '/production/', '/workflow/', '/writer/',
  '/props/', '/sets/', '/casting/', '/finance/', '/vfx/', '/music/',
  '/post/', '/festivals/', '/taxcredit/', '/wardrobe/', '/dailies/',
  '/investors/', '/screening/', '/safety/', '/clearance/', '/contracts/',
  '/distribution/', '/locations/', '/today/',
];

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', stop);

await new Promise((r) => setTimeout(r, 1200));

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const rows = [];

for (const path of PAGES) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  const failed = [];

  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    /* A blocked external request logs a console error that says nothing about
       our code; the request list below is the honest signal. */
    if (/net::ERR_|Failed to load resource/i.test(text)) return;
    errors.push('console: ' + text.slice(0, 160));
  });
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (!u.startsWith(`http://127.0.0.1:${PORT}`)) return;   // external: expected offline
    failed.push(u.replace(`http://127.0.0.1:${PORT}`, '') + ' — ' + (req.failure()?.errorText || '?'));
  });
  /* No internet here: cut external requests rather than waiting out timeouts. */
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://127.0.0.1:${PORT}`) || u.startsWith('data:') || u.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });

  let status = 0, bodyLen = 0, title = '';
  try {
    const res = await page.goto(`http://127.0.0.1:${PORT}${path}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 });
    status = res ? res.status() : 0;
    await page.waitForTimeout(700);           // let deferred scripts run
    bodyLen = await page.evaluate(() => document.body ? document.body.innerText.trim().length : 0);
    title = await page.title();
  } catch (e) {
    errors.push('navigation: ' + String(e.message).slice(0, 160));
  }

  rows.push({ path, status, bodyLen, title, errors, failed });
  await ctx.close();
}

await browser.close();
stop();

let bad = 0;
for (const r of rows) {
  const problems = [];
  if (r.status !== 200) problems.push('HTTP ' + r.status);
  if (r.bodyLen < 40) problems.push('page rendered almost nothing (' + r.bodyLen + ' chars)');
  for (const e of r.errors) problems.push(e);
  for (const f of r.failed) problems.push('same-origin request failed: ' + f);

  if (problems.length) {
    bad++;
    console.log(`\n  FAIL ${r.path}`);
    for (const p of problems) console.log('        ' + p);
  } else {
    console.log(`  ok   ${r.path.padEnd(22)} ${String(r.bodyLen).padStart(6)} chars   ${r.title.slice(0, 44)}`);
  }
}

console.log(`\nsmoke_pages: ${rows.length - bad}/${rows.length} pages loaded clean`);
process.exit(bad ? 1 : 0);
