/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Set Designer engine (CSet)
   Pure logic, no DOM: top-down set/stage plans measured in feet — flats,
   doors, furniture, camera positions with true lens fields of view, and
   lighting throws — rendered to an SVG string the UI displays and exports.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* Stencil catalog — sizes in feet (w × h at rot 0). kind drives drawing. */
  var STENCILS = {
    wall:       { label: 'Wall / flat',   w: 10,  h: 0.5, kind: 'wall' },
    door:       { label: 'Door',          w: 3,   h: 0.5, kind: 'door' },
    window:     { label: 'Window',        w: 4,   h: 0.4, kind: 'window' },
    table:      { label: 'Table',         w: 5,   h: 3,   kind: 'rect' },
    chair:      { label: 'Chair',         w: 1.6, h: 1.6, kind: 'rect' },
    sofa:       { label: 'Sofa',          w: 7,   h: 3,   kind: 'rect' },
    bed:        { label: 'Bed',           w: 6.5, h: 5,   kind: 'rect' },
    desk:       { label: 'Desk',          w: 5,   h: 2.5, kind: 'rect' },
    counter:    { label: 'Counter',       w: 8,   h: 2,   kind: 'rect' },
    shelf:      { label: 'Shelf',         w: 3,   h: 1,   kind: 'rect' },
    rug:        { label: 'Rug',           w: 8,   h: 5,   kind: 'soft' },
    plant:      { label: 'Plant',         w: 1.5, h: 1.5, kind: 'round' },
    piano:      { label: 'Piano',         w: 5,   h: 6,   kind: 'rect' },
    vehicle:    { label: 'Vehicle',       w: 15,  h: 6,   kind: 'rect' },
    greenscreen:{ label: 'Green screen',  w: 12,  h: 0.5, kind: 'green' },
    person:     { label: 'Blocking mark', w: 1.2, h: 1.2, kind: 'person' },
    camera:     { label: 'Camera',        w: 1.6, h: 1.6, kind: 'camera', lens: 35, fstop: 2.8 },
    light:      { label: 'Light',         w: 1.4, h: 1.4, kind: 'light' },
    custom:     { label: 'Custom box',    w: 4,   h: 4,   kind: 'rect' }
  };

  function uid() { return 'i' + Math.random().toString(36).slice(2, 9); }

  function newDoc() {
    var d = { v: 1, active: null, plans: [] };
    var p = newPlan(d, 'Set 1 — Untitled', 24, 18);
    d.active = p.id;
    return d;
  }
  function newPlan(doc, name, wFt, hFt, sensorKey) {
    /* A plan carries the format it is shot on. Every field of view drawn on
       it — and every frustum the 3D view stands up from it — is answered from
       this one key, so the plan and the viewport cannot disagree. */
    var p = { id: uid(), name: name || 'New set', w: wFt || 24, h: hFt || 18,
              sensor: sensorOf(sensorKey).key, scenes: '', items: [] };
    doc.plans.push(p);
    return p;
  }
  function addItem(plan, type, x, y) {
    var s = STENCILS[type] || STENCILS.custom;
    var it = { id: uid(), type: type, x: snap(x != null ? x : plan.w / 2), y: snap(y != null ? y : plan.h / 2),
               w: s.w, h: s.h, rot: 0, label: '' };
    if (s.kind === 'camera') { it.lens = s.lens; it.fstop = s.fstop; }
    plan.items.push(it);
    return it;
  }
  function removeItem(plan, id) {
    var n = plan.items.length;
    plan.items = plan.items.filter(function (i) { return i.id !== id; });
    return n !== plan.items.length;
  }
  function itemById(plan, id) {
    return plan.items.filter(function (i) { return i.id === id; })[0] || null;
  }

  function snap(v, grid) { grid = grid || 0.5; return Math.round(v / grid) * grid; }

  /* Point-in-rotated-rect: transform the point into the item's local frame. */
  function hitTest(plan, x, y) {
    for (var i = plan.items.length - 1; i >= 0; i--) {
      var it = plan.items[i];
      var rad = -(it.rot || 0) * Math.PI / 180;
      var dx = x - it.x, dy = y - it.y;
      var lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      var ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      var pad = 0.3; // finger slop in feet
      if (Math.abs(lx) <= it.w / 2 + pad && Math.abs(ly) <= it.h / 2 + pad) return it;
    }
    return null;
  }

  /* ── the sensor ───────────────────────────────────────────────────────
     THE table is TMedia.SENSORS in tools/lib-media.js. This module used to
     carry its own 36 mm full-frame assumption while the 3D engine carried a
     Super 35 one, so a 35 mm lens printed 54.4° under a viewport drawing
     39.2°. There is now one table and one answer.

     It is a soft dependency, not a hard one: props/index.html loads the sets
     geometry without the tools bundle, so an absent TMedia falls back to the
     default format's numbers — COPIED from that table, with a test asserting
     the copy still matches it, so the fallback cannot drift into a fourth
     sensor. */
  var FALLBACK_SENSOR = { key: 'super35', label: 'Super 35 (24.9×18.7)', w: 24.9, h: 18.7 };

  function sensorOf(key) {
    var M = root.TMedia;
    if (M && M.SENSORS) {
      var k = M.sensorKey ? M.sensorKey(key) : (M.SENSORS[key] ? key : 'super35');
      var s = M.SENSORS[k];
      if (s) return { key: k, label: s.label, w: s.w, h: s.h };
    }
    return FALLBACK_SENSOR;
  }
  /* The format a plan is shot on, defaulting for plans saved before the field
     existed. */
  function planSensor(plan) { return sensorOf(plan && plan.sensor); }

  /* Horizontal field of view, on the plan's format. */
  function fovDeg(lensMm, sensorKey) {
    var f = +lensMm > 0 ? +lensMm : 35;
    var s = sensorOf(sensorKey);
    return Math.round(2 * Math.atan(s.w / (2 * f)) * 180 / Math.PI * 10) / 10;
  }
  function fovDegV(lensMm, sensorKey) {
    var f = +lensMm > 0 ? +lensMm : 35;
    var s = sensorOf(sensorKey);
    return Math.round(2 * Math.atan(s.h / (2 * f)) * 180 / Math.PI * 10) / 10;
  }

  /* ── focus ────────────────────────────────────────────────────────────
     What is the camera actually focused on? The blocking mark it is pointed
     at, which is the answer a 1st AC would give. Falls back to a sane 12 ft
     when nobody has marked the scene, and is overridable per camera. */
  var FT_PER_M = 3.280839895;
  function focusFor(plan, cam) {
    if (cam && +cam.focus > 0) return +cam.focus;
    var best = null;
    var r = (+((cam && cam.rot) || 0)) * Math.PI / 180;
    var ax = Math.sin(r), ay = -Math.cos(r);          // the way the cone points
    ((plan && plan.items) || []).forEach(function (it) {
      if (it.type !== 'person') return;
      var dx = it.x - cam.x, dy = it.y - cam.y;
      var d = Math.hypot(dx, dy);
      if (d < 0.5) return;
      if ((dx * ax + dy * ay) / d < 0.5) return;      // behind, or well off axis
      if (best == null || d < best) best = d;
    });
    return best == null ? 12 : Math.round(best * 10) / 10;
  }
  /* Depth of field for a camera on a plan, in FEET — the unit the plan and
     the tape measure on stage are both in. Null when TMedia is not loaded. */
  function dofFor(plan, cam) {
    var M = root.TMedia;
    if (!M || !M.dof || !cam) return null;
    var focusFt = focusFor(plan, cam);
    var d = M.dof(planSensor(plan).key, +cam.lens || 35, +cam.fstop > 0 ? +cam.fstop : 2.8,
                  focusFt / FT_PER_M);
    var ft = function (v) { return v == null ? null : (v === Infinity ? Infinity : Math.round(v * FT_PER_M * 10) / 10); };
    return { focus: focusFt, fstop: d.fStop, near: ft(d.near), far: ft(d.far),
             hyperfocal: ft(d.hyperfocal), coc: d.coc };
  }

  /* ── SVG rendering ────────────────────────────────────────────────────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function itemSVG(it, ppf, selected, plan) {
    var s = STENCILS[it.type] || STENCILS.custom;
    var w = it.w * ppf, h = it.h * ppf, cx = it.x * ppf, cy = it.y * ppf;
    var stroke = selected ? '#C9A86C' : '#8BA3B8';
    var g = '<g data-id="' + esc(it.id) + '" transform="translate(' + cx + ' ' + cy + ') rotate(' + esc(it.rot || 0) + ')" style="cursor:move">';
    if (s.kind === 'camera') {
      var fov = fovDeg(it.lens, plan && plan.sensor), half = fov / 2 * Math.PI / 180, len = 12 * ppf;
      g += '<path d="M0 0 L' + (Math.sin(-half) * len) + ' ' + (-Math.cos(-half) * len) +
           ' A' + len + ' ' + len + ' 0 0 1 ' + (Math.sin(half) * len) + ' ' + (-Math.cos(half) * len) +
           ' Z" fill="rgba(91,141,184,.12)" stroke="rgba(91,141,184,.5)" stroke-dasharray="4 3"/>';
      /* The band that is actually sharp, drawn across the cone. A cone tells
         you what is in frame; this tells you what is in focus, which is the
         other half of "can I put the mark there". */
      var band = dofFor(plan, it);
      if (band && band.near) {
        var arc = function (rFt) {
          var r = Math.min(rFt, 60) * ppf;
          return 'M' + (Math.sin(-half) * r) + ' ' + (-Math.cos(-half) * r) +
                 ' A' + r + ' ' + r + ' 0 0 1 ' + (Math.sin(half) * r) + ' ' + (-Math.cos(half) * r);
        };
        g += '<path d="' + arc(band.near) + '" fill="none" stroke="rgba(201,168,108,.55)" stroke-width="1.5"/>';
        if (band.far !== Infinity) {
          g += '<path d="' + arc(band.far) + '" fill="none" stroke="rgba(201,168,108,.55)" stroke-width="1.5"/>';
        }
      }
      g += '<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="2" fill="#1A2F4A" stroke="' + stroke + '" stroke-width="1.5"/>';
      g += '<text y="4" text-anchor="middle" font-size="' + (ppf * 0.9) + '" fill="#C9A86C" font-family="monospace">' + esc(it.lens || 35) + '</text>';
    } else if (s.kind === 'light') {
      var lh = 20 * Math.PI / 180, ll = 9 * ppf;
      g += '<path d="M0 0 L' + (Math.sin(-lh) * ll) + ' ' + (-Math.cos(-lh) * ll) +
           ' L' + (Math.sin(lh) * ll) + ' ' + (-Math.cos(lh) * ll) +
           ' Z" fill="rgba(201,168,108,.10)" stroke="rgba(201,168,108,.45)" stroke-dasharray="3 3"/>';
      g += '<circle r="' + (w / 2) + '" fill="#1A2F4A" stroke="' + stroke + '" stroke-width="1.5"/>' +
           '<circle r="' + (w / 5) + '" fill="#C9A86C"/>';
    } else if (s.kind === 'door') {
      g += '<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" fill="#12253A" stroke="' + stroke + '" stroke-width="1.5"/>';
      g += '<path d="M' + (-w / 2) + ' ' + (-h / 2) + ' A' + w + ' ' + w + ' 0 0 1 ' + (w / 2) + ' ' + (-h / 2 - w) +
           '" fill="none" stroke="' + stroke + '" stroke-dasharray="3 3" opacity=".7"/>';
    } else if (s.kind === 'person') {
      g += '<circle r="' + (w / 2) + '" fill="none" stroke="' + stroke + '" stroke-width="1.5"/>' +
           '<path d="M0 ' + (-w / 2) + ' V' + (w / 2) + ' M' + (-w / 2) + ' 0 H' + (w / 2) + '" stroke="' + stroke + '" opacity=".7"/>';
    } else if (s.kind === 'round') {
      g += '<circle r="' + (w / 2) + '" fill="#12253A" stroke="' + stroke + '" stroke-width="1.5"/>';
    } else {
      var fill = s.kind === 'wall' ? '#8BA3B8' : s.kind === 'green' ? 'rgba(60,160,90,.5)' : s.kind === 'soft' ? 'rgba(139,163,184,.12)' : '#12253A';
      g += '<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="2" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"' + (s.kind === 'soft' ? ' stroke-dasharray="5 4"' : '') + '/>';
    }
    var name = it.label || (s.kind === 'rect' || s.kind === 'soft' || s.kind === 'round' ? s.label : '');
    if (name) g += '<text y="' + (h / 2 + ppf * 1.1) + '" text-anchor="middle" font-size="' + (ppf * 0.95) + '" fill="#8BA3B8" font-family="Inter,sans-serif">' + esc(name) + '</text>';
    return g + '</g>';
  }

  /* toSVG(plan, ppf, {sel}) → complete standalone SVG string. */
  function toSVG(plan, ppf, opts) {
    ppf = ppf || 8;
    opts = opts || {};
    var W = plan.w * ppf, H = plan.h * ppf;
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" data-plan="' + esc(plan.id) + '">';
    out += '<rect width="' + W + '" height="' + H + '" fill="#0A1628"/>';
    for (var gx = 0; gx <= plan.w; gx++) {
      out += '<line x1="' + gx * ppf + '" y1="0" x2="' + gx * ppf + '" y2="' + H + '" stroke="' + (gx % 5 ? 'rgba(139,163,184,.07)' : 'rgba(139,163,184,.16)') + '"/>';
    }
    for (var gy = 0; gy <= plan.h; gy++) {
      out += '<line x1="0" y1="' + gy * ppf + '" x2="' + W + '" y2="' + gy * ppf + '" stroke="' + (gy % 5 ? 'rgba(139,163,184,.07)' : 'rgba(139,163,184,.16)') + '"/>';
    }
    plan.items.forEach(function (it) { out += itemSVG(it, ppf, opts.sel === it.id, plan); });
    /* scale bar: 5 ft */
    var bx = ppf, by = H - ppf;
    out += '<g font-family="monospace" font-size="' + (ppf * 0.9) + '" fill="#8BA3B8">' +
      '<line x1="' + esc(bx) + '" y1="' + by + '" x2="' + (bx + 5 * ppf) + '" y2="' + by + '" stroke="#C9A86C" stroke-width="2"/>' +
      '<text x="' + (bx + 5 * ppf + 4) + '" y="' + (by + 3) + '">5 ft</text>' +
      '<text x="' + esc(bx) + '" y="' + (ppf * 1.4) + '">' + esc(plan.name) + ' — ' + esc(plan.w) + '′ × ' + esc(plan.h) + '′</text>' +
      /* The plan states the format it was drawn for. A cone with no sensor
         beside it is a number nobody can check. */
      '<text x="' + esc(bx) + '" y="' + (ppf * 2.6) + '">' + esc(planSensor(plan).label) + '</text></g>';
    return out + '</svg>';
  }

  root.CSet = {
    STENCILS: STENCILS, FALLBACK_SENSOR: FALLBACK_SENSOR,
    newDoc: newDoc, newPlan: newPlan, addItem: addItem, removeItem: removeItem, itemById: itemById,
    snap: snap, hitTest: hitTest,
    sensorOf: sensorOf, planSensor: planSensor,
    fovDeg: fovDeg, fovDegV: fovDegV,
    focusFor: focusFor, dofFor: dofFor,
    toSVG: toSVG
  };
})(typeof window !== 'undefined' ? window : globalThis);
