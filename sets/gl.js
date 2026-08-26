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
      linePos: gl.createBuffer(), lineCol: gl.createBuffer(),
      framePos: gl.createBuffer(), frameCol: gl.createBuffer()
    };
    var tri = null, lineCount = 0, meshes = [], meshRanges = [];

    /* ── frame lines ─────────────────────────────────────────────────
       Drawn in clip space with identity matrices, so they sit on the frame
       rather than in the set: the frame edge, the 90% action-safe box, the
       80% title-safe box and a centre cross. Every monitor on the floor has
       these; a viewport that claims to be a lens should too. */
    var FRAME = (function () {
      var pos = [], col = [];
      function rect(k, c) {
        var p = [[-k, -k], [k, -k], [k, k], [-k, k]];
        for (var i = 0; i < 4; i++) {
          var a = p[i], b = p[(i + 1) % 4];
          pos.push(a[0], a[1], 0, b[0], b[1], 0);
          col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
        }
      }
      var edge = [0.79, 0.66, 0.42], safe = [0.55, 0.64, 0.72];
      rect(0.999, edge); rect(0.9, safe); rect(0.8, safe);
      var m = 0.035;
      pos.push(-m, 0, 0, m, 0, 0, 0, -m, 0, 0, m, 0);
      for (var j = 0; j < 4; j++) col.push(edge[0], edge[1], edge[2]);
      return { pos: new Float32Array(pos), col: new Float32Array(col), count: pos.length / 3 };
    })();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.framePos);
    gl.bufferData(gl.ARRAY_BUFFER, FRAME.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.frameCol);
    gl.bufferData(gl.ARRAY_BUFFER, FRAME.col, gl.STATIC_DRAW);
    var IDENT = new Float32Array(S3.mat4());

    /* Orbit state, in feet and degrees. */
    var view = { target: [12, 3, 9], dist: 46, yaw: 28, pitch: 26, fov: 52 };
    var lockedCamera = null;                    // an item id while looking through a lens
    var selectedId = null;
    var currentPlan = null;

    /* ── the lock, and why it has to clear itself ────────────────────
       `lockedCamera` is a bare id, and an id outlives the thing it names:
       delete the camera you are looking through and it still reads as
       locked. Nothing used to notice. lensView() returned null, and fovY()
       and frameRect() quietly fell through to the ORBIT fov and the CANVAS
       aspect — so the viewport went on calling itself a lens while its
       horizontal coverage was the panel's shape again: 39.6° at 1024×768,
       60.5° at 1280×720, 93.1° at 1680×620 on the same "35 mm". The
       letterbox switched off, the caption fell back to a bare "Through
       camera", and input stayed blocked, so there was no way out of it.
       That is the exact defect the sensor work removed, hiding behind one
       delete.

       So the lock validates itself: the moment its camera stops existing —
       deleted, or on a plan we just switched away from — it is dropped and
       the host is told, so look-through can be left visibly instead of
       silently. After that fovY() and frameRect() are answering for free
       orbit honestly, not for a lens that is not there. */
    function lockValid() {
      var it = itemById(lockedCamera);
      return !!(it && it.type === 'camera');
    }
    var releasing = false;
    function releaseLock() {
      if (!lockedCamera || releasing) return;
      lockedCamera = null;
      releasing = true;
      try { if (typeof opts.onLockLost === 'function') opts.onLockLost(); } catch (e) {}
      releasing = false;
    }
    function syncLock() { if (lockedCamera && !lockValid()) releaseLock(); }

    /* One call, so fovY and aspect can never come from two different places
       again — which is exactly how the lens ended up widening when the
       browser window did. */
    function lensView() {
      syncLock();
      if (!lockedCamera) return null;
      return S3.cameraView(itemById(lockedCamera), null, currentPlan && currentPlan.sensor);
    }
    function eye() {
      var v = lensView();
      if (v) return v.eye;
      return S3.orbitEye(view.target, view.dist, view.yaw, view.pitch);
    }
    function target() {
      var v = lensView();
      return v ? v.target : view.target;
    }
    function fovY() {
      var v = lensView();
      /* No view means no lens — lensView() has already dropped a lock that
         no longer names a camera, so the orbit fov below can never be handed
         out as a lens's answer. */
      return v ? v.fovY : view.fov;
    }
    /* The frame the lens actually covers, in device pixels: the format's
       aspect, letterboxed inside whatever shape the panel happens to be.
       Free orbit is not a lens, so it keeps the whole panel. */
    function frameRect() {
      var cw = canvas.width || 1, ch = canvas.height || 1;
      var v = lensView();
      /* The panel's shape is only ever the frame when we are NOT a lens.
         lensView() guarantees that by clearing a stale lock; the assertion
         below is what makes a future regression loud instead of a fake lens. */
      if (!v || !(v.aspect > 0)) {
        if (lockedCamera) releaseLock();
        return { x: 0, y: 0, w: cw, h: ch, aspect: cw / ch, letterboxed: false };
      }
      var w = cw, h = Math.round(cw / v.aspect);
      if (h > ch) { h = ch; w = Math.round(ch * v.aspect); }
      return { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2), w: w, h: h,
               aspect: v.aspect, letterboxed: w < cw - 1 || h < ch - 1 };
    }
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
        var v = S3.cameraView(it, null, plan && plan.sensor);
        var fovH = v.fovX * Math.PI / 360;
        var fovV = v.fovY * Math.PI / 360;
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
      /* Bars first, over the whole panel, then the frame itself. Anything
         outside the format is matte, not extra coverage. */
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.02, 0.03, 0.05, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      var rect = frameRect();
      gl.viewport(rect.x, rect.y, rect.w, rect.h);
      gl.scissor(rect.x, rect.y, rect.w, rect.h);
      gl.enable(gl.SCISSOR_TEST);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      /* Faces wind counter-clockwise from outside (lib-set3d.js), so the back
         of a face is never meant to be seen. Culling makes a winding error
         show up as a missing wall instead of as nothing at all — which is how
         every normal in this engine pointed inward for as long as it did. */
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.clearColor(0.043, 0.086, 0.157, 1);        // matches the app's --base
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!tri) { gl.disable(gl.SCISSOR_TEST); return; }

      var proj = S3.perspective(fovY(), rect.aspect || 1, 0.1, 800);
      var vw = S3.lookAt(eye(), target(), [0, 1, 0]);

      /* grid + frustums — lines are not culled, so this is unaffected */
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

      /* frame lines, last and on top of everything */
      if (lockedCamera) {
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(lines);
        gl.uniformMatrix4fv(gl.getUniformLocation(lines, 'uProj'), false, IDENT);
        gl.uniformMatrix4fv(gl.getUniformLocation(lines, 'uView'), false, IDENT);
        bind(lines, 'aPos', buf.framePos, 3);
        bind(lines, 'aColor', buf.frameCol, 3);
        gl.drawArrays(gl.LINES, 0, FRAME.count);
        gl.enable(gl.DEPTH_TEST);
      }
      gl.disable(gl.SCISSOR_TEST);
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
      /* Pick against the FRAME, not the panel. In free orbit they are the
         same rectangle; through a lens the frame is letterboxed inside the
         panel, and a ray cast against the panel would miss by the width of
         the bars. */
      var f = frameRect(), sx = r.width / (canvas.width || 1), sy = r.height / (canvas.height || 1);
      var fx = r.left + f.x * sx, fw = f.w * sx;
      var fy = r.top + (canvas.height - f.y - f.h) * sy, fh = f.h * sy;
      var ray = S3.screenRay(clientX - fx, clientY - fy, fw, fh,
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
      /* What the viewport is currently showing, so the caption can state the
         format instead of guessing at it. */
      lensFrame: function () {
        var v = lensView(), r = frameRect();
        return { aspect: r.aspect, letterboxed: r.letterboxed,
                 width: r.w, height: r.h,
                 sensor: v ? v.sensor : null, sensorKey: v ? v.sensorKey : null,
                 fovX: v ? v.fovX : null, fovY: v ? v.fovY : fovY(),
                 lens: v ? v.lens : null };
      },
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
