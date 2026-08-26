/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Set Designer 3D engine (CSet3D)

   Pure geometry, no DOM and no WebGL: turns a top-down set plan (the same
   {x, y, w, h, rot} items the 2D designer already stores, measured in feet)
   into triangle meshes, and does the matrix and ray maths the viewport needs.
   Everything here is testable under node, which is why the renderer is a
   separate file — a bug in a projection matrix should be findable without a
   browser.

   Conventions, stated once because mixing them up is the usual source of
   "why is my model inside out":
     · Units are FEET throughout, matching the 2D plan and the way a set is
       actually dimensioned on a call sheet.
     · World axes are X right, Y UP, Z toward the viewer (right-handed, the
       same as OpenGL). The plan's y runs across the stage floor, so a plan
       point (x, y) becomes world (x, 0, y).
     · An item's `rot` is degrees clockwise in the plan, which is a rotation
       about the world Y axis.
     · Triangles wind counter-clockwise when seen from outside, so a face
       normal points AWAY from the solid it belongs to. Every quad below used
       to be wound the other way — the box top measured (0,−1,0) — which lit
       every set from underneath and exported every OBJ and STL inside out.
       gl.js now enables CULL_FACE, so getting this wrong again is visible on
       screen instead of silent, and test_set3d.mjs measures it.

   All original code, written for Cinamate.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── 3D profiles ────────────────────────────────────────────────────
     The 2D catalog gives each stencil a footprint. This gives it a height
     and a shape, so a plan the designer already drew stands up without
     anyone re-entering anything. Heights are the real-world defaults a set
     dresser would assume; every one is overridable per item. */
  var PROFILES = {
    wall:        { h: 10,   shape: 'box',      color: '#C9CCD1' },
    door:        { h: 6.75, shape: 'opening',  color: '#8A6A4A' },
    window:      { h: 4,    shape: 'opening',  color: '#7FA8CC', z: 3 },
    table:       { h: 2.5,  shape: 'table',    color: '#8A6A4A' },
    chair:       { h: 3,    shape: 'chair',    color: '#6E5844' },
    sofa:        { h: 2.7,  shape: 'sofa',     color: '#5E6A78' },
    bed:         { h: 2,    shape: 'box',      color: '#B9AFA2' },
    desk:        { h: 2.5,  shape: 'table',    color: '#7A6047' },
    counter:     { h: 3,    shape: 'box',      color: '#9A9088' },
    shelf:       { h: 6,    shape: 'box',      color: '#7A6047' },
    rug:         { h: 0.05, shape: 'box',      color: '#8C5A4A' },
    plant:       { h: 4,    shape: 'cylinder', color: '#4E7A4E' },
    piano:       { h: 3.3,  shape: 'box',      color: '#23262B' },
    vehicle:     { h: 5,    shape: 'box',      color: '#43506080' },
    greenscreen: { h: 12,   shape: 'box',      color: '#2FA84F' },
    person:      { h: 5.8,  shape: 'person',   color: '#C9A86C' },
    camera:      { h: 5,    shape: 'camera',   color: '#E8EEF4' },
    light:       { h: 7,    shape: 'light',    color: '#F2D98C' },
    custom:      { h: 3,    shape: 'box',      color: '#8BA3B8' }
  };

  function profileFor(type) { return PROFILES[type] || PROFILES.custom; }

  /* Height and floor elevation of one item, honouring per-item overrides. */
  function heightOf(item) {
    var p = profileFor(item && item.type);
    var v = item && item.hgt != null ? +item.hgt : p.h;
    return isFinite(v) && v > 0 ? v : p.h;
  }
  function elevationOf(item) {
    var p = profileFor(item && item.type);
    var v = item && item.z != null ? +item.z : (p.z || 0);
    return isFinite(v) && v >= 0 ? v : 0;
  }
  function colorOf(item) {
    var c = item && item.color;
    return /^#[0-9a-f]{6}$/i.test(String(c)) ? c : profileFor(item && item.type).color;
  }

  /* ── vector and matrix maths ────────────────────────────────────────
     Column-major 4x4, the layout WebGL's uniformMatrix4fv expects, so no
     transposing anywhere. */
  function mat4() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  function multiply(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function perspective(fovYDeg, aspect, near, far) {
    var f = 1 / Math.tan(fovYDeg * Math.PI / 360);
    var nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0];
  }
  function normalize(v) {
    var l = Math.hypot(v[0], v[1], v[2]);
    return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  function lookAt(eye, target, up) {
    var z = normalize(sub(eye, target));
    if (!z[0] && !z[1] && !z[2]) z = [0, 0, 1];
    var x = normalize(cross(up || [0, 1, 0], z));
    /* Looking straight down makes up parallel to z and the cross product
       collapses; fall back to a different up so the camera stays valid. */
    if (!x[0] && !x[1] && !x[2]) x = normalize(cross([0, 0, 1], z));
    var y = cross(z, x);
    return [x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }

  /* Orbit camera: a position on a sphere around a target. Kept here rather
     than in the renderer so the framing maths is testable. */
  function orbitEye(target, distFt, yawDeg, pitchDeg) {
    var yaw = yawDeg * Math.PI / 180;
    /* Clamped just short of the poles: exactly overhead makes `up` parallel
       to the view direction and the basis degenerates. */
    var pitch = Math.max(-89, Math.min(89, pitchDeg)) * Math.PI / 180;
    var cp = Math.cos(pitch);
    return [
      target[0] + distFt * cp * Math.sin(yaw),
      target[1] + distFt * Math.sin(pitch),
      target[2] + distFt * cp * Math.cos(yaw)
    ];
  }

  /* ── mesh building ──────────────────────────────────────────────────
     Each item becomes a list of quads, each quad four world-space corners
     wound counter-clockwise from outside. Quads (not triangles) at this
     stage because they are far easier to reason about and to test; the
     renderer splits them. */
  function rotY(px, pz, cx, cz, deg) {
    /* Matches SVG's rotate() exactly, which is what the 2D plan uses. In a
       y-down coordinate system that rotation is clockwise on screen and maps
       +x to +y — so in world terms +x goes to +z. Getting this sign wrong
       makes the 3D view a mirror of the plan the designer drew, which is
       worse than not showing it. */
    var a = deg * Math.PI / 180;
    var s = Math.sin(a), c = Math.cos(a);
    var dx = px - cx, dz = pz - cz;
    return [cx + dx * c - dz * s, cz + dx * s + dz * c];
  }

  /* A box from footprint + elevation + height, rotated about its centre. */
  function boxQuads(cx, cz, w, d, y0, y1, deg) {
    var hw = w / 2, hd = d / 2;
    var corner = [
      rotY(cx - hw, cz - hd, cx, cz, deg),
      rotY(cx + hw, cz - hd, cx, cz, deg),
      rotY(cx + hw, cz + hd, cx, cz, deg),
      rotY(cx - hw, cz + hd, cx, cz, deg)
    ];
    var lo = corner.map(function (p) { return [p[0], y0, p[1]]; });
    var hi = corner.map(function (p) { return [p[0], y1, p[1]]; });
    /* Each list reads counter-clockwise seen from OUTSIDE the box, so the
       cross product in triangulate() points out of the solid. */
    return [
      [hi[3], hi[2], hi[1], hi[0]],                 // top      → +Y
      [lo[0], lo[1], lo[2], lo[3]],                 // bottom   → −Y
      [hi[0], hi[1], lo[1], lo[0]],                 // sides
      [hi[1], hi[2], lo[2], lo[1]],
      [hi[2], hi[3], lo[3], lo[2]],
      [hi[3], hi[0], lo[0], lo[3]]
    ];
  }

  function cylinderQuads(cx, cz, r, y0, y1, seg) {
    seg = seg || 12;
    var out = [];
    for (var i = 0; i < seg; i++) {
      var a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      var p0 = [cx + r * Math.cos(a0), cz + r * Math.sin(a0)];
      var p1 = [cx + r * Math.cos(a1), cz + r * Math.sin(a1)];
      /* Side, wound so the normal points out along the radius. */
      out.push([[p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [p1[0], y0, p1[1]], [p0[0], y0, p0[1]]]);
      /* Cap fans, degenerate on their fourth corner: top faces up, bottom
         faces down. The bottom used to be missing altogether, which with
         face culling on is a hole you can see through, and which no slicer
         will accept as a solid. */
      out.push([[cx, y1, cz], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [cx, y1, cz]]);
      out.push([[cx, y0, cz], [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [cx, y0, cz]]);
    }
    return out;
  }

  /* Shapes that read as furniture rather than as a stack of crates. A table
     is a top on four legs; a chair adds a back; a sofa is a base with arms.
     Cheap to build and it makes a plan legible at a glance, which is the
     entire point of showing it in 3D. */
  function tableQuads(cx, cz, w, d, h, deg) {
    var top = boxQuads(cx, cz, w, d, h - 0.2, h, deg);
    var legW = Math.min(0.35, w / 8, d / 8);
    var ox = w / 2 - legW, oz = d / 2 - legW;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
      var p = rotY(cx + s[0] * ox, cz + s[1] * oz, cx, cz, deg);
      top = top.concat(boxQuads(p[0], p[1], legW, legW, 0, h - 0.2, deg));
    });
    return top;
  }
  function chairQuads(cx, cz, w, d, h, deg) {
    var seatH = h * 0.45;
    var out = tableQuads(cx, cz, w, d, seatH, deg);
    var back = rotY(cx, cz - d / 2 + 0.15, cx, cz, deg);
    return out.concat(boxQuads(back[0], back[1], w, 0.25, seatH, h, deg));
  }
  function sofaQuads(cx, cz, w, d, h, deg) {
    var out = boxQuads(cx, cz, w, d, 0, h * 0.45, deg);
    var back = rotY(cx, cz - d / 2 + 0.25, cx, cz, deg);
    out = out.concat(boxQuads(back[0], back[1], w, 0.5, h * 0.45, h, deg));
    [-1, 1].forEach(function (s) {
      var arm = rotY(cx + s * (w / 2 - 0.25), cz, cx, cz, deg);
      out = out.concat(boxQuads(arm[0], arm[1], 0.5, d, h * 0.45, h * 0.75, deg));
    });
    return out;
  }
  function personQuads(cx, cz, h) {
    /* A blocking mark is a stand-in for an actor. Scale matters more than
       detail: it is there so the designer can see whether a doorway reads
       and whether the camera can see over the furniture. */
    var out = cylinderQuads(cx, cz, 0.55, 0, h * 0.85, 10);
    return out.concat(cylinderQuads(cx, cz, 0.38, h * 0.85, h, 10));
  }
  function cameraQuads(cx, cz, h, deg) {
    var body = boxQuads(cx, cz, 1.2, 1.8, h - 0.7, h, deg);
    /* The lens goes on the front, and the front is −Z at rot 0 — the same
       direction cameraView() looks and the same way the 2D cone points, up
       the page. It used to be built at +Z, so the model faced 180° away from
       its own frustum and every "which way is A cam pointing" read backwards
       off the 3D view. */
    var lens = rotY(cx, cz - 1.1, cx, cz, deg);
    body = body.concat(cylinderQuads(lens[0], lens[1], 0.32, h - 0.55, h - 0.15, 8));
    return body.concat(boxQuads(cx, cz, 0.3, 0.3, 0, h - 0.7, deg));   // tripod column
  }
  function lightQuads(cx, cz, h, deg) {
    var head = boxQuads(cx, cz, 1.2, 1.0, h - 1.1, h, deg);
    return head.concat(boxQuads(cx, cz, 0.25, 0.25, 0, h - 1.1, deg));
  }
  /* A door or window is a hole, so it is drawn as the frame around the hole
     rather than as a solid — otherwise a doorway reads as a blocked wall. */
  function openingQuads(cx, cz, w, d, y0, y1, deg, wallH) {
    var out = [];
    var jamb = 0.3;
    [-1, 1].forEach(function (s) {
      var p = rotY(cx + s * (w / 2 - jamb / 2), cz, cx, cz, deg);
      out = out.concat(boxQuads(p[0], p[1], jamb, d, 0, wallH, deg));
    });
    if (y1 < wallH) out = out.concat(boxQuads(cx, cz, w, d, y1, wallH, deg));   // header
    if (y0 > 0) out = out.concat(boxQuads(cx, cz, w, d, 0, y0, deg));           // sill
    return out;
  }

  /* One item → { id, type, color, quads }. */
  function itemMesh(item, wallHeight) {
    var w = +item.w || 1, d = +item.h || 1;
    var cx = +item.x || 0, cz = +item.y || 0, deg = +item.rot || 0;
    var h = heightOf(item), z0 = elevationOf(item);
    var shape = profileFor(item.type).shape;
    var quads;

    if (shape === 'cylinder') quads = cylinderQuads(cx, cz, Math.max(w, d) / 2, z0, z0 + h, 12);
    else if (shape === 'table') quads = tableQuads(cx, cz, w, d, h, deg);
    else if (shape === 'chair') quads = chairQuads(cx, cz, w, d, h, deg);
    else if (shape === 'sofa') quads = sofaQuads(cx, cz, w, d, h, deg);
    else if (shape === 'person') quads = personQuads(cx, cz, h);
    else if (shape === 'camera') quads = cameraQuads(cx, cz, h, deg);
    else if (shape === 'light') quads = lightQuads(cx, cz, h, deg);
    else if (shape === 'opening') quads = openingQuads(cx, cz, w, d, z0, z0 + h, deg, wallHeight || 10);
    else quads = boxQuads(cx, cz, w, d, z0, z0 + h, deg);

    return { id: item.id, type: item.type, color: colorOf(item), quads: quads };
  }

  /* Whole plan → meshes, plus the floor. */
  function buildScene(plan) {
    if (!plan) return { meshes: [], bounds: { w: 0, d: 0 } };
    var wallH = 10;
    (plan.items || []).forEach(function (i) {
      if (i.type === 'wall') wallH = Math.max(wallH, heightOf(i));
    });
    var meshes = (plan.items || []).map(function (i) { return itemMesh(i, wallH); });
    return { meshes: meshes, bounds: { w: +plan.w || 24, d: +plan.h || 18 }, wallHeight: wallH };
  }

  /* ── flat-shaded triangles for the renderer ─────────────────────────
     Quads become two triangles each, with one face normal per triangle so
     the shading stays flat and every edge reads. */
  function triangulate(meshes) {
    var pos = [], nrm = [], col = [], ids = [];
    meshes.forEach(function (m, mi) {
      var rgb = hexToRgb(m.color);
      m.quads.forEach(function (q) {
        [[q[0], q[1], q[2]], [q[0], q[2], q[3]]].forEach(function (t) {
          var n = normalize(cross(sub(t[1], t[0]), sub(t[2], t[0])));
          t.forEach(function (p) {
            pos.push(p[0], p[1], p[2]);
            nrm.push(n[0], n[1], n[2]);
            col.push(rgb[0], rgb[1], rgb[2], rgb[3]);
            ids.push(mi);
          });
        });
      });
    });
    return {
      positions: new Float32Array(pos), normals: new Float32Array(nrm),
      colors: new Float32Array(col), meshIndex: ids, count: pos.length / 3
    };
  }

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    /* Length was checked before content, so any 8-character string —
       "nonsense" among them — took the RGBA branch and parseInt returned NaN
       for every channel, which WebGL renders as nothing at all. */
    if (!/^[0-9a-f]+$/i.test(h)) return [0.55, 0.64, 0.72, 1];
    if (h.length === 8) {
      return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255,
              parseInt(h.slice(4, 6), 16) / 255, parseInt(h.slice(6, 8), 16) / 255];
    }
    if (h.length !== 6) return [0.55, 0.64, 0.72, 1];
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255,
            parseInt(h.slice(4, 6), 16) / 255, 1];
  }

  /* ── picking ────────────────────────────────────────────────────────
     Which item is under the pointer. Ray/triangle by Möller–Trumbore, then
     nearest hit wins. Done here so selection behaves identically whether it
     is driven by a mouse, a touch or a test. */
  function rayTriangle(ro, rd, a, b, c) {
    var e1 = sub(b, a), e2 = sub(c, a);
    var p = cross(rd, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-9) return -1;              // ray parallel to the triangle
    var inv = 1 / det, tv = sub(ro, a);
    var u = dot(tv, p) * inv;
    if (u < 0 || u > 1) return -1;
    var q = cross(tv, e1);
    var v = dot(rd, q) * inv;
    if (v < 0 || u + v > 1) return -1;
    var t = dot(e2, q) * inv;
    return t > 1e-6 ? t : -1;
  }

  function pick(meshes, rayOrigin, rayDir) {
    var best = null, bestT = Infinity;
    meshes.forEach(function (m) {
      m.quads.forEach(function (q) {
        [[q[0], q[1], q[2]], [q[0], q[2], q[3]]].forEach(function (t) {
          var hit = rayTriangle(rayOrigin, rayDir, t[0], t[1], t[2]);
          if (hit > 0 && hit < bestT) { bestT = hit; best = m.id; }
        });
      });
    });
    return best ? { id: best, distance: bestT } : null;
  }

  /* Screen point → world ray, given the same matrices the renderer used. */
  function screenRay(px, py, width, height, eye, target, fovY, near, far) {
    var ndcX = (px / width) * 2 - 1;
    var ndcY = 1 - (py / height) * 2;
    var aspect = width / height;
    var tan = Math.tan(fovY * Math.PI / 360);
    var fwd = normalize(sub(target, eye));
    var right = normalize(cross(fwd, [0, 1, 0]));
    if (!right[0] && !right[1] && !right[2]) right = [1, 0, 0];
    var up = cross(right, fwd);
    var dir = normalize([
      fwd[0] + right[0] * ndcX * tan * aspect + up[0] * ndcY * tan,
      fwd[1] + right[1] * ndcX * tan * aspect + up[1] * ndcY * tan,
      fwd[2] + right[2] * ndcX * tan * aspect + up[2] * ndcY * tan
    ]);
    return { origin: eye.slice(), dir: dir, near: near, far: far };
  }

  /* ── looking through a set camera ───────────────────────────────────
     The reason to build this at all. A camera item carries a real lens, so
     the viewport can show precisely what that lens sees from that mark —
     which no general-purpose modeller knows how to do, because it has no
     idea what a 35mm on Super 35 means.

     THE sensor table is TMedia.SENSORS in tools/lib-media.js — the same one
     the 2D plan reads, so the cone and the frustum are the same lens. This
     file used to hold its own 24.89 × 18.66 while sets/lib-set.js held a
     36 mm full frame; a 35 mm printed 54.4° under a viewport drawing 39.2°.

     Soft dependency: props/index.html loads this module without the tools
     bundle, so an absent TMedia falls back to the default format COPIED from
     that table — and test_set3d.mjs asserts the copy still matches, so it
     cannot drift into a second sensor. */
  var FALLBACK_SENSOR = { key: 'super35', label: 'Super 35 (24.9×18.7)', w: 24.9, h: 18.7 };

  function sensorFor(key) {
    var M = root.TMedia;
    if (M && M.SENSORS) {
      var k = M.sensorKey ? M.sensorKey(key) : (M.SENSORS[key] ? key : 'super35');
      var s = M.SENSORS[k];
      if (s) return { key: k, label: s.label, w: s.w, h: s.h };
    }
    return FALLBACK_SENSOR;
  }
  /* The frame's shape comes from the FORMAT. The viewport letterboxes to it;
     it never widens the lens to fill a wide browser window. */
  function aspectFor(key) { var s = sensorFor(key); return s.w / s.h; }

  function lensFov(lensMm, vertical, sensorKey) {
    var mm = +lensMm > 0 ? +lensMm : 35;
    var s = sensorFor(sensorKey);
    return 2 * Math.atan((vertical ? s.h : s.w) / (2 * mm)) * 180 / Math.PI;
  }

  function cameraView(item, eyeHeightFt, sensorKey) {
    var h = eyeHeightFt != null ? eyeHeightFt : Math.max(1, heightOf(item) - 0.5);
    var eye = [+item.x || 0, h, +item.y || 0];
    /* rot 0 points along +Z in the plan, which is "down the page"; a
       clockwise plan rotation is a negative rotation about world Y. */
    /* The 2D plan draws a camera's cone toward -y at rot 0 — up the page — and
       rotates it clockwise from there. So the facing is (sin r, -cos r) in
       plan coordinates, which is (sin r, -cos r) in world X/Z. */
    var r = (+item.rot || 0) * Math.PI / 180;
    var target = [eye[0] + Math.sin(r) * 10, h, eye[2] - Math.cos(r) * 10];
    var s = sensorFor(sensorKey);
    /* fovY and aspect are one pair, taken from one format. The renderer used
       to take fovY from here and aspect from the canvas, so the horizontal
       coverage was the browser window's shape: a 35mm read 39.1° at 4:3,
       50.7° at 16:9 and 63.8° at 21:9. Widening the window widened the lens. */
    return { eye: eye, target: target,
             fovY: lensFov(item.lens, true, s.key),
             fovX: lensFov(item.lens, false, s.key),
             aspect: s.w / s.h, sensor: s.label, sensorKey: s.key,
             lens: +item.lens || 35 };
  }

  /* ── export ─────────────────────────────────────────────────────────
     OBJ and STL are both plain text and both universally readable — which
     is the point: a set built here has to open in whatever the art
     department already uses. SketchUp Free exports STL; so do we. */
  function toOBJ(plan, name) {
    var scene = buildScene(plan);
    /* The name is echoed into a comment and an object declaration. A newline
       in it would end the comment and let the rest be read as geometry, so it
       goes through the same slug as everything else. */
    var title = slug(name || (plan && plan.name) || 'set');
    var lines = ['# Cinamate set export — units: feet', '# ' + title, 'o ' + title];
    var n = 1;
    scene.meshes.forEach(function (m) {
      lines.push('g ' + slug(m.id + '_' + m.type));
      m.quads.forEach(function (q) {
        q.forEach(function (p) {
          lines.push('v ' + fmt(p[0]) + ' ' + fmt(p[1]) + ' ' + fmt(p[2]));
        });
        lines.push('f ' + n + ' ' + (n + 1) + ' ' + (n + 2) + ' ' + (n + 3));
        n += 4;
      });
    });
    return lines.join('\n') + '\n';
  }

  function toSTL(plan, name) {
    var scene = buildScene(plan);
    var out = ['solid ' + slug(name || (plan && plan.name) || 'set')];
    scene.meshes.forEach(function (m) {
      m.quads.forEach(function (q) {
        [[q[0], q[1], q[2]], [q[0], q[2], q[3]]].forEach(function (t) {
          var nv = normalize(cross(sub(t[1], t[0]), sub(t[2], t[0])));
          out.push('facet normal ' + fmt(nv[0]) + ' ' + fmt(nv[1]) + ' ' + fmt(nv[2]));
          out.push('  outer loop');
          t.forEach(function (p) {
            out.push('    vertex ' + fmt(p[0]) + ' ' + fmt(p[1]) + ' ' + fmt(p[2]));
          });
          out.push('  endloop');
          out.push('endfacet');
        });
      });
    });
    out.push('endsolid');
    return out.join('\n') + '\n';
  }

  function fmt(v) { return (Math.round(v * 10000) / 10000).toString(); }
  function slug(s) { return String(s || 'part').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'part'; }

  root.CSet3D = {
    PROFILES: PROFILES, profileFor: profileFor,
    heightOf: heightOf, elevationOf: elevationOf, colorOf: colorOf,
    mat4: mat4, multiply: multiply, perspective: perspective, lookAt: lookAt,
    normalize: normalize, cross: cross, sub: sub, dot: dot,
    orbitEye: orbitEye,
    itemMesh: itemMesh, buildScene: buildScene, triangulate: triangulate,
    hexToRgb: hexToRgb,
    rayTriangle: rayTriangle, pick: pick, screenRay: screenRay,
    FALLBACK_SENSOR: FALLBACK_SENSOR, sensorFor: sensorFor, aspectFor: aspectFor,
    lensFov: lensFov, cameraView: cameraView,
    toOBJ: toOBJ, toSTL: toSTL
  };
})(typeof window !== 'undefined' ? window : globalThis);
