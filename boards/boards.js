/* CINAMATE Boards — UI: scene rail, shot cards with frames, printable
 * boards, animatic export (WebCodecs → our MP4 writer, real-time WebM
 * fallback), and the key-art poster compositor.
 * Engine: lib-shots.js (CShots) · MP4: /editor/lib-mp4.js (CMux)
 * Storage: SB_Boards_v1 + SB_KeyArt_v1. All original code.
 */
(function () {
  'use strict';
  var S = window.CShots, M = window.CMux;
  var KEY = 'SB_Boards_v1', KA_KEY = 'SB_KeyArt_v1';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  var toastTimer;
  function toast(m) { var el = $('bdToast'); el.textContent = m; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('on'); }, 3000); }
  function readLS(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function dl(name, data, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  var project = readLS(KEY) || S.blank();
  var curScene = project.scenes.length ? project.scenes[0].id : null;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(project)); } catch (e) { toast('Storage full — export a project backup and clear old frames'); } }
  function sceneById(id) { return project.scenes.find(function (s) { return s.id === id; }); }

  /* ── scene rail ─────────────────────────────────────────────────── */
  function renderScenes() {
    $('bdSceneList').innerHTML = project.scenes.map(function (s) {
      return '<div class="bd-scene' + (s.id === curScene ? ' on' : '') + '" data-sc="' + s.id + '">' +
        '<b>' + esc(s.slug) + '</b><span>' + (s.shots || []).length + ' shots · ' +
        (s.shots || []).filter(function (x) { return x.img; }).length + ' framed</span></div>';
    }).join('') || '<p class="bd-dim">Seed from the script, or add scenes by hand.</p>';
    $('bdStats').innerHTML = project.scenes.length ?
      project.scenes.length + ' scenes · ' + S.shotCount(project) + ' shots<br>≈ ' +
      Math.round(S.totalDur(project)) + 's animatic' : '';
  }

  /* ── shot cards ─────────────────────────────────────────────────── */
  function shotCard(sh, i) {
    function opts(list, cur) { return list.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + o + '</option>'; }).join(''); }
    return '<div class="bd-shot" data-shot="' + sh.id + '">' +
      '<div class="bd-frame">' +
      (sh.img ? '<img src="' + sh.img + '" alt="">' : '<div class="bd-ph">No frame yet — grab one from a rendered clip, upload, or generate</div>') +
      '<div class="bd-framebtns">' +
      '<button data-act="grab" title="Frame from a rendered Studio clip">📷 Clip</button>' +
      '<button data-act="upload" title="Upload an image">⬆</button>' +
      '<button data-act="gen" title="Generate on your machine via the Cinamate bridge">✨ AI</button>' +
      (sh.img ? '<button data-act="clear" title="Remove frame">✕</button>' : '') +
      '</div></div>' +
      '<div class="bd-shotbody">' +
      '<div class="bd-shotrow">' +
      '<select data-f="size">' + opts(S.SIZES, sh.size) + '</select>' +
      '<select data-f="angle">' + opts(S.ANGLES, sh.angle) + '</select>' +
      '<select data-f="move">' + opts(S.MOVES, sh.move) + '</select>' +
      '</div>' +
      '<div class="bd-shotrow">' +
      '<span class="bd-dim">lens</span><input class="bd-lens" data-f="lensMm" type="number" value="' + (sh.lensMm || 35) + '">mm' +
      '<span class="bd-dim">·</span><input class="bd-dur" data-f="dur" type="number" step="0.5" min="0.5" value="' + (sh.dur || 2) + '">s' +
      '</div>' +
      '<textarea class="bd-desc" data-f="desc" placeholder="What happens in this shot">' + esc(sh.desc) + '</textarea>' +
      '</div>' +
      '<div class="bd-shotfoot"><span class="bd-n">shot ' + (i + 1) + '</span>' +
      '<button data-act="left" title="Move earlier">◀</button>' +
      '<button data-act="right" title="Move later">▶</button>' +
      '<button data-act="del" title="Delete shot">🗑</button></div>' +
      '</div>';
  }

  function renderShots() {
    var sc = sceneById(curScene);
    $('bdSceneTitle').textContent = sc ? sc.slug : 'Pick a scene';
    $('bdShots').innerHTML = sc ? ((sc.shots || []).map(shotCard).join('') ||
      '<p class="bd-dim" style="padding:10px">No shots yet — + Shot, or ✨ Suggest coverage.</p>') : '';
  }
  function renderAll() { renderScenes(); renderShots(); }

  /* ── frame sources ──────────────────────────────────────────────── */
  var grabTarget = null, grabVideo = null;
  function openGrab(shotId) {
    var tl = readLS('SB_Timeline_v1');
    var clips = ((tl && tl.clips) || []).filter(function (c) { return c.videoUrl; });
    if (!clips.length) return toast('No rendered clips in the Studio yet');
    grabTarget = shotId;
    $('bdGrabClip').innerHTML = clips.map(function (c, i) {
      return '<option value="' + esc(c.videoUrl) + '">SC' + String(c.num || i + 1).padStart(2, '0') + ' — ' + esc(c.label || 'clip') + '</option>';
    }).join('');
    $('bdGrabModal').classList.remove('hidden');
    loadGrabVideo();
  }
  function loadGrabVideo() {
    grabVideo = $('bdGrabVideo');
    grabVideo.src = $('bdGrabClip').value;
    grabVideo.onloadedmetadata = function () {
      $('bdGrabTime').max = Math.max(1, Math.floor((grabVideo.duration || 4) * 10));
      grabVideo.currentTime = 0.1;
    };
  }
  function setShotImg(shotId, dataUrl) {
    project.scenes.forEach(function (s) {
      (s.shots || []).forEach(function (sh) { if (sh.id === shotId) sh.img = dataUrl; });
    });
    save(); renderAll();
  }
  function grabFrame() {
    if (!grabVideo || grabVideo.readyState < 2) return toast('Clip still loading…');
    var c = document.createElement('canvas'); c.width = 480; c.height = 270;
    try {
      c.getContext('2d').drawImage(grabVideo, 0, 0, 480, 270);
      var url = c.toDataURL('image/jpeg', 0.65);
      if (grabTarget === '__keyart__') { keyart.bg = url; saveKa(); drawPoster(); }
      else setShotImg(grabTarget, url);
      $('bdGrabModal').classList.add('hidden');
      toast('Frame captured');
    } catch (e) {
      toast('This clip blocks frame capture (cross-origin) — use a bridge-rendered or uploaded file');
    }
  }

  var uploadTarget = null;
  var upInput = document.createElement('input');
  upInput.type = 'file'; upInput.accept = 'image/*';
  upInput.addEventListener('change', function () {
    var f = this.files[0]; if (!f || !uploadTarget) return;
    var rd = new FileReader();
    rd.onload = function () {
      // downscale to board size
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = 480; c.height = 270;
        var g = c.getContext('2d');
        var s2 = Math.max(480 / img.width, 270 / img.height);
        g.drawImage(img, (480 - img.width * s2) / 2, (270 - img.height * s2) / 2, img.width * s2, img.height * s2);
        setShotImg(uploadTarget, c.toDataURL('image/jpeg', 0.65));
        toast('Frame added');
      };
      img.src = String(rd.result);
    };
    rd.readAsDataURL(f);
    this.value = '';
  });

  async function genFrame(shotId) {
    var cfg = readLS('SB_LocalGPU_v1') || {};
    if (!(cfg.url || '').trim()) return toast('Set the Cinamate bridge URL in Studio → Settings → Local GPU first');
    var sh = null, sc = sceneById(curScene);
    (sc.shots || []).forEach(function (x) { if (x.id === shotId) sh = x; });
    if (!sh) return;
    var prompt = (sc.slug + '. ' + sh.size + ' shot, ' + sh.angle.toLowerCase() + ', ' + (sh.desc || sc.desc || 'cinematic still')).slice(0, 400);
    toast('Asking your machine for a frame…');
    try {
      var headers = { 'Content-Type': 'application/json' };
      if (cfg.key) headers['X-API-Key'] = cfg.key;
      var r = await fetch(cfg.url.replace(/\/+$/, '') + '/generate-image', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ prompt: prompt, width: 960, height: 540 })
      });
      if (!r.ok) throw new Error('bridge answered ' + r.status);
      var j = await r.json().catch(function () { return null; });
      var url = j && (j.image_url || j.url || (j.images && j.images[0]) || j.image);
      if (!url) throw new Error('no image in the reply');
      if (url.indexOf('data:') !== 0) {
        var blob = await (await fetch(url)).blob();
        url = await new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(rd.result); }; rd.readAsDataURL(blob); });
      }
      setShotImg(shotId, url);
      toast('Frame generated on your machine');
    } catch (e) {
      toast('Bridge image endpoint not available yet (' + e.message + ') — use 📷 Clip or ⬆ upload');
    }
  }

  /* ── animatic export ────────────────────────────────────────────── */
  function slate(g, W, H, frame) {
    g.fillStyle = '#0A1628'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#8BA3B8'; g.textAlign = 'center';
    g.font = '700 ' + Math.round(H / 16) + 'px Cinzel, serif';
    g.fillText(frame.label, W / 2, H / 2 - 10);
    g.fillStyle = '#A0B4C8'; g.font = Math.round(H / 30) + 'px Inter, sans-serif';
    g.fillText((frame.desc || '').slice(0, 80), W / 2, H / 2 + Math.round(H / 14));
  }
  function loadImg(src) {
    return new Promise(function (res) {
      if (!src) return res(null);
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }
  async function exportAnimatic() {
    var frames = S.animaticPlan(project, true);
    if (!frames.length) return toast('No shots to animate yet');
    var W = 1280, H = 720, fps = 12;
    var off = document.createElement('canvas'); off.width = W; off.height = H;
    var g = off.getContext('2d');
    var name = 'animatic-' + (readLS('SB_Timeline_v1') || {}).projectName;
    name = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animatic';

    async function drawSeq(cb) {
      for (var i = 0; i < frames.length; i++) {
        var fr = frames[i];
        var im = await loadImg(fr.img);
        var n = Math.max(1, Math.round(fr.dur * fps));
        for (var k = 0; k < n; k++) {
          if (im) {
            g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
            var s2 = Math.min(W / im.width, H / im.height);
            g.drawImage(im, (W - im.width * s2) / 2, (H - im.height * s2) / 2, im.width * s2, im.height * s2);
            g.fillStyle = 'rgba(232,238,242,.85)'; g.font = '16px "IBM Plex Mono", monospace'; g.textAlign = 'left';
            g.fillText(fr.label, 16, H - 16);
          } else slate(g, W, H, fr);
          await cb(i, k);
        }
      }
    }

    if (window.VideoEncoder) {
      var cfg = { codec: 'avc1.42001f', width: W, height: H, bitrate: 2500000, framerate: fps, avc: { format: 'avc' } };
      var sup = null;
      try { sup = await VideoEncoder.isConfigSupported(cfg); } catch (e) {}
      if (sup && sup.supported) {
        var chunks = [], sizes = [], syncs = [], desc = null, fi = 0;
        var enc = new VideoEncoder({
          output: function (chunk, meta) {
            if (meta && meta.decoderConfig && meta.decoderConfig.description && !desc) desc = new Uint8Array(meta.decoderConfig.description);
            var u = new Uint8Array(chunk.byteLength); chunk.copyTo(u);
            chunks.push(u); sizes.push(u.length); syncs.push(chunk.type === 'key');
          },
          error: function (e) { console.warn('[Cinamate] animatic encode', e); }
        });
        enc.configure(cfg);
        await drawSeq(async function () {
          var f = new VideoFrame(off, { timestamp: Math.round(fi * 1e6 / fps), duration: Math.round(1e6 / fps) });
          enc.encode(f, { keyFrame: fi % (fps * 2) === 0 });
          f.close(); fi++;
          while (enc.encodeQueueSize > 4) await new Promise(function (r) { setTimeout(r, 8); });
        });
        await enc.flush(); enc.close();
        var total = sizes.reduce(function (a, b) { return a + b; }, 0);
        var data = new Uint8Array(total), o = 0;
        chunks.forEach(function (c) { data.set(c, o); o += c.length; });
        var mp4 = M.buildMp4([{
          type: 'video', timescale: 90000,
          durations: sizes.map(function () { return Math.round(90000 / fps); }),
          sizes: sizes, data: data, sync: syncs,
          description: desc || new Uint8Array([1, 66, 0, 31, 255, 225]), width: W, height: H
        }]);
        dl(name + '.mp4', new Blob([mp4], { type: 'video/mp4' }), 'video/mp4');
        return toast('Animatic exported — ' + frames.length + ' boards, ' + Math.round(S.totalDur(project)) + 's');
      }
    }
    // realtime WebM fallback
    if (!window.MediaRecorder || !off.captureStream) return toast('This browser cannot export video');
    var stream = off.captureStream(fps);
    var rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    var parts = [];
    rec.ondataavailable = function (e) { if (e.data.size) parts.push(e.data); };
    rec.onstop = function () { dl(name + '.webm', new Blob(parts, { type: 'video/webm' }), 'video/webm'); toast('Animatic exported (.webm)'); };
    rec.start(200);
    toast('Rendering animatic in real time…');
    await drawSeq(function () { return new Promise(function (r) { setTimeout(r, 1000 / fps); }); });
    rec.stop();
  }

  /* ── key art ────────────────────────────────────────────────────── */
  var keyart = readLS(KA_KEY) || { title: '', tag: '', credits: '', layout: 'bottom', bg: '' };
  function saveKa() { try { localStorage.setItem(KA_KEY, JSON.stringify(keyart)); } catch (e) { toast('Storage full'); } }

  async function drawPoster(scale) {
    var cv = $('kaCanvas');
    var W = cv.width * (scale || 1), H = cv.height * (scale || 1);
    var c = scale ? document.createElement('canvas') : cv;
    if (scale) { c.width = W; c.height = H; }
    var g = c.getContext('2d');
    g.fillStyle = '#0A1628'; g.fillRect(0, 0, W, H);
    var im = await loadImg(keyart.bg);
    if (im) {
      var s2 = Math.max(W / im.width, H / im.height);
      g.drawImage(im, (W - im.width * s2) / 2, (H - im.height * s2) / 2, im.width * s2, im.height * s2);
    }
    var grad = g.createLinearGradient(0, keyart.layout === 'top' ? H * 0.45 : 0, 0, keyart.layout === 'top' ? 0 : H);
    grad.addColorStop(0, 'rgba(10,22,40,0)');
    grad.addColorStop(1, 'rgba(10,22,40,.94)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    var ty = keyart.layout === 'top' ? H * 0.16 : H * 0.78;
    g.fillStyle = '#E8EEF2';
    g.font = '700 ' + Math.round(W / 10) + 'px Cinzel, serif';
    var title = (keyart.title || 'UNTITLED').toUpperCase();
    g.fillText(title, W / 2, ty, W * 0.92);
    if (keyart.tag) {
      g.fillStyle = '#8BA3B8';
      g.font = Math.round(W / 30) + 'px Inter, sans-serif';
      g.fillText(keyart.tag, W / 2, ty + W / 12, W * 0.9);
    }
    if (keyart.credits) {
      g.fillStyle = 'rgba(160,180,200,.85)';
      g.font = Math.round(W / 60) + 'px Inter, sans-serif';
      var lines = keyart.credits.split('\n');
      lines.forEach(function (ln, i) {
        g.fillText(ln.toUpperCase(), W / 2, H * 0.93 + i * (W / 48), W * 0.94);
      });
    }
    return c;
  }

  /* ── wiring ─────────────────────────────────────────────────────── */
  function wire() {
    document.querySelectorAll('.ps-tab[data-bt]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.ps-tab[data-bt]').forEach(function (x) { x.classList.toggle('on', x === b); });
        $('bdTabBoards').classList.toggle('hidden', b.getAttribute('data-bt') !== 'boards');
        $('bdTabKeyart').classList.toggle('hidden', b.getAttribute('data-bt') !== 'keyart');
        if (b.getAttribute('data-bt') === 'keyart') drawPoster();
      });
    });

    $('bdSeed').addEventListener('click', function () {
      var scenes = S.seedScenes(readLS('SB_Timeline_v1'), readLS('SB_Writer_v1'), function () { return uid(); });
      if (!scenes.length) return toast('No script yet — parse one in the Studio or build beats in the Writer');
      var by
       = {};
      project.scenes.forEach(function (s) { by[s.slug] = s; });
      scenes.forEach(function (s) { if (by[s.slug]) s.shots = by[s.slug].shots; });
      project.scenes = scenes;
      curScene = scenes[0].id;
      save(); renderAll();
      toast(scenes.length + ' scenes seeded — existing boards kept where slugs match');
    });
    $('bdAddScene').addEventListener('click', function () {
      var s = { id: uid(), slug: 'SCENE ' + (project.scenes.length + 1), desc: '', shots: [] };
      project.scenes.push(s); curScene = s.id; save(); renderAll();
    });
    $('bdSceneList').addEventListener('click', function (e) {
      var el = e.target.closest('.bd-scene');
      if (el) { curScene = el.getAttribute('data-sc'); renderAll(); }
    });
    $('bdAddShot').addEventListener('click', function () {
      var sc = sceneById(curScene); if (!sc) return toast('Pick a scene first');
      sc.shots.push(S.blankShot(uid())); save(); renderAll();
    });
    $('bdCoverage').addEventListener('click', function () {
      var sc = sceneById(curScene); if (!sc) return toast('Pick a scene first');
      var tl = readLS('SB_Timeline_v1');
      var chars = [];
      var cs = (tl && tl.characters) || [];
      (Array.isArray(cs) ? cs : Object.keys(cs)).slice(0, 4).forEach(function (c) {
        chars.push(typeof c === 'string' ? c : (c.name || ''));
      });
      sc.shots = sc.shots.concat(S.suggestCoverage(sc, chars.filter(Boolean), function () { return uid(); }));
      save(); renderAll();
      toast('Coverage added — master, singles, insert');
    });
    $('bdCsv').addEventListener('click', function () {
      if (!S.shotCount(project)) return toast('No shots yet');
      dl('shot-list.csv', S.toCsv(project), 'text/csv');
    });
    $('bdPrint').addEventListener('click', function () { window.print(); });
    $('bdAnimatic').addEventListener('click', exportAnimatic);

    $('bdShots').addEventListener('change', function (e) {
      var card = e.target.closest('.bd-shot'); if (!card) return;
      var sc = sceneById(curScene);
      var sh = (sc.shots || []).find(function (x) { return x.id === card.getAttribute('data-shot'); });
      var f = e.target.getAttribute('data-f');
      if (!sh || !f) return;
      sh[f] = (f === 'lensMm' || f === 'dur') ? parseFloat(e.target.value) || (f === 'dur' ? 2 : 35) : e.target.value;
      save(); renderScenes();
    });
    $('bdShots').addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act'); if (!act) return;
      var card = e.target.closest('.bd-shot');
      var shotId = card.getAttribute('data-shot');
      var sc = sceneById(curScene);
      var i = sc.shots.findIndex(function (x) { return x.id === shotId; });
      if (act === 'grab') openGrab(shotId);
      if (act === 'upload') { uploadTarget = shotId; upInput.click(); }
      if (act === 'gen') genFrame(shotId);
      if (act === 'clear') setShotImg(shotId, '');
      if (act === 'del') { sc.shots.splice(i, 1); save(); renderAll(); }
      if (act === 'left' && i > 0) { var a = sc.shots.splice(i, 1)[0]; sc.shots.splice(i - 1, 0, a); save(); renderAll(); }
      if (act === 'right' && i < sc.shots.length - 1) { var b = sc.shots.splice(i, 1)[0]; sc.shots.splice(i + 1, 0, b); save(); renderAll(); }
    });

    $('bdGrabClip').addEventListener('change', loadGrabVideo);
    $('bdGrabTime').addEventListener('input', function () {
      if (grabVideo) grabVideo.currentTime = this.value / 10;
    });
    $('bdGrabCancel').addEventListener('click', function () { $('bdGrabModal').classList.add('hidden'); });
    $('bdGrabUse').addEventListener('click', grabFrame);

    /* key art */
    $('kaTitle').value = keyart.title; $('kaTag').value = keyart.tag;
    $('kaCredits').value = keyart.credits; $('kaLayout').value = keyart.layout;
    [['kaTitle', 'title'], ['kaTag', 'tag'], ['kaCredits', 'credits'], ['kaLayout', 'layout']].forEach(function (p) {
      $(p[0]).addEventListener('input', function () { keyart[p[1]] = this.value; saveKa(); drawPoster(); });
    });
    $('kaBg').addEventListener('click', function () { $('kaBgFile').click(); });
    $('kaBgFile').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { keyart.bg = String(rd.result); saveKa(); drawPoster(); };
      rd.readAsDataURL(f);
      this.value = '';
    });
    $('kaGrab').addEventListener('click', function () { openGrab('__keyart__'); });
    $('kaPng').addEventListener('click', async function () {
      var c = await drawPoster(2);
      c.toBlob(function (blob) {
        dl(((keyart.title || 'poster').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'poster') + '-onesheet.png', blob, 'image/png');
        toast('Poster exported — 1600×2400');
      }, 'image/png');
    });
  }

  wire();
  renderAll();
  drawPoster();
  window.CBoardsApp = {
    getProject: function () { return project; },
    setShotImg: setShotImg,
    exportAnimatic: exportAnimatic,
    drawPoster: drawPoster,
    renderAll: renderAll
  };
})();
