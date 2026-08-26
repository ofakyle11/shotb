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
/* TMedia first: it carries THE sensor table both set modules read. */
(0, eval)(readFileSync(join(ROOT, 'tools/lib-media.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'sets/lib-set3d.js'), 'utf8'));
(0, eval)(readFileSync(join(ROOT, 'sets/lib-set.js'), 'utf8'));
const S3 = globalThis.CSet3D, S = globalThis.CSet, M = globalThis.TMedia;

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
     wrong, which is worse than not offering the feature.

     THIS PIN AND THE ONE IN scripts/test_set.mjs MOVE TOGETHER. They used to
     name two different sensors for the same lens — Super 35 here, full frame
     there — and both passed, so the suite certified the contradiction and
     correcting either file on its own turned the run red. The agreement
     assertions below make that impossible to repeat: change a sensor in one
     module and both suites fail until the other follows. */
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

  /* ── one lens, one answer, across all three implementations ── */
  for (const mm of [18, 25, 35, 50, 85, 100]) {
    t(`the 3D frustum and the 2D cone agree at ${mm}mm`,
      Math.abs(S3.lensFov(mm, false) - S.fovDeg(mm)) < 0.05,
      `${S3.lensFov(mm, false)} vs ${S.fovDeg(mm)}`);
    t(`the 3D frustum and the sensor table agree at ${mm}mm`,
      Math.abs(S3.lensFov(mm, false) - M.lensCalc('super35', mm).hfov) < 0.05);
  }
  /* The fallback exists for props/index.html, which loads this module without
     the tools bundle. It is a COPY of one row of the shared table, and the
     row it copies has to be the row the shared table calls default — key
     included. Nothing asserted the key before, and sensorFor() spelled
     'super35' out by hand, so moving TMedia.DEFAULT_SENSOR would have put the
     two halves of the app back on two different formats without a single test
     going red. It is now pinned from both ends. */
  t('the fallback sensor is a copy of the shared table, not a second opinion',
    S3.FALLBACK_SENSOR.w === M.SENSORS[M.DEFAULT_SENSOR].w &&
    S3.FALLBACK_SENSOR.h === M.SENSORS[M.DEFAULT_SENSOR].h &&
    S3.FALLBACK_SENSOR.label === M.SENSORS[M.DEFAULT_SENSOR].label);
  t('and it copies the row the shared table calls DEFAULT',
    S3.FALLBACK_SENSOR.key === M.DEFAULT_SENSOR,
    `${S3.FALLBACK_SENSOR.key} vs ${M.DEFAULT_SENSOR}`);
  t('the two set modules fall back to the same row',
    S.FALLBACK_SENSOR.key === S3.FALLBACK_SENSOR.key &&
    S.FALLBACK_SENSOR.w === S3.FALLBACK_SENSOR.w && S.FALLBACK_SENSOR.h === S3.FALLBACK_SENSOR.h);
  t('sensorFor resolves a key against the shared table',
    S3.sensorFor('s16').w === M.SENSORS.s16.w && S3.sensorFor('s16').key === 's16');
  t('sensorFor falls back to the shared default, not to a hardcoded key',
    S3.sensorFor('nope').key === M.DEFAULT_SENSOR && S.sensorOf('nope').key === M.DEFAULT_SENSOR,
    `${S3.sensorFor('nope').key} / ${S.sensorOf('nope').key}`);
  t('a named format is honoured', Math.abs(S3.lensFov(35, false, 'fullframe') - 54.4) < 0.1,
    S3.lensFov(35, false, 'fullframe'));
  t('an unknown format falls back to the default',
    near(S3.lensFov(35, false, 'nope'), S3.lensFov(35, false)));

  /* ── the frame's shape comes from the format, not the window ── */
  t('aspect is the format aspect', near(S3.aspectFor('super35'), 24.9 / 18.7, 1e-9),
    S3.aspectFor('super35'));
  t('a 17:9 format is wider than a 4:3 one', S3.aspectFor('super35-17x9') > S3.aspectFor('super35'));
  t('cameraView carries fovY and aspect as one pair from one format',
    near(v.aspect, S3.aspectFor('super35')) && near(v.fovY, S3.lensFov(35, true)) &&
    near(v.fovX, S3.lensFov(35, false)), `${v.aspect} ${v.fovY} ${v.fovX}`);
  t('cameraView names the sensor it used', /Super 35/.test(v.sensor) && v.sensorKey === 'super35');
  t('a plan on another format changes the frustum, not the window',
    S3.cameraView(cam, null, 'fullframe').fovX > v.fovX &&
    S3.cameraView(cam, null, 'fullframe').aspect === 36 / 24);
  /* The window used to decide the horizontal coverage: 39.1° at 4:3, 50.7° at
     16:9, 63.8° at 21:9 on one 35mm. The maths that produced that is the
     canvas aspect reaching perspective(); the format aspect is fixed. */
  t('the format aspect does not move when the panel does',
    S3.cameraView(cam).aspect === S3.cameraView(cam).aspect &&
    near(S3.cameraView(cam).aspect, 24.9 / 18.7));
}

/* ── which way does a face point ───────────────────────────────────────────
   63 geometry assertions and not one asked this, so every normal in the
   engine pointed inward: sets lit from below, and every OBJ and STL imported
   inside out. A closed solid's face normal must point AWAY from its centre. */
{
  const triNormal = (q) => S3.normalize(S3.cross(S3.sub(q[1], q[0]), S3.sub(q[2], q[0])));
  const centre = (pts) => {
    const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    return s.map((v) => v / pts.length);
  };

  const box = S3.itemMesh({ id: 'b', type: 'custom', x: 0, y: 0, w: 4, h: 6, rot: 0 }, 10);
  const nTop = triNormal(box.quads[0]);
  t('the top of a box points UP', near(nTop[0], 0) && near(nTop[1], 1) && near(nTop[2], 0),
    nTop.join(','));
  const nBot = triNormal(box.quads[1]);
  t('the bottom of a box points DOWN', near(nBot[1], -1), nBot.join(','));
  t('the -Z side of a box points -Z', near(triNormal(box.quads[2])[2], -1),
    triNormal(box.quads[2]).join(','));

  const outward = (mesh) => {
    const mid = centre(mesh.quads.flat());
    return mesh.quads.every((q) => {
      const n = triNormal(q);
      if (!n[0] && !n[1] && !n[2]) return false;         // no face may be degenerate
      return S3.dot(n, S3.sub(centre(q), mid)) > 0;
    });
  };
  t('every face of a box points away from its centre', outward(box));
  t('rotation does not flip a face inward',
    outward(S3.itemMesh({ id: 'r', type: 'custom', x: 3, y: 7, w: 4, h: 1, rot: 37 }, 10)));
  t('every face of a cylinder points outward',
    outward(S3.itemMesh({ id: 'c', type: 'plant', x: 0, y: 0, w: 3, h: 3, rot: 0 }, 10)));
  t('a cylinder is capped at both ends, so it is a solid', (function () {
    const cyl = S3.itemMesh({ id: 'c', type: 'plant', x: 0, y: 0, w: 3, h: 3, rot: 0 }, 10);
    const lo = Math.min(...cyl.quads.flat().map((p) => p[1]));
    const up = cyl.quads.filter((q) => near(triNormal(q)[1], 1, 1e-6)).length;
    const down = cyl.quads.filter((q) => near(triNormal(q)[1], -1, 1e-6)).length;
    return up > 0 && up === down && lo >= -1e-9;
  })());
  /* Every mesh the catalog can produce, not just the two shapes above. A
     table is a top on four legs, so "away from the centroid" is the wrong
     question for it; the right one is the divergence theorem — a closed mesh
     wound outward encloses a POSITIVE volume, and an inside-out one encloses
     the same volume negated. That holds for a union of closed solids too,
     which is what every composite shape here is. */
  const signedVolume = (mesh) => mesh.quads.reduce((sum, q) =>
    sum + S3.faceTris(q).reduce((s, tr) =>
      s + S3.dot(tr[0], S3.cross(S3.sub(tr[1], tr[0]), S3.sub(tr[2], tr[0]))) / 6, 0), 0);
  const catalog = Object.keys(S3.PROFILES);
  const inverted = catalog.filter((type) =>
    signedVolume(S3.itemMesh({ id: 't', type: type, x: 6, y: 6, w: 4, h: 3, rot: 0 }, 10)) <= 0);
  t('no shape in the catalog is built inside out', inverted.length === 0, inverted.join(','));
  t('a box encloses exactly its own volume', (function () {
    const v = signedVolume(S3.itemMesh({ id: 'v', type: 'custom', x: 0, y: 0, w: 4, h: 3, rot: 0 }, 10));
    return near(v, 4 * 3 * S3.PROFILES.custom.h, 1e-6);
  })());

  /* STL states its normals explicitly, and a slicer believes them. */
  const stl = S3.toSTL({ w: 10, h: 10, items: [{ id: 'b', type: 'custom', x: 5, y: 5, w: 4, h: 4, rot: 0 }] }, 'n');
  const facets = stl.match(/facet normal [^\n]*/g) || [];
  t('the STL export declares an upward normal for the top face',
    facets.filter((f) => f === 'facet normal 0 1 0').length === 2, facets.slice(0, 3).join(' | '));
  t('and a downward one for the bottom, not two of the same',
    facets.filter((f) => f === 'facet normal 0 -1 0').length === 2, facets.join(' | '));

  /* The camera model and the camera's own view must agree about "forward". */
  const camMesh = S3.itemMesh({ id: 'cm', type: 'camera', x: 10, y: 10, w: 1.6, h: 1.6, rot: 0, lens: 35 }, 10);
  const zs = camMesh.quads.flat().map((p) => p[2]);
  const look = S3.cameraView({ id: 'cm', type: 'camera', x: 10, y: 10, rot: 0, lens: 35 });
  t('the camera mesh points the same way its own frustum does',
    Math.min(...zs) < 10 - 0.95 && look.target[2] < look.eye[2],
    `mesh reaches z=${Math.min(...zs)}, view looks to ${look.target[2]}`);
  t('nothing sticks out of the back of the camera', Math.max(...zs) <= 10 + 0.95 + 1e-9,
    Math.max(...zs));
  t('a rotated camera takes its lens with it', (function () {
    const m = S3.itemMesh({ id: 'c2', type: 'camera', x: 10, y: 10, w: 1.6, h: 1.6, rot: 90 }, 10);
    return Math.max(...m.quads.flat().map((p) => p[0])) > 10 + 0.95;
  })());

  /* The primitives the whole thing rests on, named directly rather than
     only through the meshes they build. */
  t('cross is right-handed', S3.cross([1, 0, 0], [0, 1, 0])[2] === 1);
  t('dot of perpendiculars is zero', S3.dot([1, 0, 0], [0, 0, 1]) === 0);
  t('normalize returns unit length', near(Math.hypot(...S3.normalize([3, 4, 12])), 1, 1e-9));
  t('normalize of nothing is not NaN', S3.normalize([0, 0, 0]).every((v) => v === 0));
  t('sub subtracts', S3.sub([5, 5, 5], [1, 2, 3]).join(',') === '4,3,2');
  t('profileFor falls back for an unknown type', S3.profileFor('nope') === S3.PROFILES.custom);
  t('colorOf rejects a non-colour', S3.colorOf({ type: 'wall', color: 'red' }) === S3.PROFILES.wall.color);
  t('rayTriangle reports the distance to a hit',
    Math.abs(S3.rayTriangle([0, 0, 5], [0, 0, -1], [-1, -1, 0], [1, -1, 0], [0, 1, 0]) - 5) < 1e-9);
  t('rayTriangle misses cleanly', S3.rayTriangle([9, 9, 5], [0, 0, -1], [-1, -1, 0], [1, -1, 0], [0, 1, 0]) === -1);
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
  /* A face is a fan: a quad gives two triangles, a cap wedge gives one. The
     renderer computes each mesh's vertex range from meshTriCount(), so the
     two have to agree exactly or every highlight is drawn against the wrong
     slice of the buffer. */
  t('every face becomes its own fan of triangles',
    tri.count === scene.meshes.reduce((n, m) => n + S3.meshTriCount(m) * 3, 0), tri.count);
  t('meshTriCount matches what triangulate actually emitted',
    scene.meshes.every((m) => S3.triangulate([m]).count === S3.meshTriCount(m) * 3));
  t('a quad still becomes exactly two triangles',
    S3.faceTris([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]).length === 2);
  t('a triangle face becomes exactly one',
    S3.faceTris([[0, 0, 0], [1, 0, 0], [1, 1, 0]]).length === 1);
  t('a face with a repeated corner loses the repeat rather than the area',
    S3.faceTris([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]]).length === 1);
  t('a face that is not a face produces no triangles',
    S3.faceTris([[0, 0, 0], [1, 0, 0]]).length === 0 && S3.faceTris([]).length === 0);
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
  const faces = obj.split('\n').filter((l) => l.startsWith('f ')).map((l) => l.slice(2).trim().split(/\s+/));
  t('OBJ writes one vertex per face corner, three or four of them',
    vCount === faces.reduce((n, f) => n + f.length, 0) &&
    faces.every((f) => f.length === 3 || f.length === 4),
    `${vCount} v / ${faces.length} f`);

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

/* ── the exported geometry has to be a solid a tool will accept ────────────
   A box is the one shape that cannot show this defect, and a box was all the
   export tests measured — so the cap fans went out as degenerate quads
   [c, p1, p0, c] and nothing noticed. Invisible on screen, because the second
   triangle of that quad has no area and rasterises to nothing; not invisible
   at all in a file, where one plant produced 24 of 72 STL facets reading
   `facet normal 0 0 0` and 24 of 36 OBJ faces carrying a repeated vertex.
   That is non-manifold, and a slicer or a DCC tool either rejects it or
   silently "repairs" it into something the art department did not draw.

   So: measure a CYLINDER, and measure the file rather than the mesh. */
{
  const cylPlan = { w: 10, h: 10, items: [
    { id: 'pl', type: 'plant', x: 5, y: 5, w: 3, h: 3, rot: 0 }] };
  const stl = S3.toSTL(cylPlan, 'plant');
  const normals = stl.match(/^facet normal .*$/gm) || [];
  const zero = normals.filter((n) => /^facet normal (-?0(\.0+)?\s+){2}-?0(\.0+)?$/.test(n));
  t('a cylinder exports facets at all', normals.length > 0, normals.length);
  t('NOT ONE exported STL facet has a zero normal', zero.length === 0,
    `${zero.length} of ${normals.length}`);
  t('every STL facet normal is a unit direction', (() => {
    for (const n of normals) {
      const v = n.split(/\s+/).slice(2).map(Number);
      if (!v.every(isFinite) || Math.abs(Math.hypot(...v) - 1) > 1e-3) return false;
    }
    return true;
  })());
  /* Zero-area triangles are the thing being removed, so the count has to drop
     to exactly the real surface: 12 side quads (2 triangles each) + 12 top
     wedges + 12 bottom wedges = 48, not the 72 it used to write. */
  t('the facet count is the real surface, with no zero-area padding',
    normals.length === 48, normals.length);
  t('no STL facet repeats one of its own vertices', (() => {
    const blocks = stl.split('facet normal').slice(1);
    return blocks.every((b) => {
      const vs = (b.match(/vertex [^\n]*/g) || []).map((s) => s.trim());
      return vs.length === 3 && new Set(vs).size === 3;
    });
  })());

  const obj = S3.toOBJ(cylPlan, 'plant');
  const objFaces = obj.split('\n').filter((l) => l.startsWith('f '))
    .map((l) => l.slice(2).trim().split(/\s+/));
  t('a cylinder exports OBJ faces at all', objFaces.length > 0, objFaces.length);
  t('NOT ONE exported OBJ face repeats a vertex',
    objFaces.every((f) => new Set(f).size === f.length),
    `${objFaces.filter((f) => new Set(f).size !== f.length).length} of ${objFaces.length}`);
  t('the cap fans are written as triangles, the sides as quads',
    objFaces.filter((f) => f.length === 3).length === 24 &&
    objFaces.filter((f) => f.length === 4).length === 12,
    objFaces.map((f) => f.length).join(''));
  t('every OBJ face index points at a vertex the file declares', (() => {
    const nv = (obj.match(/^v /gm) || []).length;
    return objFaces.every((f) => f.every((i) => +i >= 1 && +i <= nv));
  })());

  /* And the whole catalog, not just the one shape that showed the bug. */
  const bad = Object.keys(S3.PROFILES).filter((type) => {
    const p = { w: 20, h: 20, items: [{ id: 'x', type, x: 10, y: 10, w: 4, h: 3, rot: 23 }] };
    const s = S3.toSTL(p, type), o = S3.toOBJ(p, type);
    const zeroN = (s.match(/facet normal (-?0(\.0+)?\s+){2}-?0(\.0+)?$/gm) || []).length;
    const dupF = o.split('\n').filter((l) => l.startsWith('f '))
      .filter((l) => { const f = l.slice(2).trim().split(/\s+/); return new Set(f).size !== f.length; }).length;
    return zeroN > 0 || dupF > 0;
  });
  t('nothing in the catalog exports degenerate geometry', bad.length === 0, bad.join(','));
}

/* ── an empty or malformed plan must not throw ── */
{
  t('an empty plan builds nothing, safely', S3.buildScene({ items: [] }).meshes.length === 0);
  t('a null plan is handled', S3.buildScene(null).meshes.length === 0);
  const junk = S3.itemMesh({ id: 'j', type: 'nope', x: 'x', y: null, w: 0, h: undefined, rot: 'r' }, 10);
  t('a junk item still produces finite geometry',
    junk.quads.flat().every((p) => p.every((v) => isFinite(v))));
}


/* cleanFace drops the repeated vertices that made the cylinder cap fans
   degenerate: they were invisible on screen but exported 24 of 72 STL facets
   as `facet normal 0 0 0` and 24 of 36 OBJ faces with a duplicated vertex —
   non-manifold, and rejected or silently "repaired" by slicers. */
{
  const A = [0, 0, 0], B = [1, 0, 0], C = [1, 1, 0];
  t('cleanFace leaves a real triangle alone', (S3.cleanFace([A, B, C]) || []).length === 3);
  t('cleanFace collapses an adjacent repeat', (S3.cleanFace([A, A, B, C]) || []).length === 3);
  t('cleanFace closes the wrap-around repeat', (S3.cleanFace([A, B, C, A]) || []).length === 3);
  t('a degenerate cap fan is refused, not emitted', S3.cleanFace([A, B, B, A]) === null);
  t('cleanFace refuses anything under three points', S3.cleanFace([A, B]) === null && S3.cleanFace([]) === null);
  t('cleanFace refuses a null face', S3.cleanFace(null) === null);
}

console.log(`test_set3d: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
