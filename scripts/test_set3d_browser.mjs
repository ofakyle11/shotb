/* Drive the 3D set viewport in a real browser.
 *
 * A WebGL viewport that parses cleanly and renders a black rectangle passes
 * every check that does not look at pixels. This one looks at pixels: it
 * builds a set, switches to 3D, and asserts the canvas actually contains
 * geometry — then orbits, picks, looks through a lens, and exports.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node scripts/test_set3d_browser.mjs
 */
import { startServer } from './lib-testserver.mjs';
import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require_('playwright');
const EXECUTABLE = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

/* An OS-chosen port, so a second run — or twenty of them — cannot collide.
   See scripts/lib-testserver.mjs for why that matters. */
const { port: PORT } = await startServer(ROOT);

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

/* ── the frame belongs to the FORMAT, not to the browser window ──────────
   A 35mm used to read 39.1° in a 4:3 panel, 50.7° at 16:9 and 63.8° at 21:9,
   because fovY came from the aperture and `aspect` came from the canvas.
   Widening the window widened the lens. The viewport now letterboxes. */
t('the caption states the sensor it is using', /Super 35/.test(note || ''), note);

const frame0 = await page.evaluate(() => window.CSetApp.gl().lensFrame());
t('the lens frame carries the format aspect, not the panel aspect',
  Math.abs(frame0.aspect - 24.9 / 18.7) < 0.001, JSON.stringify(frame0));
t('the frame is letterboxed inside a panel of another shape', frame0.letterboxed,
  JSON.stringify(frame0));
t('the frame reports the horizontal coverage of the lens',
  Math.abs(frame0.fovX - 39.16) < 0.1, frame0.fovX);

await page.setViewportSize({ width: 1680, height: 620 });   // ~2.7:1 panel
await page.waitForTimeout(400);
await page.evaluate(() => window.CSetApp.gl().render());
const frame1 = await page.evaluate(() => window.CSetApp.gl().lensFrame());
t('widening the window does not widen the lens',
  Math.abs(frame1.fovX - frame0.fovX) < 1e-9 && Math.abs(frame1.aspect - frame0.aspect) < 1e-9,
  `${frame0.fovX}° @ ${frame0.aspect} -> ${frame1.fovX}° @ ${frame1.aspect}`);
t('a wider window becomes matte, not more coverage', frame1.width < frame1.height * 2,
  `${frame1.width}x${frame1.height}`);

const bars = await page.evaluate(() => {
  const c = document.getElementById('sdGL');
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true });
  const px = new Uint8Array(4);
  const read = (x, y) => { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return px[0] + px[1] + px[2]; };
  return { edge: read(1, Math.floor(c.height / 2)), middle: read(Math.floor(c.width / 2), Math.floor(c.height / 2)),
    culling: gl.isEnabled(gl.CULL_FACE) };
});
t('the matte outside the frame is darker than the frame', bars.edge < bars.middle,
  JSON.stringify(bars));
/* Culling is what makes a future winding error visible on screen instead of
   silently lighting every set from underneath, as it did for months. */
t('back-face culling is on', bars.culling);

await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(300);

/* ── changing the format re-answers everything at once ── */
const swapped = await page.evaluate(() => {
  document.getElementById('sdPlanSensor').value = 'fullframe';
  document.getElementById('sdPlanSensor').dispatchEvent(new Event('change'));
  return { note: document.getElementById('sdGLNote').textContent,
    frame: window.CSetApp.gl().lensFrame(),
    options: document.querySelectorAll('#sdPlanSensor option').length };
});
t('the format picker offers the whole sensor table', swapped.options === 9, swapped.options);
t('switching the plan to full frame widens the frustum',
  swapped.frame.fovX > frame0.fovX, `${frame0.fovX} -> ${swapped.frame.fovX}`);
t('and the caption follows it', /Full frame/.test(swapped.note || ''), swapped.note);
await page.evaluate(() => {
  document.getElementById('sdPlanSensor').value = 'super35';
  document.getElementById('sdPlanSensor').dispatchEvent(new Event('change'));
});
await page.waitForTimeout(200);

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

/* ── a camera is a focal length, a format and an aperture ── */
const camPanel = await page.evaluate(() => {
  const svg = document.querySelector('#sdCanvas svg');
  /* The <g> bounding box includes the coverage cone, whose centre is empty
     floor — click the camera body itself. */
  const g = svg.querySelector('[data-id="cam"] rect');
  if (!g) return { fields: ['NO CAMERA IN SVG'], text: '' };
  const b = g.getBoundingClientRect();
  svg.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2,
  }));
  return {
    fields: Array.from(document.querySelectorAll('#sdSel [data-f]')).map((i) => i.getAttribute('data-f')),
    text: document.getElementById('sdSel').textContent,
  };
});
t('a camera offers an aperture', camPanel.fields.includes('fstop'), camPanel.fields.join(','));
t('a camera offers a focus distance', camPanel.fields.includes('focus'), camPanel.fields.join(','));
t('the camera panel names the format it answered on', /Super 35/.test(camPanel.text), camPanel.text);
t('the camera panel reports the sharp band', /Sharp .*hyperfocal/.test(camPanel.text), camPanel.text);
const planText = await page.evaluate(() => document.querySelector('#sdCanvas svg').textContent);
t('the drawing itself states the format it was drawn for', /Super 35/.test(planText), planText);

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

/* ── the props half: size, scale preview, and placement onto the set ── */
{
  const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pp = await pctx.newPage();
  const perr = [];
  pp.on('pageerror', (e) => perr.push(String(e.message)));
  pp.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/net::ERR_|Failed to load resource/i.test(m.text())) return;
    perr.push('console: ' + m.text());
  });
  await pp.route('**/*', (r) => (r.request().url().startsWith(`http://127.0.0.1:${PORT}`)
    ? r.continue() : r.abort()));

  await pp.addInitScript(() => {
    localStorage.setItem('SB_Props_v1', JSON.stringify({
      v: 1, items: [
        { id: 'p1', name: 'Upright piano', cat: 'specialty', scenes: [4], qty: 1, mode: 'auto' },
        { id: 'p2', name: 'Pocket watch', cat: 'handprop', scenes: [12], qty: 1, mode: 'auto' },
      ],
    }));
    localStorage.setItem('SB_SetDesign_v1', JSON.stringify({
      v: 1, active: 'sp1',
      plans: [{ id: 'sp1', name: 'Stage A', w: 24, h: 18, scenes: '', items: [] }],
    }));
  });

  await pp.goto(`http://127.0.0.1:${PORT}/props/`, { waitUntil: 'domcontentloaded' });
  await pp.waitForTimeout(700);
  t('the props page loads clean', perr.length === 0, perr.slice(0, 2).join(' | '));

  const sizes = await pp.$$eval('[data-size]', (b) => b.map((x) => x.textContent));
  t('every prop shows a size', sizes.length === 2, JSON.stringify(sizes));
  t('a piano is bigger than a pocket watch',
    parseFloat(sizes[0]) > parseFloat(sizes[1]), JSON.stringify(sizes));

  /* the scale preview must actually draw */
  await pp.click('[data-size="p1"]');
  await pp.waitForTimeout(900);
  const shown = await pp.evaluate(() =>
    !document.getElementById('ppSizeWrap').classList.contains('pp-hide'));
  t('clicking a size opens the scale preview', shown);
  const drew = await pp.evaluate(() => {
    const c = document.getElementById('ppSizeGL');
    const gl = c.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) return -1;
    const buf = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let lit = 0;
    for (let i = 0; i < buf.length; i += 4) if (buf[i] + buf[i + 1] + buf[i + 2] > 120) lit++;
    return lit;
  });
  t('the scale preview renders the prop and the figure', drew > 400, drew);
  const fitNote = await pp.textContent('#ppSizeNote');
  t('the preview answers the doorway question', /doorway/i.test(fitNote || ''), fitNote);

  /* placing writes into the Set Designer's own store */
  await pp.click('[data-place="p1"]');
  await pp.waitForTimeout(300);
  const placed = await pp.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('SB_SetDesign_v1'));
    return doc.plans[0].items;
  });
  t('placing a prop adds it to the set plan', placed.length === 1, JSON.stringify(placed));
  t('the placed item carries the prop name', placed[0] && placed[0].label === 'Upright piano');
  t('the placed item carries real dimensions',
    placed[0] && placed[0].w > 0 && placed[0].hgt > 0, JSON.stringify(placed[0]));
  t('the placed item is tied back to the prop', placed[0] && placed[0].propId === 'p1');

  /* placing twice should move it, not litter the stage */
  await pp.click('[data-place="p1"]');
  await pp.waitForTimeout(300);
  const again = await pp.evaluate(() =>
    JSON.parse(localStorage.getItem('SB_SetDesign_v1')).plans[0].items.length);
  t('placing the same prop twice does not duplicate it', again === 1, again);

  /* and the Set Designer must render what props wrote */
  const sp = await pctx.newPage();
  await sp.route('**/*', (r) => (r.request().url().startsWith(`http://127.0.0.1:${PORT}`)
    ? r.continue() : r.abort()));
  await sp.goto(`http://127.0.0.1:${PORT}/sets/`, { waitUntil: 'domcontentloaded' });
  await sp.waitForTimeout(500);
  const inSet = await sp.evaluate(() =>
    !!document.querySelector('#sdCanvas svg [data-id^="prop_"]'));
  t('the Set Designer draws the placed prop', inSet);

  t('the props run produced no script errors', perr.length === 0, perr.slice(0, 3).join(' | '));
  await pctx.close();
}

t('still no script errors after the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
try { server.kill('SIGKILL'); } catch {}
console.log(`test_set3d_browser: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
