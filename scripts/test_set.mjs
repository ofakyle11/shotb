#!/usr/bin/env node
/* Node tests for sets/lib-set.js (CSet) — run: node scripts/test_set.mjs */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'sets/lib-set.js'), 'utf8'));
const S = globalThis.CSet;

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
t('fov 35mm ≈ 54.4°', Math.abs(S.fovDeg(35) - 54.4) < 0.2);
t('fov 18mm wide ≈ 90°', Math.abs(S.fovDeg(18) - 90) < 0.2);
t('fov 100mm tight ≈ 20.4°', Math.abs(S.fovDeg(100) - 20.4) < 0.3);
t('fov default on junk', S.fovDeg('x') === S.fovDeg(35));

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
