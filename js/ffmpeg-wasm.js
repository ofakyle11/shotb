/* SHOTBREAK — FFmpeg.wasm loader (custom blob worker, no @ffmpeg/ffmpeg CDN worker) */
window.SBFFmpeg = (function () {
  'use strict';

  let cached = null;

  function assertIsolated() {
    if (typeof self !== 'undefined' && !self.crossOriginIsolated) {
      throw new Error(
        'Browser is not cross-origin isolated. Hard-refresh (Ctrl+Shift+R) on shotbreak.io/timeline/ and try again.'
      );
    }
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('SharedArrayBuffer unavailable — FFmpeg needs HTTPS with COOP/COEP headers.');
    }
  }

  async function loadFFmpeg(onProgress) {
    if (cached && cached.loaded) return cached;
    assertIsolated();

    const CORE = '/static/ffmpeg/ffmpeg-core.js';
    const WASM = '/static/ffmpeg/ffmpeg-core.wasm';

    if (onProgress) onProgress('Loading FFmpeg core…');
    const [coreRes, wasmRes] = await Promise.all([fetch(CORE), fetch(WASM)]);
    if (!coreRes.ok || !wasmRes.ok) {
      throw new Error('Could not load /static/ffmpeg/ffmpeg-core (HTTP ' + coreRes.status + '/' + wasmRes.status + ')');
    }
    const coreJsText = await coreRes.text();
    const wasmBuf = await wasmRes.arrayBuffer();

    if (onProgress) onProgress('Starting FFmpeg worker…');

    const workerSource =
      coreJsText + '\n;\n' +
      'let __core = null;\n' +
      'self.addEventListener("message", async (e) => {\n' +
      '  const { id, cmd, data } = e.data || {};\n' +
      '  try {\n' +
      '    let result;\n' +
      '    switch (cmd) {\n' +
      '      case "load":\n' +
      '        if (typeof createFFmpegCore !== "function") throw new Error("createFFmpegCore missing");\n' +
      '        __core = await createFFmpegCore({\n' +
      '          wasmBinary: new Uint8Array(data.wasmBytes),\n' +
      '          print: (msg) => self.postMessage({ type: "log", message: String(msg) }),\n' +
      '          printErr: (msg) => self.postMessage({ type: "log", message: "[err] " + String(msg) }),\n' +
      '        });\n' +
      '        if (__core.setLogger) __core.setLogger((evt) => self.postMessage({ type: "log", message: (evt && evt.message) || String(evt) }));\n' +
      '        if (__core.setProgress) __core.setProgress((evt) => self.postMessage({ type: "progress", progress: (evt && evt.progress) || 0 }));\n' +
      '        result = { ok: true };\n' +
      '        break;\n' +
      '      case "writeFile":\n' +
      '        __core.FS.writeFile(data.name, data.bytes);\n' +
      '        result = true;\n' +
      '        break;\n' +
      '      case "readFile":\n' +
      '        result = __core.FS.readFile(data.name);\n' +
      '        break;\n' +
      '      case "deleteFile":\n' +
      '        try { __core.FS.unlink(data.name); } catch (_) {}\n' +
      '        result = true;\n' +
      '        break;\n' +
      '      case "exec":\n' +
      '        if (__core.setTimeout) __core.setTimeout(data.timeout != null ? data.timeout : -1);\n' +
      '        __core.exec(...data.args);\n' +
      '        result = (__core.ret != null) ? __core.ret : 0;\n' +
      '        if (__core.reset) __core.reset();\n' +
      '        break;\n' +
      '      default:\n' +
      '        throw new Error("unknown cmd: " + cmd);\n' +
      '    }\n' +
      '    self.postMessage({ id, ok: true, result });\n' +
      '  } catch (err) {\n' +
      '    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });\n' +
      '  }\n' +
      '});\n' +
      'self.postMessage({ type: "ready" });\n';

    const workerBlobURL = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    let worker;
    try {
      worker = await new Promise((resolve, reject) => {
        const w = new Worker(workerBlobURL);
        const timeout = setTimeout(() => {
          w.terminate();
          reject(new Error('FFmpeg worker startup timeout (30s)'));
        }, 30000);
        const fail = (msg) => {
          clearTimeout(timeout);
          w.terminate();
          reject(new Error(msg));
        };
        w.addEventListener('error', (ev) => fail('Worker error: ' + (ev.message || 'unknown')));
        w.addEventListener('message', (e) => {
          if (e.data && e.data.type === 'ready') {
            clearTimeout(timeout);
            resolve(w);
          }
        });
      });
    } catch (e) {
      URL.revokeObjectURL(workerBlobURL);
      throw e;
    }

    let nextId = 1;
    const pending = new Map();
    let onProgressCb = null;

    worker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'progress' && onProgressCb) {
        onProgressCb('Rendering ' + Math.round((d.progress || 0) * 100) + '%');
        return;
      }
      if (d.id == null) return;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d.result);
      else p.reject(new Error(d.error || 'FFmpeg worker error'));
    });

    function call(cmd, data, transfer) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, cmd, data }, transfer || []);
      });
    }

    await call('load', { wasmBytes: wasmBuf }, [wasmBuf]);

    cached = {
      loaded: true,
      setProgress(cb) { onProgressCb = cb; },
      writeFile(name, bytes) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        return call('writeFile', { name, bytes: data });
      },
      readFile(name) { return call('readFile', { name }); },
      deleteFile(name) { return call('deleteFile', { name }); },
      exec(args, timeout) { return call('exec', { args, timeout }); },
    };
    return cached;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ── per-scene color matching (histogram match baked into a Hald CLUT) ── */

  // Grab a middle frame of a video blob as a small canvas (same-origin blob
  // URL — no CORS concerns).
  function frameFromBlob(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      let settled = false;
      const finish = (val) => { if (!settled) { settled = true; URL.revokeObjectURL(url); resolve(val || null); } };
      v.addEventListener('loadedmetadata', () => {
        const t = (v.duration || 4) * 0.5;
        v.currentTime = Number.isFinite(t) ? t : 0;
      });
      v.addEventListener('seeked', () => {
        try {
          const c = document.createElement('canvas');
          const scale = Math.min(1, 320 / (v.videoWidth || 320));
          c.width = Math.round((v.videoWidth || 320) * scale);
          c.height = Math.round((v.videoHeight || 180) * scale);
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          finish(c);
        } catch (e) { finish(null); }
      });
      v.addEventListener('error', () => finish(null));
      setTimeout(() => finish(null), 10000);
      v.src = url;
    });
  }

  function channelHistograms(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const h = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
    for (let i = 0; i < d.length; i += 4) {
      h[0][d[i]]++; h[1][d[i + 1]]++; h[2][d[i + 2]]++;
    }
    return h;
  }

  function cdf(hist) {
    const out = new Float64Array(256);
    let sum = 0, total = 0;
    for (let i = 0; i < 256; i++) total += hist[i];
    for (let i = 0; i < 256; i++) { sum += hist[i]; out[i] = total ? sum / total : 0; }
    return out;
  }

  // Per-channel histogram-matching LUTs mapping target colors onto the hero's
  // distribution. Returns null when the clips already grade alike.
  function matchingLuts(heroCanvas, targetCanvas) {
    const hh = channelHistograms(heroCanvas).map(cdf);
    const th = channelHistograms(targetCanvas).map(cdf);
    const luts = [];
    let totalShift = 0;
    for (let ch = 0; ch < 3; ch++) {
      const lut = new Uint8Array(256);
      let j = 0;
      for (let v = 0; v < 256; v++) {
        while (j < 255 && hh[ch][j] < th[ch][v]) j++;
        lut[v] = j;
        totalShift += Math.abs(j - v);
      }
      luts.push(lut);
    }
    const meanShift = totalShift / (3 * 256);
    if (meanShift < 3) return null;           // already matched
    if (meanShift > 60) return null;          // wildly different content — matching would do harm
    // Soften: blend 70% toward the hero to avoid banding/overcorrection.
    luts.forEach((lut) => {
      for (let v = 0; v < 256; v++) lut[v] = Math.round(v + (lut[v] - v) * 0.7);
    });
    return luts;
  }

  // Bake per-channel LUTs into a level-8 Hald CLUT PNG (512x512, 64^3 colors).
  async function bakeHaldClut(luts) {
    const LEVEL = 8, CUBE = LEVEL * LEVEL; // 64
    const SIZE = LEVEL * LEVEL * LEVEL;    // 512
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    const d = img.data;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const r = (i % CUBE) * 255 / (CUBE - 1);
      const g = (Math.floor(i / CUBE) % CUBE) * 255 / (CUBE - 1);
      const b = Math.floor(i / (CUBE * CUBE)) * 255 / (CUBE - 1);
      d[i * 4] = luts[0][Math.round(r)];
      d[i * 4 + 1] = luts[1][Math.round(g)];
      d[i * 4 + 2] = luts[2][Math.round(b)];
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Per-segment Hald CLUTs: first clip of each scene group is the grading
  // hero; later clips in the group are histogram-matched to it.
  async function buildColorCluts(segments, onProgress) {
    const cluts = new Array(segments.length).fill(null);
    const heroes = {};
    for (let i = 0; i < segments.length; i++) {
      const group = segments[i].group != null ? segments[i].group : 0;
      if (onProgress) onProgress('Color analysis ' + (i + 1) + '/' + segments.length);
      const frame = await frameFromBlob(segments[i].blob);
      if (!frame) continue;
      if (!heroes[group]) { heroes[group] = frame; continue; }
      const luts = matchingLuts(heroes[group], frame);
      if (luts) cluts[i] = await bakeHaldClut(luts);
    }
    return cluts;
  }

  // Native dimensions of a clip (metadata only — no decode needed).
  function dimsFromBlob(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var v = document.createElement('video');
      v.muted = true; v.preload = 'metadata';
      var settled = false;
      var done = function (val) { if (!settled) { settled = true; URL.revokeObjectURL(url); resolve(val); } };
      v.addEventListener('loadedmetadata', function () { done({ w: v.videoWidth || 0, h: v.videoHeight || 0 }); });
      v.addEventListener('error', function () { done(null); });
      setTimeout(function () { done(null); }, 8000);
      v.src = url;
    });
  }

  async function stitchBlobs(blobs, onProgress, opts) {
    const segs = (blobs || []).map((b) => ({ blob: b, trimIn: 0, trimOut: null, transition: 'cut', transitionDur: 0 }));
    return stitchTimeline(segs, onProgress, opts);
  }

  // exec resolves with ffmpeg's exit code rather than throwing — the fallback
  // ladders below need a real rejection on failure.
  async function runFF(ff, args, timeout) {
    const ret = await ff.exec(args, timeout);
    if (ret) throw new Error('ffmpeg exited with code ' + ret);
  }

  async function stitchTimeline(segments, onProgress, opts) {
    if (!segments || !segments.length) throw new Error('No clips to stitch');
    opts = opts || {};

    const ff = await loadFFmpeg(onProgress);
    if (ff.setProgress) ff.setProgress(onProgress);

    let cluts = null;
    if (opts.matchColor && segments.length > 1) {
      try { cluts = await buildColorCluts(segments, onProgress); }
      catch (e) { cluts = null; }
    }

    // Mixed sources (512px local AnimateDiff beside 720p cloud clips) must be
    // normalized — concat needs one size and one fps across every segment.
    // Target = the largest segment, capped at 1080p, letterboxing the rest.
    let targetW = 0, targetH = 0;
    if (segments.length > 1) {
      if (onProgress) onProgress('Checking clip formats…');
      for (let i = 0; i < segments.length; i++) {
        const d = await dimsFromBlob(segments[i].blob);
        segments[i]._dims = d;
        if (d && d.w * d.h > targetW * targetH) { targetW = d.w; targetH = d.h; }
      }
      targetW = Math.min(1920, targetW); targetH = Math.min(1080, targetH);
      targetW -= targetW % 2; targetH -= targetH % 2;
      const uniform = segments.every((s) => s._dims && s._dims.w === targetW && s._dims.h === targetH);
      if (uniform || !targetW) { targetW = 0; targetH = 0; }
    }

    const trimmed = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const raw = 'raw' + i + '.mp4';
      const out = 'trim' + i + '.mp4';
      const buf = s.blob instanceof Blob ? new Uint8Array(await s.blob.arrayBuffer()) : new Uint8Array(s.blob);
      await ff.writeFile(raw, buf);
      const ti = s.trimIn || 0;
      const to = s.trimOut != null ? s.trimOut : null;
      const dur = to != null ? Math.max(0.1, to - ti) : null;
      if (onProgress) onProgress('Trimming clip ' + (i + 1) + '/' + segments.length);
      const clut = cluts && cluts[i] ? 'clut' + i + '.png' : null;
      if (clut) await ff.writeFile(clut, cluts[i]);
      const vw = s.voiceWav ? 'voice' + i + '.wav' : null;
      if (vw) await ff.writeFile(vw, s.voiceWav instanceof Uint8Array ? s.voiceWav : new Uint8Array(s.voiceWav));

      // audioMode — 'mix': duck clip audio under the dialogue track;
      // 'solo': voice only (clip had no audio; apad + -shortest keeps video
      // length authoritative); 'passa': clip audio, strict; 'silence': inject
      // a silent track so every trim has uniform streams for concat; null:
      // legacy optional-audio mapping (last resort).
      const needScale = targetW && s._dims && (s._dims.w !== targetW || s._dims.h !== targetH);
      const buildArgs = (withClut, audioMode) => {
        const a = ['-ss', String(ti), '-i', raw];
        if (dur != null) a.push('-t', String(dur));
        let idx = 1, clutIdx = -1, voiceIdx = -1, silIdx = -1;
        if (withClut) { a.push('-i', clut); clutIdx = idx++; }
        if (audioMode === 'mix' || audioMode === 'solo') { a.push('-i', vw); voiceIdx = idx++; }
        if (audioMode === 'silence') { a.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'); silIdx = idx++; }
        const fc = [];
        let vsrc = '0:v', amap = '0:a?', shortest = false;
        if (withClut) { fc.push('[' + vsrc + '][' + clutIdx + ':v]haldclut[vclut]'); vsrc = 'vclut'; }
        if (needScale) {
          fc.push('[' + (vsrc === '0:v' ? '0:v' : vsrc) + ']scale=' + targetW + ':' + targetH + ':force_original_aspect_ratio=decrease,pad=' + targetW + ':' + targetH + ':(ow-iw)/2:(oh-ih)/2:color=black[vnorm]');
          vsrc = 'vnorm';
        }
        if (audioMode === 'mix') {
          fc.push('[0:a]volume=0.55[bga]');
          fc.push('[' + voiceIdx + ':a]volume=1.0[vox]');
          fc.push('[bga][vox]amix=inputs=2:duration=first:normalize=0[a]');
          amap = '[a]';
        } else if (audioMode === 'solo') {
          fc.push('[' + voiceIdx + ':a]apad[a]');
          amap = '[a]'; shortest = true;
        } else if (audioMode === 'passa') {
          amap = '0:a';
        } else if (audioMode === 'silence') {
          amap = silIdx + ':a'; shortest = true;
        }
        if (fc.length) a.push('-filter_complex', fc.join(';'));
        a.push('-map', (vsrc === '0:v' ? '0:v' : '[' + vsrc + ']'), '-map', amap);
        if (shortest) a.push('-shortest');
        a.push('-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', out);
        return a;
      };
      const attempts = [];
      if (vw) {
        if (clut) attempts.push([true, 'mix'], [true, 'solo']);
        attempts.push([false, 'mix'], [false, 'solo']);
      } else {
        // Strict clip audio first; silent-track fallback keeps concat streams
        // uniform when a clip (e.g. local AnimateDiff) has no audio at all.
        if (clut) attempts.push([true, 'passa'], [true, 'silence']);
        attempts.push([false, 'passa'], [false, 'silence']);
      }
      if (clut) attempts.push([true, null]);
      attempts.push([false, null]);
      let stitched = false, lastErr = null;
      for (const [wc, vm] of attempts) {
        try { await runFF(ff, buildArgs(wc, vm)); stitched = true; break; }
        catch (e) {
          lastErr = e;
          await ff.deleteFile(out).catch(() => {});
          if (onProgress && vm) onProgress('Audio mix retry for clip ' + (i + 1) + '…');
          else if (onProgress && wc) onProgress('Color match unavailable — plain cut for clip ' + (i + 1));
        }
      }
      if (!stitched) throw lastErr;
      await ff.deleteFile(raw).catch(() => {});
      if (clut) await ff.deleteFile(clut).catch(() => {});
      if (vw) await ff.deleteFile(vw).catch(() => {});
      trimmed.push({
        name: out,
        dur: dur || 5,
        transition: s.transition || 'cut',
        transitionDur: s.transitionDur || 0,
      });
    }

    const outName = 'out.mp4';

    if (trimmed.length === 1) {
      const data = await ff.readFile(trimmed[0].name);
      await ff.deleteFile(trimmed[0].name).catch(() => {});
      return new Blob([data.buffer], { type: 'video/mp4' });
    }

    const needsXfade = trimmed.some((t, idx) =>
      idx < trimmed.length - 1 &&
      (t.transition === 'dissolve' || t.transition === 'fade') &&
      (t.transitionDur || 0) > 0.08
    );

    if (!needsXfade) {
      const list = trimmed.map((t) => "file '" + t.name + "'").join('\n');
      await ff.writeFile('concat.txt', new TextEncoder().encode(list));
      if (onProgress) onProgress('Stitching clips…');
      await runFF(ff, [
        '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outName,
      ]);
      await ff.deleteFile('concat.txt').catch(() => {});
    } else {
      if (onProgress) onProgress('Applying dissolves…');
      const args = [];
      trimmed.forEach((t) => args.push('-i', t.name));
      let filter = '';
      let lastV = '0:v';
      let lastA = '0:a';
      let offset = trimmed[0].dur;
      for (let i = 1; i < trimmed.length; i++) {
        const prev = trimmed[i - 1];
        const fade = (prev.transition === 'dissolve' || prev.transition === 'fade')
          ? clamp(prev.transitionDur || 0.4, 0.1, 1.2)
          : 0.08;
        const vTag = 'vx' + i;
        const aTag = 'ax' + i;
        offset -= fade;
        filter += '[' + lastV + '][' + i + ':v]xfade=transition=fade:duration=' + fade + ':offset=' + Math.max(0, offset).toFixed(3) + '[' + vTag + '];';
        filter += '[' + lastA + '][' + i + ':a]acrossfade=d=' + fade + '[' + aTag + '];';
        lastV = vTag;
        lastA = aTag;
        offset += trimmed[i].dur - fade;
      }
      args.push('-filter_complex', filter.replace(/;$/, ''));
      args.push('-map', '[' + lastV + ']', '-map', '[' + lastA + ']');
      args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outName);
      try {
        await runFF(ff, args);
      } catch (e) {
        if (onProgress) onProgress('Dissolve failed — hard-cut fallback…');
        const list = trimmed.map((t) => "file '" + t.name + "'").join('\n');
        await ff.writeFile('concat.txt', new TextEncoder().encode(list));
        await runFF(ff, [
          '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
          '-c:a', 'aac', '-movflags', '+faststart',
          outName,
        ]);
        await ff.deleteFile('concat.txt').catch(() => {});
      }
    }

    const data = await ff.readFile(outName);
    for (const t of trimmed) await ff.deleteFile(t.name).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
    return new Blob([data.buffer], { type: 'video/mp4' });
  }

  /* Still + Motion: one storyboard frame → cinematic Ken Burns clip
     (push-in / pull-out / pan, picked by seed so cuts don't all move the
     same way). Runs entirely in-browser; the still can come from local
     ComfyUI, so this is the fastest zero-cloud "video" on any hardware. */
  async function stillMotion(imageBlob, opts) {
    opts = opts || {};
    const ff = await loadFFmpeg(opts.onProgress);
    if (ff.setProgress) ff.setProgress(opts.onProgress || null);
    const fps = 24;
    const dur = Math.min(15, Math.max(2, opts.duration || 6));
    const frames = Math.round(dur * fps);
    const portrait = opts.aspect === '9:16' || opts.aspect === '2:3';
    const W = portrait ? 720 : 1280, H = portrait ? 1280 : 720;
    const t = String(imageBlob.type || '').toLowerCase();
    const inName = 'still.' + (t.indexOf('png') >= 0 ? 'png' : t.indexOf('webp') >= 0 ? 'webp' : 'jpg');
    await ff.writeFile(inName, new Uint8Array(await imageBlob.arrayBuffer()));

    const zMax = 1.12, zStep = ((zMax - 1) / frames).toFixed(6);
    const centerX = 'iw/2-(iw/zoom/2)', centerY = 'ih/2-(ih/zoom/2)';
    const variant = Math.abs(opts.seed || 0) % 4;
    let z, x, y;
    if (variant === 0) { z = 'min(zoom+' + zStep + ',' + zMax + ')'; x = centerX; y = centerY; }            // push in
    else if (variant === 1) { z = 'max(' + zMax + '-' + zStep + '*on,1.001)'; x = centerX; y = centerY; }   // pull out
    else if (variant === 2) { z = String(zMax); x = '(iw-iw/zoom)*on/' + frames; y = centerY; }             // pan right
    else { z = String(zMax); x = '(iw-iw/zoom)*(1-on/' + frames + ')'; y = centerY; }                       // pan left
    // Oversample 2x before zoompan so the move stays smooth and sharp.
    const filter = '[0:v]scale=' + (W * 2) + ':' + (H * 2) + ':force_original_aspect_ratio=increase,crop=' + (W * 2) + ':' + (H * 2) +
      ",zoompan=z='" + z + "':x='" + x + "':y='" + y + "':d=" + frames + ':s=' + W + 'x' + H + ':fps=' + fps + '[v]';
    if (opts.onProgress) opts.onProgress('Animating still (' + dur + 's)…');
    await runFF(ff, [
      '-i', inName,
      '-filter_complex', filter,
      '-map', '[v]',
      '-frames:v', String(frames),
      '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      'sm.mp4'
    ]);
    const data = await ff.readFile('sm.mp4');
    await ff.deleteFile(inName).catch(() => {});
    await ff.deleteFile('sm.mp4').catch(() => {});
    return new Blob([data.buffer], { type: 'video/mp4' });
  }

  return { loadFFmpeg, stitchBlobs, stitchTimeline, stillMotion };
})();