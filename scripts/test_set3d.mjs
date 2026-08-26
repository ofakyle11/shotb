/* The 3D set engine, checked without a browser.
 *
 * Projection and orbit maths is exactly the kind of code that looks right and
 * renders a black screen, so it lives in a DOM-free module and is tested
 * here. Geometry is checked by measuring the meshes it produces — a wall that
 * is ten feet tall should have vertices at y=0 and y=10, and nothing should
 * ever be below the floor.
 *
 * Run: node scripts/test_set3d.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
(0, eval)(readFileSync(join(ROOT, 'sets/lib-set3d.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'sets/lib-set.js'), 'utf8'));
const S3 = globalThis.CSet3D, S = globalThis.CSet;

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`  x ${name}${detail !== undefined ? ': ' + detail : ''}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ── the engine must stand a plan the 2D designer already made ── */
const doc = S.newDoc();
const plan = doc.plans[0];
S.addItem(plan, 'wall', 5, 2);
S.addItem(plan, 'table', 10, 8);
S.addItem(plan, 'camera', 4, 14);

const scene = S3.buildScene(plan);
t('every item becomes a mesh', scene.meshes.length === 3, scene.meshes.length);
t('the scene reports the plan bounds', scene.bounds.w === plan.w && scene.bounds.d === plan.h);

/* ── geometry sanity ── */
const allY = [];
scene.meshes.forEach((m) => m.quads.forEach((q) => q.forEach((p) => allY.push(p[1]))));
t('nothing sits below the floor', Math.min(...allY) >= -1e-9, Math.min(...allY));

const wall = scene.meshes.find((m) => m.type === 'wall');
const wallTop = Math.max(...wall.quads.flat().map((p) => p[1]));
t('a wall stands at its default height', near(wallTop, S3.PROFILES.wall.h), wallTop);
t('a wall is a closed box (6 faces)', wall.quads.length === 6, wall.quads.length);

const table = scene.meshes.find((m) => m.type === 'table');
t('a table is a top plus four legs, not a crate', table.quads.length > 6, table.quads.length);
const legBottom = Math.min(...table.quads.flat().map((p) => p[1]));
t('the legs reach the floor', near(legBottom, 0), legBottom);

/* ── per-item overrides ── */
{
  const it = S.addItem(plan, 'wall', 2, 2);
  it.hgt = 16; it.z = 0; it.color = '#123456';
  const m = S3.itemMesh(it, 16);
  t('a per-item height is honoured', near(Math.max(...m.quads.flat().map((p) => p[1])), 16));
  t('a per-item colour is honoured', m.color === '#123456', m.color);
  it.hgt = -5;
  t('a nonsense height falls back to the profile', S3.heightOf(it) === S3.PROFILES.wall.h);
  it.hgt = 16;

  const win = S.addItem(plan, 'window', 6, 2);
  t('a window is raised off the floor by default', S3.elevationOf(win) > 0, S3.elevationOf(win));
  plan.items = plan.items.filter((x) => x !== it && x !== win);
}

/* ── rotation actually rotates ── */
{
  const a = S3.itemMesh({ id: 'a', type: 'custom', x: 0, y: 0, w: 4, h: 1, rot: 0 }, 10);
  const b = S3.itemMesh({ id: 'b', type: 'custom', x: 0, y: 0, w: 4, h: 1, rot: 90 }, 10);
  const spanX = (m) => {
    const xs = m.quads.flat().map((p) => p[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  const spanZ = (m) => {
    const zs = m.quads.flat().map((p) => p[2]);
    return Math.max(...zs) - Math.min(...zs);
  };
  t('unrotated, the long side runs along X', near(spanX(a), 4) && near(spanZ(a), 1));
  t('rotated 90°, the long side runs along Z', near(spanX(b), 1, 1e-6) && near(spanZ(b), 4, 1e-6),
    `${spanX(b)} x ${spanZ(b)}`);
}

/* ── matrix maths ── */
{
  const I = S3.mat4();
  const p = S3.perspective(60, 16 / 9, 0.1, 500);
  t('identity times a matrix is that matrix',
    S3.multiply(I, p).every((v, i) => near(v, p[i])));

  /* A point straight ahead must land in the middle of the screen. */
  const eye = [0, 5, 20], target = [0, 5, 0];
  const view = S3.lookAt(eye, target, [0, 1, 0]);
  const mvp = S3.multiply(p, view);
  const project = (pt) => {
    const x = mvp[0] * pt[0] + mvp[4] * pt[1] + mvp[8] * pt[2] + mvp[12];
    const y = mvp[1] * pt[0] + mvp[5] * pt[1] + mvp[9] * pt[2] + mvp[13];
    const w = mvp[3] * pt[0] + mvp[7] * pt[1] + mvp[11] * pt[2] + mvp[15];
    return [x / w, y / w];
  };
  const centre = project([0, 5, 0]);
  t('a point dead ahead projects to screen centre',
    near(centre[0], 0, 1e-6) && near(centre[1], 0, 1e-6), centre.join(','));
  const right = project([5, 5, 0]);
  t('a point to the right projects right of centre', right[0] > 0.05, right[0]);
  const up = project([0, 12, 0]);
  t('a point above projects above centre', up[1] > 0.05, up[1]);

  /* Looking straight down must not produce a degenerate basis. */
  const down = S3.lookAt([0, 30, 0], [0, 0, 0], [0, 1, 0]);
  t('looking straight down still yields a finite matrix', down.every((v) => isFinite(v)));
}

/* ── orbit camera ── */
{
  const target = [10, 0, 10];
  const e0 = S3.orbitEye(target, 30, 0, 0);
  t('at yaw 0 the camera sits on +Z of the target', near(e0[0], 10) && near(e0[2], 40), e0.join(','));
  const e90 = S3.orbitEye(target, 30, 90, 0);
  t('at yaw 90 it has swung to +X', near(e90[0], 40, 1e-6), e90.join(','));
  const eUp = S3.orbitEye(target, 30, 0, 45);
  t('pitch raises the camera', eUp[1] > 20, eUp[1]);
  const ePole = S3.orbitEye(target, 30, 0, 100);
  t('pitch is clamped short of the pole', ePole[1] < 30 && isFinite(ePole[1]), ePole[1]);
  const dist = Math.hypot(e90[0] - target[0], e90[1] - target[1], e90[2] - target[2]);
  t('orbit preserves the distance', near(dist, 30, 1e-6), dist);
}

/* ── lens fields of view: the whole reason this module exists ── */
{
  /* Known values for Super 35: a 50mm is roughly 27.9° horizontally, an 18mm
     roughly 69.4°. If these drift, every "what does camera A see" answer is
     wrong, which is worse than not offering the feature. */
  t('a 50mm reads about 28° horizontal', Math.abs(S3.lensFov(50, false) - 27.9) < 0.6,
    S3.lensFov(50, false).toFixed(2));
  t('an 18mm reads about 69° horizontal', Math.abs(S3.lensFov(18, false) - 69.4) < 1.0,
    S3.lensFov(18, false).toFixed(2));
  t('a longer lens is always narrower', S3.lensFov(85, false) < S3.lensFov(35, false));
  t('vertical is narrower than horizontal', S3.lensFov(35, true) < S3.lensFov(35, false));
  t('a missing lens falls back to 35mm', near(S3.lensFov(undefined, false), S3.lensFov(35, false)));
  t('a nonsense lens falls back too', near(S3.lensFov(-3, false), S3.lensFov(35, false)));

  const cam = { id: 'c1', type: 'camera', x: 6, y: 4, rot: 0, lens: 35 };
  const v = S3.cameraView(cam);
  /* The 2D plan draws the cone toward -y at rot 0 — up the page — so the
     3D facing must be -Z. Asserting +Z here is what caught the sign error in
     both rotY and cameraView: the 3D view was a mirror of the plan. */
  t('a camera at rot 0 looks up the page (-Z), matching the 2D cone',
    v.target[2] < v.eye[2], `${v.eye[2]} -> ${v.target[2]}`);
  t('camera eye height is off the floor', v.eye[1] > 3, v.eye[1]);
  const v90 = S3.cameraView({ ...cam, rot: 90 });
  t('rotating the camera 90° swings it to +X', v90.target[0] > v90.eye[0] + 5,
    `${v90.eye[0]} -> ${v90.target[0]}`);
  t('the view carries the lens through', v.lens === 35);
}

/* ── picking ── */
{
  const one = [S3.itemMesh({ id: 'box1', type: 'custom', x: 0, y: 0, w: 4, h: 4, rot: 0 }, 10)];
  const hit = S3.pick(one, [0, 1.5, 20], [0, 0, -1]);
  t('a ray straight at a box hits it', hit && hit.id === 'box1', JSON.stringify(hit));
  t('the hit reports a sensible distance', hit && hit.distance > 15 && hit.distance < 20, hit && hit.distance);
  t('a ray pointing away misses', S3.pick(one, [0, 1.5, 20], [0, 0, 1]) === null);
  t('a ray beside it misses', S3.pick(one, [50, 1.5, 20], [0, 0, -1]) === null);

  /* Nearest wins, which is what makes clicking feel right. */
  const two = [
    S3.itemMesh({ id: 'far', type: 'custom', x: 0, y: -10, w: 4, h: 4, rot: 0 }, 10),
    S3.itemMesh({ id: 'near', type: 'custom', x: 0, y: 10, w: 4, h: 4, rot: 0 }, 10)
  ];
  const nearest = S3.pick(two, [0, 1.5, 30], [0, 0, -1]);
  t('the nearer object wins the pick', nearest && nearest.id === 'near', JSON.stringify(nearest));
}

/* ── screen ray ── */
{
  const eye = [0, 5, 20], target = [0, 5, 0];
  const centre = S3.screenRay(400, 300, 800, 600, eye, target, 60, 0.1, 500);
  t('a ray through screen centre points at the target',
    near(centre.dir[0], 0, 1e-6) && near(centre.dir[2], -1, 1e-6), centre.dir.join(','));
  const rightRay = S3.screenRay(700, 300, 800, 600, eye, target, 60, 0.1, 500);
  t('a ray through the right of the screen points right', rightRay.dir[0] > 0.1, rightRay.dir[0]);
  const upRay = S3.screenRay(400, 100, 800, 600, eye, target, 60, 0.1, 500);
  t('a ray through the top points up', upRay.dir[1] > 0.1, upRay.dir[1]);
  t('ray directions are unit length', near(Math.hypot(...centre.dir), 1, 1e-6));

  /* Click on a box in screen space and select it — the whole interaction. */
  const meshes = [S3.itemMesh({ id: 'target', type: 'custom', x: 0, y: 0, w: 6, h: 6, rot: 0 }, 10)];
  const r = S3.screenRay(400, 300, 800, 600, [0, 3, 25], [0, 3, 0], 60, 0.1, 500);
  t('a centre click selects the box under it',
    (S3.pick(meshes, r.origin, r.dir) || {}).id === 'target');
}

/* ── triangulation for the renderer ── */
{
  const tri = S3.triangulate(scene.meshes);
  t('every quad becomes two triangles',
    tri.count === scene.meshes.reduce((n, m) => n + m.quads.length * 6, 0), tri.count);
  t('positions and normals line up', tri.normals.length === tri.positions.length);
  t('every vertex has a colour', tri.colors.length === tri.count * 4);
  t('all normals are unit length', (() => {
    for (let i = 0; i < tri.normals.length; i += 3) {
      const l = Math.hypot(tri.normals[i], tri.normals[i + 1], tri.normals[i + 2]);
      if (l > 1e-6 && Math.abs(l - 1) > 1e-4) return false;
    }
    return true;
  })());
  t('no coordinate is NaN', !Array.from(tri.positions).some((v) => !isFinite(v)));
}

/* ── colours ── */
{
  t('a 6-digit hex parses', S3.hexToRgb('#8BA3B8').every((v) => v >= 0 && v <= 1));
  t('an 8-digit hex carries alpha through', near(S3.hexToRgb('#43506080')[3], 128 / 255, 0.01));
  t('a broken colour falls back rather than producing NaN',
    S3.hexToRgb('nonsense').every((v) => isFinite(v)));
}

/* ── export ── */
{
  const obj = S3.toOBJ(plan, 'Test Set');
  t('OBJ declares vertices and faces', /^v /m.test(obj) && /^f /m.test(obj));
  t('OBJ face indices are 1-based', /^f 1 2 3 4$/m.test(obj));
  t('OBJ says what the units are', /units: feet/.test(obj));
  const vCount = (obj.match(/^v /gm) || []).length;
  const fCount = (obj.match(/^f /gm) || []).length;
  t('OBJ has four vertices per face', vCount === fCount * 4, `${vCount} v / ${fCount} f`);

  const stl = S3.toSTL(plan, 'Test Set');
  t('STL is a well-formed solid', /^solid /.test(stl) && /endsolid\s*$/.test(stl));
  t('STL facet and endfacet counts match',
    (stl.match(/facet normal/g) || []).length === (stl.match(/endfacet/g) || []).length);
  t('STL has three vertices per facet',
    (stl.match(/vertex /g) || []).length === (stl.match(/facet normal/g) || []).length * 3);
  t('no NaN reached either export', !/NaN/.test(obj) && !/NaN/.test(stl));

  /* A hostile plan name must not break out of the format. */
  const nasty = S3.toOBJ(plan, 'evil\nv 0 0 0\nf 1 1 1');
  t('a newline in the name cannot inject geometry',
    !/^v 0 0 0$/m.test(nasty.split('\n').slice(0, 4).join('\n')));
}

/* ── an empty or malformed plan must not throw ── */
{
  t('an empty plan builds nothing, safely', S3.buildScene({ items: [] }).meshes.length === 0);
  t('a null plan is handled', S3.buildScene(null).meshes.length === 0);
  const junk = S3.itemMesh({ id: 'j', type: 'nope', x: 'x', y: null, w: 0, h: undefined, rot: 'r' }, 10);
  t('a junk item still produces finite geometry',
    junk.quads.flat().every((p) => p.every((v) => isFinite(v))));
}

console.log(`test_set3d: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
