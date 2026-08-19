/* TMedia — camera & media math:
 *  1. .cube LUT parser + trilinear apply (the public IRIDAS/Adobe text
 *     format: TITLE / LUT_3D_SIZE / DOMAIN_MIN / DOMAIN_MAX / RGB rows).
 *  2. Lens field-of-view / coverage optics (thin-lens trigonometry).
 *  3. Media hash manifest — MHL-style sidecar with per-file SHA-256,
 *     verifiable on re-scan (hash function injected: WebCrypto in the
 *     browser, node:crypto in tests).
 *
 * All original code, written for Cinamate.
 */
(function (root) {
  'use strict';

  /* ── 1. .cube LUT ────────────────────────────────────────────── */
  function parseCube(text) {
    var size = 0, title = '', domMin = [0, 0, 0], domMax = [1, 1, 1], data = [];
    String(text || '').split(/\r?\n/).forEach(function (ln) {
      ln = ln.trim();
      if (!ln || ln[0] === '#') return;
      var up = ln.toUpperCase();
      if (up.indexOf('TITLE') === 0) { title = (ln.match(/"([^"]*)"/) || [, ''])[1]; return; }
      if (up.indexOf('LUT_3D_SIZE') === 0) { size = parseInt(ln.split(/\s+/)[1], 10); return; }
      if (up.indexOf('LUT_1D_SIZE') === 0) { throw new Error('1D LUTs not supported — use a 3D .cube'); }
      if (up.indexOf('DOMAIN_MIN') === 0) { domMin = ln.split(/\s+/).slice(1, 4).map(Number); return; }
      if (up.indexOf('DOMAIN_MAX') === 0) { domMax = ln.split(/\s+/).slice(1, 4).map(Number); return; }
      var p = ln.split(/\s+/);
      if (p.length >= 3 && isFinite(+p[0])) data.push(+p[0], +p[1], +p[2]);
    });
    if (!size || data.length < size * size * size * 3) throw new Error('Malformed .cube: expected ' + (size * size * size) + ' rows, got ' + data.length / 3);
    return { title: title, size: size, domMin: domMin, domMax: domMax, data: new Float32Array(data) };
  }

  /* Trilinear sample: r,g,b in 0–1 → [r,g,b]. Red varies fastest (spec). */
  function sampleLut(lut, r, g, b) {
    var N = lut.size, M = N - 1, d = lut.data;
    function cl(x) { return Math.min(1, Math.max(0, x)); }
    var x = cl(r) * M, y = cl(g) * M, z = cl(b) * M;
    var x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    var x1 = Math.min(M, x0 + 1), y1 = Math.min(M, y0 + 1), z1 = Math.min(M, z0 + 1);
    var fx = x - x0, fy = y - y0, fz = z - z0;
    function at(i, j, k) { var o = 3 * (i + N * (j + N * k)); return [d[o], d[o + 1], d[o + 2]]; }
    function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    var c00 = mix(at(x0, y0, z0), at(x1, y0, z0), fx), c10 = mix(at(x0, y1, z0), at(x1, y1, z0), fx);
    var c01 = mix(at(x0, y0, z1), at(x1, y0, z1), fx), c11 = mix(at(x0, y1, z1), at(x1, y1, z1), fx);
    return mix(mix(c00, c10, fy), mix(c01, c11, fy), fz);
  }

  /* Apply to ImageData pixels in place (browser). */
  function applyLutToPixels(lut, px) {
    for (var i = 0; i < px.length; i += 4) {
      var out = sampleLut(lut, px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
      px[i] = Math.round(Math.min(1, Math.max(0, out[0])) * 255);
      px[i + 1] = Math.round(Math.min(1, Math.max(0, out[1])) * 255);
      px[i + 2] = Math.round(Math.min(1, Math.max(0, out[2])) * 255);
    }
  }

  /* ── 2. lens optics ──────────────────────────────────────────── */
  var SENSORS = {
    'super35':      { label: 'Super 35 (24.9×18.7)', w: 24.9, h: 18.7 },
    'super35-17x9': { label: 'Super 35 17:9 (24.6×13.1)', w: 24.6, h: 13.1 },
    'fullframe':    { label: 'Full frame (36×24)', w: 36, h: 24 },
    'alexa-lf':     { label: 'ARRI LF (36.7×25.5)', w: 36.7, h: 25.5 },
    'alexa-65':     { label: 'ARRI 65 (54.1×25.6)', w: 54.1, h: 25.6 },
    'red-vv':       { label: 'RED V-RAPTOR VV (40.96×21.6)', w: 40.96, h: 21.6 },
    'mft':          { label: 'Micro 4/3 (17.3×13)', w: 17.3, h: 13 },
    's16':          { label: 'Super 16 (12.52×7.41)', w: 12.52, h: 7.41 },
    'iphone-main':  { label: 'Phone main cam (~9.8×7.3)', w: 9.8, h: 7.3 }
  };
  function fov(sensorW, focal) { return 2 * Math.atan(sensorW / (2 * focal)) * 180 / Math.PI; }
  /* Coverage width at subject distance (same units as distance). */
  function coverage(sensorW, focal, distance) { return distance * sensorW / focal; }
  function lensCalc(sensorKey, focalMm, distanceM) {
    var s = SENSORS[sensorKey] || SENSORS.super35;
    return {
      sensor: s.label,
      hfov: Math.round(fov(s.w, focalMm) * 10) / 10,
      vfov: Math.round(fov(s.h, focalMm) * 10) / 10,
      widthAt: distanceM ? Math.round(coverage(s.w, focalMm, distanceM) * 100) / 100 : null,
      heightAt: distanceM ? Math.round(coverage(s.h, focalMm, distanceM) * 100) / 100 : null,
      /* focal length giving the same HFOV on full frame (the common ref) */
      ffEquiv: Math.round(focalMm * 36 / s.w)
    };
  }

  /* ── 3. media hash manifest (MHL-style) ──────────────────────── */
  /* entries: [{path, size, sha256}] → XML sidecar; verify() re-checks. */
  function manifestXml(entries, meta) {
    meta = meta || {};
    var lines = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<cinamatemanifest version="1.0">',
      '  <creatorinfo>',
      '    <tool>Cinamate Tools</tool>',
      '    <created>' + (meta.created || new Date().toISOString()) + '</created>',
      (meta.project ? '    <project>' + xmlEsc(meta.project) + '</project>' : ''),
      '  </creatorinfo>'];
    entries.forEach(function (e) {
      lines.push('  <hash>',
        '    <path>' + xmlEsc(e.path) + '</path>',
        '    <size>' + (e.size || 0) + '</size>',
        '    <sha256>' + e.sha256 + '</sha256>',
        '  </hash>');
    });
    lines.push('</cinamatemanifest>');
    return lines.filter(Boolean).join('\n');
  }
  function parseManifest(xml) {
    var out = [];
    var re = /<hash>[\s\S]*?<path>([\s\S]*?)<\/path>[\s\S]*?<size>(\d+)<\/size>[\s\S]*?<sha256>([0-9a-f]+)<\/sha256>[\s\S]*?<\/hash>/g, m;
    while ((m = re.exec(xml))) out.push({ path: xmlUnesc(m[1]), size: +m[2], sha256: m[3] });
    return out;
  }
  function verifyAgainst(manifestEntries, scanned) {
    var byPath = {};
    manifestEntries.forEach(function (e) { byPath[e.path] = e; });
    var ok = [], changed = [], missing = [], extra = [];
    scanned.forEach(function (s) {
      var m = byPath[s.path];
      if (!m) { extra.push(s.path); return; }
      if (m.sha256 === s.sha256 && (+m.size === +s.size)) ok.push(s.path);
      else changed.push(s.path);
      delete byPath[s.path];
    });
    Object.keys(byPath).forEach(function (p) { missing.push(p); });
    return { ok: ok, changed: changed, missing: missing, extra: extra,
      clean: changed.length === 0 && missing.length === 0 };
  }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function xmlUnesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

  root.TMedia = { parseCube: parseCube, sampleLut: sampleLut, applyLutToPixels: applyLutToPixels,
    SENSORS: SENSORS, lensCalc: lensCalc,
    manifestXml: manifestXml, parseManifest: parseManifest, verifyAgainst: verifyAgainst };
})(typeof window !== 'undefined' ? window : globalThis);
