/* Drive the 3D set viewport in a real browser.
 *
 * A WebGL viewport that parses cleanly and renders a black rectangle passes
 * every check that does not look at pixels. This one looks at pixels: it
 * builds a set, switches to 3D, and asserts the canvas actually contains
 * geometry — then orbits, picks, looks through a lens, and exports.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node scripts/test_set3d_browser.mjs
 */
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require_('playwright');
const PORT = 8124;
const EXECUTABLE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
process.on('exit', () => { try { server.kill('SIGKILL'); } catch {} });
await new Promise((r) => setTimeout(r, 1200));

/* SwiftShader gives a real GL implementation with no GPU, which is what a CI
   box has. Without it the context request simply fails and the test would be
   measuring nothing. */
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`  x ${name}${detail !== undefined ? ': ' + detail : ''}`); }
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  /* The route below aborts every external request — there is no internet in
     the sandbox — and each one logs a resource error that says nothing about
     our code. */
  if (/net::ERR_|Failed to load resource/i.test(m.text())) return;
  errors.push('console: ' + m.text());
});
await page.route('**/*', (r) => (r.request().url().startsWith(`http://127.0.0.1:${PORT}`)
  ? r.continue() : r.abort()));

/* Seed a set worth looking at, before the page reads storage. */
await page.addInitScript(() => {
  const plan = {
    id: 'p1', name: 'Stage A — Kitchen', w: 24, h: 18, scenes: '4, 12',
    items: [
      { id: 'w1', type: 'wall', x: 12, y: 0.5, w: 24, h: 0.5, rot: 0, label: 'Back wall' },
      { id: 'w2', type: 'wall', x: 0.5, y: 9, w: 18, h: 0.5, rot: 90, label: 'Stage left' },
      { id: 'd1', type: 'door', x: 6, y: 0.5, w: 3, h: 0.5, rot: 0, label: 'Practical door' },
      { id: 't1', type: 'table', x: 12, y: 9, w: 5, h: 3, rot: 0, label: 'Kitchen table' },
      { id: 'c1', type: 'chair', x: 12, y: 6.5, w: 1.6, h: 1.6, rot: 180, label: '' },
      { id: 'sf', type: 'sofa', x: 18, y: 13, w: 7, h: 3, rot: 0, label: '' },
      { id: 'pm', type: 'person', x: 10, y: 8, w: 1.2, h: 1.2, rot: 0, label: 'Marker A' },
      { id: 'cam', type: 'camera', x: 12, y: 16, w: 1.6, h: 1.6, rot: 0, lens: 35, label: 'A cam' },
    ],
  };
  localStorage.setItem('SB_SetDesign_v1', JSON.stringify({ v: 1, active: 'p1', plans: [plan] }));
});

await page.goto(`http://127.0.0.1:${PORT}/sets/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

t('the page loaded with no script error', errors.length === 0, errors.slice(0, 2).join(' | '));
t('the 2D plan still renders', await page.locator('#sdCanvas svg').count() > 0);

/* ── switch to 3D and check the canvas has real content ── */
await page.click('#sdView3d');
await page.waitForTimeout(900);

const glReady = await page.evaluate(() => {
  const c = document.getElementById('sdGL');
  return !!(c && c.width > 0 && c.getContext('webgl'));
});
t('a WebGL context exists', glReady);

/* Sample the canvas. A working render has many distinct colours; a failed one
   is a single flat clear colour, or nothing at all. */
const pixels = await page.evaluate(() => {
  const c = document.getElementById('sdGL');
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) return null;
  const w = c.width, h = c.height;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const seen = new Set();
  let lit = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const key = (buf[i] >> 3) + ',' + (buf[i + 1] >> 3) + ',' + (buf[i + 2] >> 3);
    seen.add(key);
    /* the clear colour is the app's dark base; anything brighter is drawn */
    if (buf[i] + buf[i + 1] + buf[i + 2] > 120) lit++;
  }
  return { distinct: seen.size, lit, total: w * h };
});

t('the 3D canvas produced pixels', pixels !== null);
if (pixels) {
  t('the render is not a flat empty frame', pixels.distinct > 12, `${pixels.distinct} distinct colours`);
  t('geometry covers a real part of the frame',
    pixels.lit > pixels.total * 0.02, `${(pixels.lit / pixels.total * 100).toFixed(1)}% lit`);
}

/* ── orbiting must change the image ── */
const before = await page.evaluate(() => document.getElementById('sdGL').toDataURL().length);
await page.mouse.move(640, 420);
await page.mouse.down();
await page.mouse.move(820, 460, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.evaluate(() => document.getElementById('sdGL').toDataURL().length);
t('dragging orbits the view', before !== after, `${before} -> ${after}`);

/* ── look through the lens ── */
await page.click('#sdLook');
await page.waitForTimeout(500);
const note = await page.textContent('#sdGLNote');
t('look-through names the lens', /35mm/.test(note || ''), note);
t('look-through reports the real field of view', /\d+(\.\d+)?°/.test(note || ''), note);

const lensPixels = await page.evaluate(() => {
  const c = document.getElementById('sdGL');
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true });
  const buf = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let lit = 0;
  for (let i = 0; i < buf.length; i += 4) if (buf[i] + buf[i + 1] + buf[i + 2] > 120) lit++;
  return lit;
});
t('the lens view renders the set', lensPixels > 500, lensPixels);

await page.click('#sdLook');            // back to orbit
await page.waitForTimeout(300);

/* ── selection round-trips between the two views ── */
await page.evaluate(() => {
  const svg = document.querySelector('#sdCanvas svg');
  return svg && svg.getBoundingClientRect();
});
const selWorks = await page.evaluate(() => {
  /* pick straight down the middle of the frame and see whether anything
     under the cursor gets selected */
  const c = document.getElementById('sdGL');
  const r = c.getBoundingClientRect();
  const ev = new MouseEvent('click', {
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true,
  });
  c.dispatchEvent(ev);
  return document.getElementById('sdSel').textContent;
});
t('clicking in 3D updates the selection panel',
  typeof selWorks === 'string' && selWorks.length > 0);

/* ── the new fields exist and are the right kind ── */
await page.evaluate(() => {
  const svg = document.querySelector('#sdCanvas svg');
  const el = svg && svg.querySelector('[data-id="t1"]');
  if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
});
await page.click('#sdView2d');
await page.waitForTimeout(200);
const fields = await page.evaluate(() => {
  /* Click the kitchen table by finding where it actually got drawn. The
     page scales pixels-per-foot to fit the viewport, so assuming a fixed
     scale picks empty floor and selects nothing. */
  const svg = document.querySelector('#sdCanvas svg');
  const g = svg.querySelector('[data-id="t1"]');
  if (!g) return ['NO TABLE IN SVG'];
  const b = g.getBoundingClientRect();
  svg.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2,
  }));
  return Array.from(document.querySelectorAll('#sdSel [data-f]')).map((i) => i.getAttribute('data-f'));
});
t('the selection panel offers a height field', fields.includes('hgt'), fields.join(','));
t('the selection panel offers an off-floor field', fields.includes('z'), fields.join(','));
t('the selection panel offers a colour field', fields.includes('color'), fields.join(','));

/* ── exports produce real files ── */
const exports_ = await page.evaluate(() => {
  const plan = JSON.parse(localStorage.getItem('SB_SetDesign_v1')).plans[0];
  const obj = window.CSet3D.toOBJ(plan, plan.name);
  const stl = window.CSet3D.toSTL(plan, plan.name);
  return {
    objV: (obj.match(/^v /gm) || []).length,
    objF: (obj.match(/^f /gm) || []).length,
    objGroups: (obj.match(/^g /gm) || []).length,
    stlFacets: (stl.match(/facet normal/g) || []).length,
    objNaN: /NaN/.test(obj), stlNaN: /NaN/.test(stl),
  };
});
t('OBJ export has geometry', exports_.objV > 100 && exports_.objF > 20, JSON.stringify(exports_));
t('OBJ keeps one group per piece', exports_.objGroups === 8, exports_.objGroups);
t('STL export has facets', exports_.stlFacets > 40, exports_.stlFacets);
t('no NaN reached either export', !exports_.objNaN && !exports_.stlNaN);

t('still no script errors after the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
try { server.kill('SIGKILL'); } catch {}
console.log(`test_set3d_browser: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
