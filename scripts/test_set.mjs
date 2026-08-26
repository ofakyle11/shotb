#!/usr/bin/env node
/* Node tests for sets/lib-set.js (CSet) — run: node scripts/test_set.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/* Load order matters: TMedia carries THE sensor table, and both set modules
   read their format out of it. */
(0, eval)(readFileSync(join(ROOT, 'tools/lib-media.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'sets/lib-set.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'sets/lib-set3d.js'), 'utf8'));
const S = globalThis.CSet, S3 = globalThis.CSet3D, M = globalThis.TMedia;

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗', name); }
}

/* ── model ── */
const doc = S.newDoc();
t('newDoc has one active plan', doc.plans.length === 1 && doc.active === doc.plans[0].id);
const p = doc.plans[0];
t('default stage is 24×18 ft', p.w === 24 && p.h === 18);
const p2 = S.newPlan(doc, 'Set 2', 30, 20);
t('newPlan appends', doc.plans.length === 2 && p2.w === 30);

const table = S.addItem(p, 'table', 10, 8);
t('addItem uses stencil size', table.w === 5 && table.h === 3);
t('addItem snaps position', table.x === 10 && table.y === 8);
const cam = S.addItem(p, 'camera', 5, 5);
t('camera carries a lens', cam.lens === 35);
const odd = S.addItem(p, 'chair', 7.24, 3.81);
t('positions snap to half-foot', odd.x === 7 && odd.y === 4);
t('unknown type falls back to custom', S.addItem(p, 'nope', 20, 15).w === S.STENCILS.custom.w);
t('itemById finds', S.itemById(p, table.id) === table);
t('itemById miss → null', S.itemById(p, 'zz') === null);

/* ── snap / fov ── */
t('snap default half-foot', S.snap(3.74) === 3.5 && S.snap(3.76) === 4);
t('snap custom grid', S.snap(7.3, 1) === 7);
/* ── the lens, pinned to the format ──────────────────────────────────────
   These four numbers used to say full frame — 54.4° at 35mm — while
   scripts/test_set3d.mjs pinned the same lens to Super 35 at 39.2°. Both
   suites passed, so the suite itself certified the contradiction and fixing
   either file alone turned the run red. THE TWO PINS MOVE TOGETHER, in one
   change, or not at all; the agreement assertions below are what enforce
   that from here on, so a future edit to one sensor cannot pass while the
   other stays behind. Values are Super 35, 24.9mm wide, from TMedia.SENSORS. */
t('fov 35mm ≈ 39.2° on Super 35', Math.abs(S.fovDeg(35) - 39.2) < 0.2);
t('fov 18mm wide ≈ 69.3°', Math.abs(S.fovDeg(18) - 69.3) < 0.2);
t('fov 100mm tight ≈ 14.2°', Math.abs(S.fovDeg(100) - 14.2) < 0.3);
t('fov default on junk', S.fovDeg('x') === S.fovDeg(35));
t('a named format overrides the default', Math.abs(S.fovDeg(35, 'fullframe') - 54.4) < 0.2);
t('an unknown format falls back to the default', S.fovDeg(35, 'nope') === S.fovDeg(35));
t('vertical is narrower than horizontal', S.fovDegV(35) < S.fovDeg(35));

/* The three implementations that used to disagree, asked the same question. */
for (const mm of [18, 25, 35, 50, 85, 100]) {
  t(`2D cone and 3D frustum agree at ${mm}mm`,
    Math.abs(S.fovDeg(mm) - S3.lensFov(mm, false)) < 0.05, S.fovDeg(mm) + ' vs ' + S3.lensFov(mm, false));
  t(`the plan and the sensor table agree at ${mm}mm`,
    Math.abs(S.fovDeg(mm) - M.lensCalc('super35', mm).hfov) < 0.05);
}
t('the fallback sensor is a copy of the shared table, not a fourth opinion',
  S.FALLBACK_SENSOR.w === M.SENSORS.super35.w && S.FALLBACK_SENSOR.h === M.SENSORS.super35.h &&
  S.FALLBACK_SENSOR.label === M.SENSORS.super35.label);
t('every format in the table is answerable', M.sensorList().every((s) => S.fovDeg(35, s.key) > 0));
t('a bigger sensor is a wider view at the same focal length',
  S.fovDeg(35, 'alexa-65') > S.fovDeg(35, 'super35') && S.fovDeg(35, 'super35') > S.fovDeg(35, 's16'));

/* ── the plan carries its format ── */
t('a new plan carries a format', S.planSensor(p).key === 'super35');
t('planSensor names the sensor it used', /Super 35/.test(S.planSensor(p).label));
t('a plan saved before the field existed still answers', S.planSensor({ w: 1, h: 1 }).key === 'super35');
t('sensorOf resolves a key against the shared table',
  S.sensorOf('s16').w === M.SENSORS.s16.w && S.sensorOf('s16').label === M.SENSORS.s16.label);
t('sensorOf falls back rather than returning nothing', S.sensorOf(null).key === 'super35');
t('switching a plan to full frame widens every cone', (function () {
  const wide = { w: 24, h: 18, sensor: 'fullframe', items: [] };
  return S.fovDeg(35, wide.sensor) > S.fovDeg(35, p.sensor);
})());

/* ── depth of field ── */
t('a camera stencil ships an aperture', S.STENCILS.camera.fstop === 2.8);
t('focus defaults to a sane distance with nothing marked',
  S.focusFor({ items: [] }, { x: 0, y: 0, rot: 0 }) === 12);
t('focus finds the nearest blocking mark the camera is pointed at', (function () {
  const pl = { w: 24, h: 18, items: [
    { id: 'a', type: 'person', x: 12, y: 6 },
    { id: 'b', type: 'person', x: 12, y: 10 }] };
  return S.focusFor(pl, { x: 12, y: 16, rot: 0 }) === 6;    // the near one, in front
})());
t('a mark behind the camera is not what it is focused on', (function () {
  const pl = { w: 24, h: 18, items: [{ id: 'a', type: 'person', x: 12, y: 17 }] };
  return S.focusFor(pl, { x: 12, y: 16, rot: 0 }) === 12;   // behind → the fallback
})());
t('an explicit focus wins', S.focusFor({ items: [] }, { x: 0, y: 0, rot: 0, focus: 7 }) === 7);
{
  const pl = { w: 24, h: 18, sensor: 'super35', items: [] };
  const cam = { id: 'c', type: 'camera', x: 12, y: 16, rot: 0, lens: 35, fstop: 2.8, focus: 8 };
  const band = S.dofFor(pl, cam);
  t('depth of field brackets the focus distance', band.near < 8 && band.far > 8,
    `${band.near}–${band.far}`);
  const open = S.dofFor(pl, { ...cam, fstop: 1.4 });
  t('opening up shortens the sharp band', (open.far - open.near) < (band.far - band.near),
    `${open.far - open.near} vs ${band.far - band.near}`);
  const stopped = S.dofFor(pl, { ...cam, fstop: 22, focus: 30 });
  t('stopped down past the hyperfocal, the far limit is infinity', stopped.far === Infinity);
  t('hyperfocal is reported in feet', band.hyperfocal > 30 && band.hyperfocal < 200, band.hyperfocal);
  /* The DP's rule, stated the way it is actually true: a larger format is
     shallower at the SAME FRAMING, because it needs a longer lens to get
     there. At the same focal length it is very slightly deeper, since the
     only thing that changed is the circle of confusion. */
  const same = S.dofFor({ ...pl, sensor: 'fullframe' }, { ...cam, lens: 35 * 36 / 24.9 });
  t('a larger format is shallower at matched framing',
    (same.far - same.near) < (band.far - band.near), `${same.far - same.near} vs ${band.far - band.near}`);
  t('matched framing really is matched',
    Math.abs(S.fovDeg(35 * 36 / 24.9, 'fullframe') - S.fovDeg(35, 'super35')) < 0.1);
}
t('the sharp band is drawn on the plan', (function () {
  const pl = S.newPlan(doc, 'DOF', 24, 18);
  const c = S.addItem(pl, 'camera', 12, 16);
  c.focus = 8;
  const out = S.toSVG(pl, 8, {});
  doc.plans = doc.plans.filter((x) => x !== pl);
  return out.indexOf('rgba(201,168,108,.55)') > 0;
})());

/* ── hit test ── */
t('hitTest center of table', S.hitTest(p, 10, 8) === table);
t('hitTest empty space → null', S.hitTest(p, 2, 16) === null);
t('hitTest picks topmost (later item)', (function () {
  const a = S.addItem(p, 'rug', 15, 10);
  const b = S.addItem(p, 'chair', 15, 10);
  const hit = S.hitTest(p, 15, 10);
  S.removeItem(p, a.id); S.removeItem(p, b.id);
  return hit === b;
})());
t('hitTest respects rotation', (function () {
  const w = S.addItem(p, 'wall', 12, 12);   // 10ft × 0.5ft
  w.rot = 90;                               // now tall, not wide
  const endOn = S.hitTest(p, 12, 12 + 4.5) === w;   // along rotated length
  const sideMiss = S.hitTest(p, 12 + 4.5, 12) !== w; // where it would be unrotated
  S.removeItem(p, w.id);
  return endOn && sideMiss;
})());

/* ── remove ── */
const rm = S.addItem(p, 'plant');
t('removeItem true on hit', S.removeItem(p, rm.id) === true);
t('removeItem false on miss', S.removeItem(p, 'zz') === false);

/* ── svg ── */
const svg = S.toSVG(p, 8, { sel: table.id });
t('svg has viewBox sized to plan', svg.indexOf('viewBox="0 0 ' + p.w * 8 + ' ' + p.h * 8 + '"') > 0);
t('svg carries data-id for picking', svg.indexOf('data-id="' + table.id + '"') > 0);
t('selected item drawn in brass', svg.indexOf('#C9A86C') > 0);
t('camera cone drawn', svg.indexOf('stroke-dasharray="4 3"') > 0);
t('scale bar labelled', svg.indexOf('>5 ft<') > 0);
t('plan name + size in title', svg.indexOf('24′ × 18′') > 0);
const light = S.addItem(p, 'light', 3, 3);
const svg2 = S.toSVG(p, 8, {});
t('light throw drawn', svg2.indexOf('rgba(201,168,108,.10)') > 0);
S.removeItem(p, light.id);
t('svg escapes labels', (function () {
  const x = S.addItem(p, 'custom', 4, 4);
  x.label = 'A<B&"C"';
  const out = S.toSVG(p, 8, {});
  S.removeItem(p, x.id);
  return out.indexOf('A&lt;B&amp;&quot;C&quot;') > 0 && out.indexOf('A<B') < 0;
})());

console.log(`test_set: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
