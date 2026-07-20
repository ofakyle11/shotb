/* Module — Local ComfyUI provider (browser → your own GPU, no middleman).
   The deployed site talks straight to ComfyUI running on the visitor's
   machine: browsers exempt http://127.0.0.1 from mixed-content blocking, so
   an HTTPS page may call it as long as ComfyUI sends CORS headers — launch
   it with:  python main.py --enable-cors-header '*'
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

  function withTimeout(promise, ms, msg) {
    return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error(msg || 'timeout')); }, ms); })]);
  }

  async function ping(host) {
    try {
      var r = await withTimeout(fetch(host + '/system_stats', { mode: 'cors' }), 4000, 'unreachable');
      return r.ok;
    } catch (e) { return false; }
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

    var wf = DEFAULT_WF;
    if (opts.workflowJson) {
      try { wf = JSON.parse(opts.workflowJson); }
      catch (e) { throw new Error('Custom ComfyUI workflow is not valid JSON'); }
    }

    var refName = null;
    if (opts.refUrl) {
      try { refName = await uploadRef(host, opts.refUrl, onProgress); }
      catch (e) { console.warn('[SBComfy] ref upload failed:', e); }
    }

    var portrait = opts.aspect === '9:16';
    var injected = inject(wf, {
      prompt: opts.prompt,
      negative: opts.negative || 'blurry, distorted, low quality, watermark, text',
      refName: refName,
      seed: opts.seed,
      width: portrait ? 480 : 832,
      height: portrait ? 832 : 480,
      frames: Math.max(9, Math.round((opts.duration || 4) * 16) + 1)
    });

    onProgress('Queued on local ComfyUI…');
    var res = await fetch(host + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: injected, client_id: 'shotbreak-' + Date.now() })
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
    while (Date.now() - t0 < 30 * 60 * 1000) {
      await new Promise(function (r) { setTimeout(r, 2500); });
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
      onProgress('Local GPU rendering… ' + Math.round((Date.now() - t0) / 1000) + 's');
    }
    throw new Error('Local ComfyUI generation timed out (30 min)');
  }

  return { ping: ping, inject: inject, generate: generate, DEFAULT_WF: DEFAULT_WF };
})();
