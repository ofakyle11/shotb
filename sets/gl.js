/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Set Designer 3D viewport (CSetGL)

   A small WebGL renderer written for this one job: flat-shaded set geometry,
   a floor grid, an orbit camera, and a "look through the lens" mode. No
   third-party code and nothing loaded from another origin — the gated app
   pulls its scripts from us alone, and a 3D view is not a reason to change
   that.

   All the maths lives in lib-set3d.js so it can be tested without a browser.
   This file is the part that genuinely needs a GPU: buffers, shaders, input.

   All original code, written for Cinamate.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var S3 = root.CSet3D;

  var VERT = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'attribute vec4 aColor;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'varying vec3 vNormal;',
    'varying vec4 vColor;',
    'varying vec3 vWorld;',
    'void main() {',
    '  vNormal = aNormal;',
    '  vColor = aColor;',
    '  vWorld = aPos;',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  /* Two directional lights and a little ambient. A key from high front-left
     and a cool fill from behind reads the way a set does on stage, and more
     importantly it keeps every face distinguishable — which is what a
     designer is actually looking for. */
  var FRAG = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'varying vec4 vColor;',
    'varying vec3 vWorld;',
    'uniform vec3 uHighlight;',
    'uniform float uHighlightOn;',
    'void main() {',
    '  vec3 n = normalize(vNormal);',
    '  vec3 key = normalize(vec3(-0.4, 0.85, 0.35));',
    '  vec3 fill = normalize(vec3(0.6, 0.35, -0.6));',
    '  float l = 0.42 + 0.52 * max(dot(n, key), 0.0) + 0.16 * max(dot(n, fill), 0.0);',
    '  vec3 c = vColor.rgb * l;',
    '  c = mix(c, uHighlight, uHighlightOn * 0.45);',
    '  gl_FragColor = vec4(c, vColor.a);',
    '}'
  ].join('\n');

  var LINE_VERT = [
    'attribute vec3 aPos;',
    'attribute vec3 aColor;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'varying vec3 vColor;',
    'void main() { vColor = aColor; gl_Position = uProj * uView * vec4(aPos, 1.0); }'
  ].join('\n');
  var LINE_FRAG = [
    'precision mediump float;',
    'varying vec3 vColor;',
    'void main() { gl_FragColor = vec4(vColor, 1.0); }'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('shader: ' + log);
    }
    return s;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  /* ── the viewport ───────────────────────────────────────────────────── */
  function create(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true }) ||
             canvas.getContext('experimental-webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) return null;                       // caller falls back to the 2D plan

    var solid, lines;
    try {
      solid = program(gl, VERT, FRAG);
      lines = program(gl, LINE_VERT, LINE_FRAG);
    } catch (e) {
      return null;
    }

    var buf = {
      pos: gl.createBuffer(), nrm: gl.createBuffer(), col: gl.createBuffer(),
      linePos: gl.createBuffer(), lineCol: gl.createBuffer()
    };
    var tri = null, lineCount = 0, meshes = [], meshRanges = [];

    /* Orbit state, in feet and degrees. */
    var view = { target: [12, 3, 9], dist: 46, yaw: 28, pitch: 26, fov: 52 };
    var lockedCamera = null;                    // an item id while looking through a lens
    var selectedId = null;

    function eye() {
      if (lockedCamera) {
        var it = itemById(lockedCamera);
        if (it) return S3.cameraView(it).eye;
      }
      return S3.orbitEye(view.target, view.dist, view.yaw, view.pitch);
    }
    function target() {
      if (lockedCamera) {
        var it = itemById(lockedCamera);
        if (it) return S3.cameraView(it).target;
      }
      return view.target;
    }
    function fovY() {
      if (lockedCamera) {
        var it = itemById(lockedCamera);
        if (it) return S3.cameraView(it).fovY;
      }
      return view.fov;
    }
    var currentPlan = null;
    function itemById(id) {
      if (!currentPlan) return null;
      for (var i = 0; i < (currentPlan.items || []).length; i++) {
        if (currentPlan.items[i].id === id) return currentPlan.items[i];
      }
      return null;
    }

    /* ── floor grid ──────────────────────────────────────────────────
       One line per foot, brighter every ten, plus the stage outline. A set
       is read off measurements; the grid is what makes the 3D view
       trustworthy rather than decorative. */
    function buildGrid(w, d) {
      var pos = [], col = [];
      function line(a, b, c) {
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      }
      var faint = [0.17, 0.22, 0.28], bold = [0.28, 0.36, 0.44], edge = [0.42, 0.55, 0.66];
      var W = Math.ceil(w), D = Math.ceil(d);
      for (var x = 0; x <= W; x++) line([x, 0, 0], [x, 0, D], x % 10 === 0 ? bold : faint);
      for (var z = 0; z <= D; z++) line([0, 0, z], [W, 0, z], z % 10 === 0 ? bold : faint);
      line([0, 0, 0], [W, 0, 0], edge); line([W, 0, 0], [W, 0, D], edge);
      line([W, 0, D], [0, 0, D], edge); line([0, 0, D], [0, 0, 0], edge);
      return { pos: new Float32Array(pos), col: new Float32Array(col), count: pos.length / 3 };
    }

    /* The frustum of every camera on the plan, drawn as wireframe so the
       designer can see coverage without switching views. */
    function cameraLines(plan) {
      var pos = [], col = [];
      var c = [0.79, 0.66, 0.42];
      (plan.items || []).forEach(function (it) {
        if (it.type !== 'camera') return;
        var v = S3.cameraView(it);
        var fovH = S3.lensFov(it.lens, false) * Math.PI / 360;
        var fovV = S3.lensFov(it.lens, true) * Math.PI / 360;
        var fwd = S3.normalize(S3.sub(v.target, v.eye));
        var right = S3.normalize(S3.cross(fwd, [0, 1, 0]));
        var up = S3.cross(right, fwd);
        var len = 18;
        var corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(function (s) {
          return [
            v.eye[0] + (fwd[0] + right[0] * s[0] * Math.tan(fovH) + up[0] * s[1] * Math.tan(fovV)) * len,
            v.eye[1] + (fwd[1] + right[1] * s[0] * Math.tan(fovH) + up[1] * s[1] * Math.tan(fovV)) * len,
            v.eye[2] + (fwd[2] + right[2] * s[0] * Math.tan(fovH) + up[2] * s[1] * Math.tan(fovV)) * len
          ];
        });
        corners.forEach(function (p, i) {
          pos.push(v.eye[0], v.eye[1], v.eye[2], p[0], p[1], p[2]);
          col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
          var q = corners[(i + 1) % 4];
          pos.push(p[0], p[1], p[2], q[0], q[1], q[2]);
          col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
        });
      });
      return { pos: pos, col: col };
    }

    function setPlan(plan) {
      currentPlan = plan;
      var scene = S3.buildScene(plan);
      meshes = scene.meshes;
      tri = S3.triangulate(meshes);

      /* Where each mesh's vertices live, so one can be highlighted without
         rebuilding anything. */
      meshRanges = [];
      var at = 0;
      meshes.forEach(function (m) {
        var n = m.quads.length * 6;
        meshRanges.push({ id: m.id, start: at, count: n });
        at += n;
      });

      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
      gl.bufferData(gl.ARRAY_BUFFER, tri.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.nrm);
      gl.bufferData(gl.ARRAY_BUFFER, tri.normals, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.col);
      gl.bufferData(gl.ARRAY_BUFFER, tri.colors, gl.STATIC_DRAW);

      var grid = buildGrid(scene.bounds.w, scene.bounds.d);
      var cam = cameraLines(plan);
      var lp = new Float32Array(grid.pos.length + cam.pos.length);
      lp.set(grid.pos); lp.set(cam.pos, grid.pos.length);
      var lc = new Float32Array(grid.col.length + cam.col.length);
      lc.set(grid.col); lc.set(cam.col, grid.col.length);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.linePos);
      gl.bufferData(gl.ARRAY_BUFFER, lp, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.lineCol);
      gl.bufferData(gl.ARRAY_BUFFER, lc, gl.STATIC_DRAW);
      lineCount = lp.length / 3;

      view.target = [scene.bounds.w / 2, 3, scene.bounds.d / 2];
    }

    function frame() {
      var w = canvas.clientWidth || 640, h = canvas.clientHeight || 400;
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.043, 0.086, 0.157, 1);        // matches the app's --base
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!tri) return;

      var proj = S3.perspective(fovY(), (canvas.width / canvas.height) || 1, 0.1, 800);
      var vw = S3.lookAt(eye(), target(), [0, 1, 0]);

      /* grid + frustums */
      gl.useProgram(lines);
      gl.uniformMatrix4fv(gl.getUniformLocation(lines, 'uProj'), false, new Float32Array(proj));
      gl.uniformMatrix4fv(gl.getUniformLocation(lines, 'uView'), false, new Float32Array(vw));
      bind(lines, 'aPos', buf.linePos, 3);
      bind(lines, 'aColor', buf.lineCol, 3);
      gl.drawArrays(gl.LINES, 0, lineCount);

      /* solids */
      gl.useProgram(solid);
      gl.uniformMatrix4fv(gl.getUniformLocation(solid, 'uProj'), false, new Float32Array(proj));
      gl.uniformMatrix4fv(gl.getUniformLocation(solid, 'uView'), false, new Float32Array(vw));
      gl.uniform3f(gl.getUniformLocation(solid, 'uHighlight'), 0.36, 0.55, 0.72);
      bind(solid, 'aPos', buf.pos, 3);
      bind(solid, 'aNormal', buf.nrm, 3);
      bind(solid, 'aColor', buf.col, 4);

      var hl = gl.getUniformLocation(solid, 'uHighlightOn');
      var sel = null;
      gl.uniform1f(hl, 0);
      for (var i = 0; i < meshRanges.length; i++) {
        var r = meshRanges[i];
        if (r.id === selectedId) { sel = r; continue; }
        gl.drawArrays(gl.TRIANGLES, r.start, r.count);
      }
      if (sel) {
        gl.uniform1f(hl, 1);
        gl.drawArrays(gl.TRIANGLES, sel.start, sel.count);
      }
    }

    function bind(prog, name, buffer, size) {
      var loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }

    /* ── input ───────────────────────────────────────────────────────
       Left drag orbits, right or shift drag pans, wheel dollies — the
       bindings anyone who has used a 3D tool already has in their fingers. */
    var drag = null;
    function onDown(e) {
      if (lockedCamera) return;
      var pan = e.button === 2 || e.shiftKey;
      drag = { x: e.clientX, y: e.clientY, pan: pan };
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        var yaw = view.yaw * Math.PI / 180;
        var scale = view.dist / 600;
        view.target[0] -= (dx * Math.cos(yaw) - dy * Math.sin(yaw)) * scale;
        view.target[2] += (dx * Math.sin(yaw) + dy * Math.cos(yaw)) * scale;
      } else {
        view.yaw -= dx * 0.4;
        view.pitch = Math.max(-5, Math.min(85, view.pitch + dy * 0.3));
      }
      frame();
    }
    function onUp() { drag = null; }
    function onWheel(e) {
      if (lockedCamera) return;
      e.preventDefault();
      view.dist = Math.max(4, Math.min(320, view.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
      frame();
    }

    /* Pinch to zoom, one finger to orbit. */
    var touch = null;
    function touchDist(t) {
      return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    }
    function onTouchStart(e) {
      if (lockedCamera) return;
      var t = e.touches;
      touch = t.length >= 2
        ? { mode: 'pinch', d: touchDist(t), dist: view.dist }
        : { mode: 'orbit', x: t[0].clientX, y: t[0].clientY };
    }
    function onTouchMove(e) {
      if (!touch) return;
      e.preventDefault();
      var t = e.touches;
      if (touch.mode === 'pinch' && t.length >= 2) {
        var d = touchDist(t);
        if (d > 0 && touch.d > 0) {
          view.dist = Math.max(4, Math.min(320, touch.dist * (touch.d / d)));
        }
      } else if (t.length === 1) {
        view.yaw -= (t[0].clientX - touch.x) * 0.4;
        view.pitch = Math.max(-5, Math.min(85, view.pitch + (t[0].clientY - touch.y) * 0.3));
        touch.x = t[0].clientX; touch.y = t[0].clientY;
      }
      frame();
    }
    function onTouchEnd() { touch = null; }

    canvas.addEventListener('mousedown', onDown);
    root.addEventListener('mousemove', onMove);
    root.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    /* Click to select, using the same ray maths the tests exercise. */
    function pickAt(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      var ray = S3.screenRay(clientX - r.left, clientY - r.top, r.width, r.height,
                             eye(), target(), fovY(), 0.1, 800);
      var hit = S3.pick(meshes, ray.origin, ray.dir);
      return hit ? hit.id : null;
    }

    return {
      setPlan: setPlan,
      render: frame,
      pickAt: pickAt,
      select: function (id) { selectedId = id; frame(); },
      selected: function () { return selectedId; },
      lookThrough: function (id) { lockedCamera = id || null; frame(); },
      lockedCamera: function () { return lockedCamera; },
      frameAll: function () {
        if (!currentPlan) return;
        var b = S3.buildScene(currentPlan).bounds;
        view.target = [b.w / 2, 3, b.d / 2];
        view.dist = Math.max(b.w, b.d) * 1.7 + 10;
        view.yaw = 28; view.pitch = 26;
        frame();
      },
      view: view,
      snapshot: function () {
        frame();                                 // ensure the buffer holds this frame
        try { return canvas.toDataURL('image/png'); } catch (e) { return null; }
      },
      destroy: function () {
        root.removeEventListener('mousemove', onMove);
        root.removeEventListener('mouseup', onUp);
      }
    };
  }

  root.CSetGL = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
