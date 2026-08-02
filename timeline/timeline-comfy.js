/* Module — Local ComfyUI provider (browser → your own GPU, no middleman).
   The deployed site talks straight to ComfyUI running on the visitor's
   machine: browsers exempt http://127.0.0.1 from mixed-content blocking, so
   an HTTPS page may call it as long as ComfyUI sends CORS headers — launch
   it with:  python main.py --enable-cors-header
   Uses ComfyUI's API-format workflows: we inject prompt / reference image /
   seed / size / frame count into the user's own exported graph (Settings →
   ComfyUI → Workflow…), falling back to a bundled Wan 2.1 I2V template. */
window.SBComfy = (function () {
  'use strict';

  // Bundled fallback (from local-backend/workflows/wan_i2v.api.json) — the
  // checkpoint name must exist on the user's ComfyUI; a custom uploaded
  // workflow always wins.
  var DEFAULT_WF = {
    "10": { "inputs": { "image": "example.png" }, "class_type": "LoadImage" },
    "6": { "inputs": { "text": "cinematic shot, smooth camera motion", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
    "7": { "inputs": { "text": "blurry, distorted, low quality", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
    "4": { "inputs": { "ckpt_name": "wan2.1_i2v_480p.safetensors" }, "class_type": "CheckpointLoaderSimple" },
    "3": { "inputs": { "seed": 42, "steps": 20, "cfg": 6, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] }, "class_type": "KSampler" },
    "5": { "inputs": { "width": 832, "height": 480, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
    "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
    "9": { "inputs": { "filename_prefix": "ShotbreakVideo", "images": ["8", 0] }, "class_type": "SaveImage" }
  };

  // Bundled still-image fallback (from local-backend/workflows/txt2img.api.json,
  // SDXL base) — used for storyboards/portraits when no custom image workflow
  // is uploaded.
  var DEFAULT_IMG_WF = {
    "4": { "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" }, "class_type": "CheckpointLoaderSimple" },
    "5": { "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
    "6": { "inputs": { "text": "cinematic character portrait, production reference", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
    "7": { "inputs": { "text": "blurry, low quality, watermark, text", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
    "3": { "inputs": { "seed": 42, "steps": 28, "cfg": 7, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] }, "class_type": "KSampler" },
    "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
    "9": { "inputs": { "filename_prefix": "Shotbreak", "images": ["8", 0] }, "class_type": "SaveImage" }
  };

  function withTimeout(promise, ms, msg) {
    return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error(msg || 'timeout')); }, ms); })]);
  }

  /* ── adapt to whatever models THIS ComfyUI actually has ── */

  var ckptCache = {}; // host -> {at, list}
  async function listCheckpoints(host) {
    var c = ckptCache[host];
    if (c && Date.now() - c.at < 60000) return c.list;
    var list = [];
    try {
      var r = await withTimeout(fetch(host + '/object_info/CheckpointLoaderSimple', { mode: 'cors' }), 6000, 'timeout');
      if (r.ok) {
        var j = await r.json();
        var req = j && j.CheckpointLoaderSimple && j.CheckpointLoaderSimple.input && j.CheckpointLoaderSimple.input.required;
        if (req && Array.isArray(req.ckpt_name) && Array.isArray(req.ckpt_name[0])) list = req.ckpt_name[0];
      }
    } catch (e) {}
    ckptCache[host] = { at: Date.now(), list: list };
    return list;
  }

  function isXL(name) { return /xl|sdxl/i.test(String(name || '')); }
  function isVideoCkpt(name) { return /wan|svd|i2v|t2v|video|mochi|hunyuan|ltx/i.test(String(name || '')); }

  /* AnimateDiff-Evolved support: if the install has the ADE loader node, read
     its motion-model list so the bundled video path can use it. Frames cap
     at 12 (safe context for mm_sd_v15_v2 on modest hardware). */
  async function animateDiffInfo(host) {
    try {
      var r = await withTimeout(fetch(host + '/object_info/ADE_AnimateDiffLoaderGen1', { mode: 'cors' }), 6000, 'timeout');
      if (!r.ok) return null;
      var j = await r.json();
      var req = j && j.ADE_AnimateDiffLoaderGen1 && j.ADE_AnimateDiffLoaderGen1.input && j.ADE_AnimateDiffLoaderGen1.input.required;
      if (!req) return null;
      var models = (Array.isArray(req.model_name) && Array.isArray(req.model_name[0])) ? req.model_name[0] : [];
      var betas = (Array.isArray(req.beta_schedule) && Array.isArray(req.beta_schedule[0])) ? req.beta_schedule[0] : [];
      if (!models.length) return null;
      var motion = models.filter(function (m) { return /mm_sd_v15_v2/i.test(m); })[0] || models[0];
      var beta = betas.filter(function (b) { return /AnimateDiff/i.test(b); })[0] || betas[0] || 'sqrt_linear (AnimateDiff)';
      return { motion: motion, beta: beta };
    } catch (e) { return null; }
  }

  /* SD1.5 + AnimateDiff-Evolved + VHS video graph, built from THIS install's
     model names. Frames ride the latent batch (AnimateDiff's animation axis),
     capped at 16 = the v2 motion module's context window. */
  function buildAnimateDiffWf(ckpt, ad, frames) {
    return {
      "4": { "inputs": { "ckpt_name": ckpt }, "class_type": "CheckpointLoaderSimple" },
      "40": { "inputs": { "model_name": ad.motion, "beta_schedule": ad.beta, "model": ["4", 0] }, "class_type": "ADE_AnimateDiffLoaderGen1" },
      "6": { "inputs": { "text": "cinematic shot, smooth camera motion", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
      "7": { "inputs": { "text": "blurry, distorted, low quality, watermark, text", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
      "5": { "inputs": { "width": 512, "height": 512, "batch_size": frames }, "class_type": "EmptyLatentImage" },
      "3": { "inputs": { "seed": 42, "steps": 20, "cfg": 7, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["40", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] }, "class_type": "KSampler" },
      "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
      "9": { "inputs": { "frame_rate": 8, "loop_count": 0, "filename_prefix": "CinamateVideo", "format": "video/h264-mp4", "pix_fmt": "yuv420p", "crf": 19, "save_metadata": false, "pingpong": false, "save_output": true, "images": ["8", 0] }, "class_type": "VHS_VideoCombine" }
    };
  }

  /* Best installed checkpoint for STILLS. Community photoreal fine-tunes
     (RealisticVision, DreamShaper, epicRealism…) beat the raw SD1.5 base by
     a mile at identical cost — prefer a full fine-tune, then an LCM/Turbo
     distill, then the base, then SDXL last (heavy on CPU boxes).
     opts.noFast excludes LCM/Turbo (video graphs need standard sampling). */
  function isFastCkpt(name) { return /lcm|turbo|lightning|hyper/i.test(String(name || '')); }
  function pickImageCheckpoint(list, opts) {
    var stills = (list || []).filter(function (n) { return !isVideoCkpt(n) && !/inpaint|refiner/i.test(n); });
    if (!stills.length) return null;
    var nonXL = stills.filter(function (n) { return !isXL(n); });
    var isBase = function (n) { return /v1-5.*emaonly|sd.?1[-_.]?5.*(base|pruned)/i.test(n); };
    var tuned = nonXL.filter(function (n) { return !isBase(n); });
    if (opts && opts.noFast) tuned = tuned.filter(function (n) { return !isFastCkpt(n); });
    var full = tuned.filter(function (n) { return !isFastCkpt(n); });
    if (full.length) return full[0];
    if (tuned.length) return tuned[0];
    if (nonXL.length) return nonXL[0];
    return stills[0];
  }

  /* LCM/Turbo distills need their own sampling recipe — high CFG or many
     steps produces garbage on them. Applied to bundled graphs only. */
  function applyFastSettings(wf) {
    Object.keys(wf).forEach(function (id) {
      var n = wf[id];
      if (n && /KSampler/i.test(n.class_type || '') && n.inputs) {
        n.inputs.sampler_name = 'lcm';
        n.inputs.scheduler = 'sgm_uniform';
        n.inputs.steps = 6;
        n.inputs.cfg = 1.5;
      }
    });
    return wf;
  }

  /* Installed upscale model (the user's RealESRGAN etc.) for a finishing
     pass on stills — sharp 1024/1536-class output from 512-class gens. */
  async function upscalerInfo(host) {
    try {
      var r = await withTimeout(fetch(host + '/object_info/UpscaleModelLoader', { mode: 'cors' }), 6000, 'timeout');
      if (!r.ok) return null;
      var j = await r.json();
      var req = j && j.UpscaleModelLoader && j.UpscaleModelLoader.input && j.UpscaleModelLoader.input.required;
      var models = (req && Array.isArray(req.model_name) && Array.isArray(req.model_name[0])) ? req.model_name[0] : [];
      if (!models.length) return null;
      return models.filter(function (m) { return /esrgan|ultrasharp|4x/i.test(m); })[0] || models[0];
    } catch (e) { return null; }
  }

  /* Board-chaining graph: the previous board (or an identity still) becomes
     the init image at partial denoise, so consecutive shots share palette,
     lighting, and composition VISUALLY — stock nodes only, works on SD1.5. */
  function buildImg2ImgWf(ckpt, w, h) {
    return {
      "10": { "inputs": { "image": "example.png" }, "class_type": "LoadImage" },
      "11": { "inputs": { "upscale_method": "lanczos", "width": w, "height": h, "crop": "center", "image": ["10", 0] }, "class_type": "ImageScale" },
      "4": { "inputs": { "ckpt_name": ckpt }, "class_type": "CheckpointLoaderSimple" },
      "12": { "inputs": { "pixels": ["11", 0], "vae": ["4", 2] }, "class_type": "VAEEncode" },
      "6": { "inputs": { "text": "cinematic still frame", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
      "7": { "inputs": { "text": "blurry, low quality, watermark, text", "clip": ["4", 1] }, "class_type": "CLIPTextEncode" },
      "3": { "inputs": { "seed": 42, "steps": 24, "cfg": 7, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 0.6, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["12", 0] }, "class_type": "KSampler" },
      "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
      "9": { "inputs": { "filename_prefix": "Cinamate", "images": ["8", 0] }, "class_type": "SaveImage" }
    };
  }

  function wfCheckpointNode(wf) {
    var ids = Object.keys(wf || {});
    for (var i = 0; i < ids.length; i++) {
      var n = wf[ids[i]];
      if (n && /CheckpointLoader/i.test(n.class_type || '') && n.inputs && n.inputs.ckpt_name) return ids[i];
    }
    return null;
  }

  /* Native-resolution sizes per model family. SD1.5: 512/768-class (bigger
     risks garbage output + OOM on CPU boxes); SDXL: 1024-class. */
  function imgDims(ckptName, aspect) {
    var xl = isXL(ckptName);
    if (aspect === '9:16' || aspect === '2:3') return xl ? { w: 832, h: 1216 } : { w: 512, h: 768 };
    if (aspect === '1:1') return xl ? { w: 1024, h: 1024 } : { w: 512, h: 512 };
    return xl ? { w: 1216, h: 832 } : { w: 768, h: 512 };
  }

  async function ping(host) {
    try {
      var r = await withTimeout(fetch(host + '/system_stats', { mode: 'cors' }), 4000, 'unreachable');
      return r.ok;
    } catch (e) { return false; }
  }

  /* Distinguish the two failure states so the UI can give the exact fix:
     - a no-cors probe RESOLVES (opaque) whenever the server is up, even
       without the CORS flag;
     - the normal CORS probe only succeeds when --enable-cors-header is on.
     running:false → ComfyUI isn't running (or wrong port / browser blocked
     local-network access). running:true, cors:false → missing the flag. */
  async function diagnose(host) {
    var running = false, cors = false;
    try {
      await withTimeout(fetch(host + '/system_stats', { mode: 'no-cors', cache: 'no-store' }), 4000, 'down');
      running = true;
    } catch (e) {}
    if (running) cors = await ping(host);
    return { running: running, cors: cors };
  }

  /* Inject prompt/ref/seed/size/frames into an API-format workflow, using the
     same heuristics as local-backend/workflow_builder.py. */
  function inject(wf, opts) {
    wf = JSON.parse(JSON.stringify(wf));
    var nodes = Object.keys(wf);
    var byType = function (t) { return nodes.filter(function (id) { return wf[id] && wf[id].class_type === t; }); };

    // Positive/negative CLIPTextEncode: resolved through the sampler's inputs
    // so multi-encode graphs land text in the right nodes.
    var samplers = nodes.filter(function (id) {
      return /KSampler/i.test(wf[id].class_type || '') && wf[id].inputs;
    });
    var posId = null, negId = null;
    if (samplers.length) {
      var s = wf[samplers[0]].inputs;
      if (Array.isArray(s.positive)) posId = String(s.positive[0]);
      if (Array.isArray(s.negative)) negId = String(s.negative[0]);
    }
    var encodes = byType('CLIPTextEncode');
    if (!posId && encodes.length) posId = encodes[0];
    if (!negId && encodes.length > 1) negId = encodes[1];
    if (posId && wf[posId] && wf[posId].inputs) wf[posId].inputs.text = String(opts.prompt || '');
    if (negId && wf[negId] && wf[negId].inputs && opts.negative) wf[negId].inputs.text = String(opts.negative);

    // Reference image → every LoadImage node.
    if (opts.refName) {
      byType('LoadImage').forEach(function (id) { wf[id].inputs.image = opts.refName; });
    }

    // Seed on all samplers.
    if (opts.seed != null) {
      samplers.forEach(function (id) {
        if ('seed' in wf[id].inputs) wf[id].inputs.seed = opts.seed;
        if ('noise_seed' in wf[id].inputs) wf[id].inputs.noise_seed = opts.seed;
      });
    }

    // Dimensions by aspect on latent nodes.
    if (opts.width && opts.height) {
      nodes.forEach(function (id) {
        var inp = wf[id].inputs;
        if (!inp) return;
        if (/EmptyLatent|LatentImage|EmptyMochiLatent|EmptyHunyuanLatent|WanImageToVideo/i.test(wf[id].class_type || '') || ('width' in inp && 'height' in inp && 'batch_size' in inp)) {
          if ('width' in inp && typeof inp.width === 'number') inp.width = opts.width;
          if ('height' in inp && typeof inp.height === 'number') inp.height = opts.height;
        }
      });
    }

    // Frame count for video graphs — any numeric length/frames-style input.
    if (opts.frames) {
      nodes.forEach(function (id) {
        var inp = wf[id].inputs;
        if (!inp) return;
        ['length', 'num_frames', 'frames', 'video_frames', 'frame_count'].forEach(function (k) {
          if (k in inp && typeof inp[k] === 'number' && inp[k] > 4) inp[k] = opts.frames;
        });
      });
    }
    return wf;
  }

  /* Pull a (possibly cross-origin) reference image into ComfyUI's input dir. */
  async function uploadRef(host, url, onProgress) {
    if (!url) return null;
    if (onProgress) onProgress('Sending reference to ComfyUI…');
    var blob = null;
    try { var r = await fetch(url); if (r.ok) blob = await r.blob(); } catch (e) {}
    if (!blob) {
      try {
        var p = await fetch('/.netlify/functions/proxy-media?url=' + encodeURIComponent(url));
        if (p.ok) blob = await p.blob();
      } catch (e) {}
    }
    if (!blob) return null;
    var fd = new FormData();
    var name = 'shotbreak-ref-' + Date.now() + '.png';
    fd.append('image', new File([blob], name, { type: blob.type || 'image/png' }));
    fd.append('overwrite', 'true');
    var up = await fetch(host + '/upload/image', { method: 'POST', body: fd });
    if (!up.ok) throw new Error('ComfyUI image upload failed (' + up.status + ')');
    var uj = await up.json();
    return (uj.subfolder ? uj.subfolder + '/' : '') + (uj.name || name);
  }

  function viewUrl(host, f) {
    return host + '/view?filename=' + encodeURIComponent(f.filename) +
      '&subfolder=' + encodeURIComponent(f.subfolder || '') +
      '&type=' + encodeURIComponent(f.type || 'output');
  }

  function firstOutput(hist) {
    var outputs = (hist && hist.outputs) || {};
    var image = null;
    var ids = Object.keys(outputs);
    for (var i = 0; i < ids.length; i++) {
      var o = outputs[ids[i]];
      // VHS_VideoCombine and friends emit 'gifs'; plain SaveImage emits 'images'.
      var vids = (o.gifs || o.videos || []).filter(function (f) { return /\.(mp4|webm|mov|gif)$/i.test(f.filename || ''); });
      if (vids.length) return { file: vids[0], kind: 'video' };
      if (!image && o.images && o.images.length) image = o.images[0];
    }
    return image ? { file: image, kind: 'image' } : null;
  }

  /* Full generate: inject → queue → poll history → /view URL. */
  async function generate(host, opts) {
    host = String(host || 'http://127.0.0.1:8188').replace(/\/+$/, '');
    var onProgress = opts.onProgress || function () {};

    var wf = opts.image ? DEFAULT_IMG_WF : DEFAULT_WF;
    var isCustom = false;
    if (opts.workflowJson) {
      try { wf = JSON.parse(opts.workflowJson); isCustom = true; }
      catch (e) { throw new Error('Custom ComfyUI workflow is not valid JSON'); }
    }
    wf = JSON.parse(JSON.stringify(wf));

    // Match the workload to what THIS ComfyUI install can actually run.
    var ckpts = await listCheckpoints(host);
    var ckptNodeId = wfCheckpointNode(wf);
    var wfCkpt = ckptNodeId ? wf[ckptNodeId].inputs.ckpt_name : null;
    var usedAnimateDiff = false;
    if (ckpts.length && ckptNodeId) {
      if (opts.image && !isCustom) {
        // Bundled stills template: swap in the best installed checkpoint.
        var best = pickImageCheckpoint(ckpts);
        if (best) { wf[ckptNodeId].inputs.ckpt_name = best; wfCkpt = best; }
      }
      if (ckpts.indexOf(wf[ckptNodeId].inputs.ckpt_name) < 0) {
        if (opts.image) {
          throw new Error('Your ComfyUI has no usable image checkpoint ("' + wf[ckptNodeId].inputs.ckpt_name + '" is not installed). Put a Stable Diffusion checkpoint in ComfyUI/models/checkpoints, or upload a matching workflow via Settings → Img WF…');
        }
        // Bundled video template wants Wan but it's not installed — fall back
        // to AnimateDiff when this install has the motion stack (short
        // experimental clips: ≤16 frames @ 8fps on the SD1.5 checkpoint).
        var ad = !isCustom ? await animateDiffInfo(host) : null;
        var stillCkpt = ad ? pickImageCheckpoint(ckpts, { noFast: true }) : null;
        if (ad && stillCkpt) {
          onProgress('No Wan/SVD model — using AnimateDiff (' + ad.motion + ')…');
          var adFrames = Math.min(12, Math.max(8, Math.round((opts.duration || 2) * 8)));
          wf = buildAnimateDiffWf(stillCkpt, ad, adFrames);
          ckptNodeId = '4';
          wfCkpt = stillCkpt;
          usedAnimateDiff = true;
        } else {
          throw new Error('Local video needs a video model this ComfyUI does not have ("' + wf[ckptNodeId].inputs.ckpt_name + '" is not installed, and no AnimateDiff stack was found). Use a cloud video model for clips, or upload your own workflow via Settings → Video WF… — images on this machine still work fine.');
        }
      }
    }

    var refName = null;
    if (opts.refUrl) {
      try { refName = await uploadRef(host, opts.refUrl, onProgress); }
      catch (e) { console.warn('[SBComfy] ref upload failed:', e); }
    }

    var portrait = opts.aspect === '9:16' || opts.aspect === '2:3';
    var dims;
    if (opts.image) {
      dims = imgDims(wfCkpt, opts.aspect);
    } else if (wfCkpt && !isVideoCkpt(wfCkpt) && !isXL(wfCkpt)) {
      // SD1.5-family video graph (AnimateDiff etc.) — keep native sizes.
      dims = portrait ? { w: 512, h: 768 } : { w: 512, h: 512 };
    } else {
      dims = portrait ? { w: 480, h: 832 } : { w: 832, h: 480 };
    }

    // Board chaining: an initUrl (previous board / identity still) switches
    // the bundled stills path to img2img — the shot literally grows out of
    // the prior image, carrying palette, light, and composition forward.
    if (opts.image && !isCustom && opts.initUrl) {
      var initName = null;
      try { initName = await uploadRef(host, opts.initUrl, onProgress); }
      catch (e) { console.warn('[SBComfy] init upload failed:', e); }
      if (initName) {
        wf = buildImg2ImgWf(wfCkpt || wf[ckptNodeId].inputs.ckpt_name, dims.w, dims.h);
        refName = initName;
      }
    }
    if (opts.image && !isCustom && isFastCkpt(wfCkpt)) applyFastSettings(wf);
    var injected = inject(wf, {
      prompt: opts.prompt,
      negative: opts.negative || 'blurry, distorted, low quality, watermark, text, deformed hands, extra fingers, bad anatomy',
      refName: refName,
      seed: opts.seed,
      width: dims.w,
      height: dims.h,
      frames: (opts.image || usedAnimateDiff) ? null : Math.max(9, Math.round((opts.duration || 4) * 16) + 1)
    });

    // Finishing pass on bundled stills: run the install's ESRGAN-class
    // upscaler (SD1.5 gens are 512-class — this lands sharp 1024/1536-class
    // output), then a clean lanczos downscale from the 4x result.
    if (opts.image && !isCustom && dims.w <= 768 && injected['9'] && injected['8']) {
      var up = await upscalerInfo(host);
      if (up) {
        injected['20'] = { inputs: { model_name: up }, class_type: 'UpscaleModelLoader' };
        injected['21'] = { inputs: { upscale_model: ['20', 0], image: ['8', 0] }, class_type: 'ImageUpscaleWithModel' };
        injected['22'] = { inputs: { upscale_method: 'lanczos', width: dims.w * 2, height: dims.h * 2, crop: 'disabled', image: ['21', 0] }, class_type: 'ImageScale' };
        injected['9'].inputs.images = ['22', 0];
      }
    }

    onProgress('Queued on local ComfyUI…');
    // Live step progress: ComfyUI streams sampler steps over its websocket
    // (ws:// to 127.0.0.1 is allowed from https pages in modern browsers).
    // Opened BEFORE submitting so no events are missed; everything is
    // best-effort — if the socket fails, the HTTP poll below still works.
    var cid = 'shotbreak-' + Date.now();
    var ws = null, lastWsAt = 0;
    try {
      ws = new WebSocket(host.replace(/^http/, 'ws') + '/ws?clientId=' + cid);
      ws.onmessage = function (ev) {
        if (typeof ev.data !== 'string') return;   // binary frames are live previews
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'progress' && m.data && m.data.max > 0) {
          lastWsAt = Date.now();
          var pct = Math.round((m.data.value / m.data.max) * 100);
          onProgress('rendering step ' + m.data.value + ' / ' + m.data.max, pct);
        } else if (m.type === 'status' && m.data && m.data.status && m.data.status.exec_info) {
          var qr = m.data.status.exec_info.queue_remaining;
          if (qr > 1) { lastWsAt = Date.now(); onProgress('queued — ' + (qr - 1) + ' job(s) ahead'); }
        }
      };
      ws.onerror = function () {};
    } catch (e) { ws = null; }
    var res = await fetch(host + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: injected, client_id: cid })
    });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok || !body.prompt_id) {
      var detail = body.error && (body.error.message || body.error);
      var nodeErrs = body.node_errors && Object.keys(body.node_errors).map(function (k) {
        var errs = body.node_errors[k].errors || [];
        return errs.map(function (e) { return e.message + (e.details ? ' (' + e.details + ')' : ''); }).join('; ');
      }).join(' | ');
      throw new Error('ComfyUI rejected the workflow: ' + (nodeErrs || detail || ('HTTP ' + res.status)) +
        '. Check the checkpoint/model names in your workflow match what this ComfyUI has installed.');
    }

    var id = body.prompt_id;
    var t0 = Date.now();
    try {
      while (Date.now() - t0 < 60 * 60 * 1000) {
        await new Promise(function (r) { setTimeout(r, 2000); });
        var h = await fetch(host + '/history/' + id).then(function (r) { return r.json(); }).catch(function () { return null; });
        var entry = h && h[id];
        if (entry) {
          var st = entry.status || {};
          if (st.status_str === 'error') {
            var msgs = (st.messages || []).filter(function (m) { return m[0] === 'execution_error'; })
              .map(function (m) { return (m[1] && m[1].exception_message) || ''; }).join('; ');
            throw new Error('ComfyUI execution failed: ' + (msgs || 'see the ComfyUI console'));
          }
          var out = firstOutput(entry);
          if (out) return { url: viewUrl(host, out.file), kind: out.kind };
          if (st.completed) throw new Error('ComfyUI finished but produced no image/video output');
        }
        // The websocket owns the message while step events are flowing; the
        // elapsed-time fallback only speaks when the socket has gone quiet.
        if (Date.now() - lastWsAt > 6000) {
          var secs = Math.round((Date.now() - t0) / 1000);
          onProgress('Local ComfyUI rendering… ' + secs + 's' + (secs > 90 ? ' (CPU machines can take several minutes per image — leave this tab open)' : ''));
        }
      }
      throw new Error('Local ComfyUI generation timed out (60 min)');
    } finally {
      if (ws) { try { ws.close(); } catch (e) {} }
    }
  }

  return { ping: ping, diagnose: diagnose, inject: inject, generate: generate, DEFAULT_WF: DEFAULT_WF, DEFAULT_IMG_WF: DEFAULT_IMG_WF };
})();
