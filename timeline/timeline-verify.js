/* Module — Continuity verification loop (the closed-loop piece).
   Open-source, commercial-safe, runs entirely in the browser:
   - @vladmandic/human (MIT): face detection + embedding → "is this the same
     person as the canon portrait?" score per expected character.
   - SigLIP via @huggingface/transformers (Apache-2.0, ONNX Runtime Web MIT):
     image embeddings → location / wardrobe / prop similarity vs the locked
     reference plates and cards.
   - Frame diff: flags mid-clip visual resets (model "forgot" the scene).

   Models load lazily from CDN on first use (browser-cached afterwards) and
   every failure degrades gracefully — scoring simply reports 'unavailable'
   rather than breaking generation. To self-host instead, mirror the model
   files under /static/models/ (same CORP headers as /static/ffmpeg/) and
   point HUMAN_MODELS / env.remoteHost at them. */
window.SBVerify = (function () {
  'use strict';

  // CDN endpoints (all send Access-Control-Allow-Origin:* — loadable under
  // the page's COEP:credentialless policy).
  var HUMAN_ESM = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3/dist/human.esm.js';
  var HUMAN_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/human-models@3/models/';
  var TRANSFORMERS_ESM = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
  var SIGLIP_MODEL = 'Xenova/siglip-base-patch16-224';
  var CLIP_FALLBACK = 'Xenova/clip-vit-base-patch32';

  // Tunable thresholds (documented ranges: human same-person cosine ≥ ~0.5,
  // SigLIP same-scene ≥ ~0.6). Exposed for tuning on real outputs.
  var thresholds = {
    faceSame: 0.5,
    faceWarn: 0.42,
    scene: 0.6,
    sceneWarn: 0.5,
    drift: 0.35
  };

  var humanInst = null, humanLoading = null;
  var extractor = null, extractorLoading = null;
  var embedCache = {};   // url -> {face: Float32Array|null, scene: Float32Array|null}
  var unavailable = { face: false, scene: false };

  function proxied(url) {
    return '/.netlify/functions/proxy-media?url=' + encodeURIComponent(url);
  }

  /* ── model loading (lazy, cached, graceful) ── */

  async function getHuman() {
    if (humanInst) return humanInst;
    if (unavailable.face) return null;
    if (!humanLoading) {
      humanLoading = (async function () {
        var mod = await import(/* webpackIgnore: true */ HUMAN_ESM);
        var Human = mod.Human || mod.default;
        var h = new Human({
          modelBasePath: HUMAN_MODELS,
          backend: 'webgl',
          face: {
            enabled: true,
            detector: { rotation: false, maxDetected: 6 },
            mesh: { enabled: false },
            iris: { enabled: false },
            description: { enabled: true },  // faceres embedding
            emotion: { enabled: false }
          },
          body: { enabled: false }, hand: { enabled: false },
          object: { enabled: false }, gesture: { enabled: false },
          filter: { enabled: false }
        });
        await h.load();
        await h.warmup();
        return h;
      })().catch(function (e) {
        console.warn('[SBVerify] face model unavailable:', e);
        unavailable.face = true;
        return null;
      });
    }
    humanInst = await humanLoading;
    return humanInst;
  }

  async function getExtractor() {
    if (extractor) return extractor;
    if (unavailable.scene) return null;
    if (!extractorLoading) {
      extractorLoading = (async function () {
        var tf = await import(/* webpackIgnore: true */ TRANSFORMERS_ESM);
        var make = function (model) {
          return tf.pipeline('image-feature-extraction', model, { dtype: 'q8' });
        };
        try {
          return await make(SIGLIP_MODEL);
        } catch (e) {
          console.warn('[SBVerify] SigLIP failed, falling back to CLIP:', e);
          return make(CLIP_FALLBACK);
        }
      })().catch(function (e) {
        console.warn('[SBVerify] scene model unavailable:', e);
        unavailable.scene = true;
        return null;
      });
    }
    extractor = await extractorLoading;
    return extractor;
  }

  /* ── frame sampling (canvas grab + proxy fallback, like end-frame chaining) ── */

  function grabFrames(src, times) {
    return new Promise(function (resolve) {
      var v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      if (src.indexOf('https://') === 0) v.crossOrigin = 'anonymous';
      var frames = [], idx = 0, settled = false;
      var finish = function () { if (!settled) { settled = true; resolve(frames); } };
      var seekNext = function () {
        if (idx >= times.length) { finish(); return; }
        var t = Math.max(0, Math.min((v.duration || 4) - 0.05, times[idx] * (v.duration || 4)));
        v.currentTime = Number.isFinite(t) ? t : 0;
      };
      v.addEventListener('loadedmetadata', seekNext);
      v.addEventListener('seeked', function () {
        try {
          var w = v.videoWidth, h = v.videoHeight;
          if (w && h) {
            var c = document.createElement('canvas');
            var scale = Math.min(1, 512 / w);
            c.width = Math.round(w * scale); c.height = Math.round(h * scale);
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            frames.push(c);
          }
        } catch (e) { finish(); return; }
        idx++;
        seekNext();
      });
      v.addEventListener('error', finish);
      setTimeout(finish, 20000);
      v.src = src;
    });
  }

  async function sampleFrames(videoUrl, n) {
    n = n || 5;
    var times = [];
    for (var i = 0; i < n; i++) times.push(n === 1 ? 0.5 : i / (n - 1) * 0.96);
    var frames = await grabFrames(String(videoUrl || ''), times);
    if (!frames.length && String(videoUrl || '').indexOf('https://') === 0) {
      frames = await grabFrames(proxied(videoUrl), times);
    }
    return frames;
  }

  /* ── embeddings + similarity ── */

  function cosine(a, b) {
    if (!a || !b || !a.length || a.length !== b.length) return 0;
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  async function imageToCanvas(url) {
    var tryLoad = function (src, cors) {
      return new Promise(function (resolve) {
        var img = new Image();
        if (cors) img.crossOrigin = 'anonymous';
        img.onload = function () {
          var c = document.createElement('canvas');
          var scale = Math.min(1, 512 / img.naturalWidth);
          c.width = Math.round(img.naturalWidth * scale);
          c.height = Math.round(img.naturalHeight * scale);
          try { c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c); }
          catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = src;
      });
    };
    var c = await tryLoad(url, url.indexOf('https://') === 0);
    if (!c && url.indexOf('https://') === 0) c = await tryLoad(proxied(url), false);
    return c;
  }

  async function faceEmbedding(canvas) {
    var h = await getHuman();
    if (!h || !canvas) return null;
    try {
      var res = await h.detect(canvas);
      var best = null;
      (res.face || []).forEach(function (f) {
        if (f.embedding && f.embedding.length && (!best || (f.boxScore || f.score || 0) > best.score)) {
          best = { emb: f.embedding, score: f.boxScore || f.score || 0 };
        }
      });
      return best ? best.emb : null;
    } catch (e) { return null; }
  }

  async function allFaceEmbeddings(canvas) {
    var h = await getHuman();
    if (!h || !canvas) return [];
    try {
      var res = await h.detect(canvas);
      return (res.face || []).map(function (f) { return f.embedding; }).filter(function (e) { return e && e.length; });
    } catch (e) { return []; }
  }

  async function sceneEmbedding(canvas) {
    var ex = await getExtractor();
    if (!ex || !canvas) return null;
    try {
      var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/jpeg', 0.85); });
      if (!blob) return null;
      var url = URL.createObjectURL(blob);
      try {
        var out = await ex(url, { pooling: 'mean', normalize: true });
        return Array.from(out.data || out[0] && out[0].data || []);
      } finally { URL.revokeObjectURL(url); }
    } catch (e) { return null; }
  }

  async function refEmbeddings(url, kinds) {
    if (!url) return null;
    var cached = embedCache[url];
    if (!cached) {
      cached = embedCache[url] = {};
      var canvas = await imageToCanvas(url);
      if (canvas) {
        if (!kinds || kinds.indexOf('face') >= 0) cached.face = await faceEmbedding(canvas);
        if (!kinds || kinds.indexOf('scene') >= 0) cached.scene = await sceneEmbedding(canvas);
      }
    }
    return cached;
  }

  /* mean-abs luma diff between consecutive downscaled frames — a spike means
     the model visually "reset" mid-clip. */
  function driftScore(frames) {
    if (frames.length < 2) return 0;
    var lumas = frames.map(function (c) {
      var s = document.createElement('canvas');
      s.width = 64; s.height = 36;
      s.getContext('2d').drawImage(c, 0, 0, 64, 36);
      var d = s.getContext('2d').getImageData(0, 0, 64, 36).data;
      var out = new Float32Array(64 * 36);
      for (var i = 0; i < out.length; i++) {
        out[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
      }
      return out;
    });
    var maxDiff = 0;
    for (var i = 1; i < lumas.length; i++) {
      var sum = 0;
      for (var j = 0; j < lumas[i].length; j++) sum += Math.abs(lumas[i][j] - lumas[i - 1][j]);
      maxDiff = Math.max(maxDiff, sum / lumas[i].length);
    }
    return maxDiff;
  }

  /* ── the scoring pass ── */

  function expectedCharacterRefs(state, clip) {
    var out = [];
    var chars = state.characters || {};
    (clip.characters || []).forEach(function (n) {
      var c = chars[n];
      if (!c || c.role === 'crowd' || c.role === 'voice_only') return;
      var url = null;
      if (c.kit && window.SBRefKit) url = window.SBRefKit.pickCharKitImage(c, 'CLOSE');
      if (!url && typeof c.refUrl === 'string' && c.refUrl.indexOf('https://') === 0) url = c.refUrl;
      if (url) out.push({ name: n, url: url });
    });
    return out;
  }

  function locationRef(state, clip) {
    if (!window.SBMastery) return null;
    var m = window.SBMastery.resolveForTimeline(state, clip, { maxRefs: 1 });
    return m.location_image_url || null;
  }

  /* Score a generated clip against canon. Returns and stores clip.continuity =
     { faces:{NAME:score}, location, drift, verifiedAt, available } */
  async function scoreClip(state, clip) {
    if (!clip || !clip.videoUrl) return null;
    var frames = await sampleFrames(clip.videoUrl, 5);
    if (!frames.length) {
      clip.continuity = { available: false, reason: 'no_frames', verifiedAt: Date.now() };
      return clip.continuity;
    }

    var result = { faces: {}, location: null, drift: 0, available: true, verifiedAt: Date.now() };
    result.drift = driftScore(frames);

    // Face identity per expected character: best cosine across all frames/faces.
    var refs = expectedCharacterRefs(state, clip);
    if (refs.length && !unavailable.face) {
      var frameFaces = [];
      for (var i = 0; i < frames.length; i++) {
        frameFaces.push.apply(frameFaces, await allFaceEmbeddings(frames[i]));
      }
      for (var r = 0; r < refs.length; r++) {
        var ref = await refEmbeddings(refs[r].url, ['face']);
        if (!ref || !ref.face) { result.faces[refs[r].name] = null; continue; }
        var best = 0;
        frameFaces.forEach(function (emb) { best = Math.max(best, cosine(ref.face, emb)); });
        result.faces[refs[r].name] = frameFaces.length ? Math.round(best * 100) / 100 : null;
      }
    }

    // Location similarity: best frame-vs-plate cosine.
    var locUrl = locationRef(state, clip);
    if (locUrl && !unavailable.scene) {
      var locRef = await refEmbeddings(locUrl, ['scene']);
      if (locRef && locRef.scene && locRef.scene.length) {
        var bestLoc = 0;
        for (var f = 0; f < frames.length; f++) {
          var emb = await sceneEmbedding(frames[f]);
          if (emb && emb.length) bestLoc = Math.max(bestLoc, cosine(locRef.scene, emb));
        }
        result.location = Math.round(bestLoc * 100) / 100;
      }
    }

    result.available = !(unavailable.face && unavailable.scene);
    clip.continuity = result;
    return result;
  }

  /* Traffic-light verdict for a clip's stored continuity scores. */
  function verdict(clip) {
    var c = clip && clip.continuity;
    if (!c || !c.available) return null;
    var worst = 'good';
    Object.keys(c.faces || {}).forEach(function (n) {
      var s = c.faces[n];
      if (s == null) return;
      if (s < thresholds.faceWarn) worst = 'bad';
      else if (s < thresholds.faceSame && worst !== 'bad') worst = 'warn';
    });
    if (c.location != null) {
      if (c.location < thresholds.sceneWarn) worst = 'bad';
      else if (c.location < thresholds.scene && worst !== 'bad') worst = 'warn';
    }
    if (c.drift > thresholds.drift && worst !== 'bad') worst = 'warn';
    return worst;
  }

  function summaryText(clip) {
    var c = clip && clip.continuity;
    if (!c) return '';
    if (!c.available) return 'Continuity check unavailable';
    var bits = [];
    Object.keys(c.faces || {}).forEach(function (n) {
      bits.push(n + ' ' + (c.faces[n] == null ? '?' : Math.round(c.faces[n] * 100) + '%'));
    });
    if (c.location != null) bits.push('location ' + Math.round(c.location * 100) + '%');
    if (c.drift > thresholds.drift) bits.push('⚠ mid-clip reset');
    return bits.join(' · ');
  }

  return {
    thresholds: thresholds,
    sampleFrames: sampleFrames,
    cosine: cosine,
    driftScore: driftScore,
    scoreClip: scoreClip,
    verdict: verdict,
    summaryText: summaryText
  };
})();
