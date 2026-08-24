/* CINAMATE Editor — the cutting room.
 *
 * Media bin (Studio clips + local files, persisted in IndexedDB),
 * ripple video track with trims/transitions/speed, title and music
 * tracks, canvas preview, and fully in-browser export: WebCodecs
 * H.264/AAC into our own MP4 writer (lib-mp4.js), with a real-time
 * recording fallback for browsers without WebCodecs.
 *
 * Engine: lib-cut.js (CCut). Storage: SB_Cut_v1 + IndexedDB 'cinamate_cut'.
 * All original code, written for Cinamate.
 */
(function () {
  'use strict';
  var C = window.CCut, M = window.CMux;
  var KEY = 'SB_Cut_v1';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function dl(name, data, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  var toastTimer = null;
  function toast(m) {
    var el = $('edToast'); el.textContent = m; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('on'); }, 3200);
  }

  /* ── IndexedDB media store (local files survive reloads) ────────── */
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('cinamate_cut', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('media'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbPut(id, blob) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').put(blob, id);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(id) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var rq = db.transaction('media').objectStore('media').get(id);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    });
  }

  /* ── state ──────────────────────────────────────────────────────── */
  var project = C.blank('Untitled Cut');
  var bin = [];            // {id,name,kind,url,dur,w,h,origin,idb,missing,thumb}
  var sel = null;          // {track:'video'|'titles'|'audio', id}
  var t = 0, playing = false, zoom = 70;
  var undoStack = [], redoStack = [];
  var vids = {}, audioBufs = {}, peaksCache = {};
  var prevFrame = document.createElement('canvas');

  function binById(id) { return bin.find(function (b) { return b.id === id; }); }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        project: project,
        bin: bin.map(function (b) {
          return { id: b.id, name: b.name, kind: b.kind, dur: b.dur, w: b.w, h: b.h, origin: b.origin, idb: !!b.idb, url: b.idb ? '' : b.url };
        }),
        lastExport: (window.__cutLastExport || null)
      }));
    } catch (e) {}
  }
  function snap() { undoStack.push(JSON.stringify(project)); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(project)); project = JSON.parse(undoStack.pop()); sel = null; renderAll(); save(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(project)); project = JSON.parse(redoStack.pop()); sel = null; renderAll(); save(); }

  /* ── media probing ──────────────────────────────────────────────── */
  function probe(url, kind) {
    return new Promise(function (res) {
      if (kind === 'audio') {
        var a = document.createElement('audio');
        a.preload = 'metadata'; a.src = url;
        a.onloadedmetadata = function () { res({ dur: isFinite(a.duration) ? a.duration : 0 }); };
        a.onerror = function () { res({ dur: 0, missing: true }); };
        return;
      }
      var v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.crossOrigin = 'anonymous'; v.src = url;
      v.onloadedmetadata = function () {
        if (!isFinite(v.duration)) {
          // recorded blobs report Infinity until seeked past the end
          v.onloadedmetadata = null;
          var fix = function () {
            v.removeEventListener('durationchange', fix);
            finish();
          };
          v.addEventListener('durationchange', fix);
          v.currentTime = 1e7;
          setTimeout(fix, 1500);
          return;
        }
        finish();
      };
      var finished = false;
      function finish() {
        if (finished) return; finished = true;
        var meta = { dur: isFinite(v.duration) ? v.duration : 0, w: v.videoWidth, h: v.videoHeight };
        v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
        v.onseeked = function () {
          try {
            var c = document.createElement('canvas'); c.width = 104; c.height = 60;
            c.getContext('2d').drawImage(v, 0, 0, 104, 60);
            meta.thumb = c.toDataURL('image/jpeg', 0.6);
          } catch (e) { /* tainted — no thumb */ }
          res(meta);
        };
        setTimeout(function () { res(meta); }, 1500);
      };
      v.onerror = function () { res({ dur: 0, missing: true }); };
    });
  }

  async function addBinItem(item) {
    var meta = await probe(item.url, item.kind);
    Object.assign(item, meta);
    var existing = binById(item.id);
    if (existing) Object.assign(existing, item);
    else bin.push(item);
    renderBin(); save();
    return item;
  }

  async function addFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var kind = f.type.indexOf('audio') === 0 ? 'audio' : 'video';
      var id = 'f_' + uid();
      try { await idbPut(id, f); } catch (e) {}
      await addBinItem({ id: id, name: f.name, kind: kind, url: URL.createObjectURL(f), origin: 'file', idb: true });
    }
    toast(files.length + ' file' + (files.length === 1 ? '' : 's') + ' added to the bin');
  }

  function loadStudioClips() {
    var st = null;
    try { st = JSON.parse(localStorage.getItem('SB_Timeline_v1') || 'null'); } catch (e) {}
    var clips = (st && st.clips || []).filter(function (c) { return c.videoUrl; });
    if (!clips.length) return toast('No rendered clips in the Studio yet — generate there first');
    var added = 0;
    var chain = Promise.resolve();
    clips.forEach(function (c) {
      chain = chain.then(function () {
        added++;
        return addBinItem({
          id: 'st_' + (c.num || added), name: 'SC' + String(c.num || added).padStart(2, '0') + ' ' + (c.label || ''),
          kind: 'video', url: c.videoUrl, origin: 'studio'
        });
      });
    });
    chain.then(function () { toast(added + ' Studio clips loaded'); });
  }

  /* ── bin render ─────────────────────────────────────────────────── */
  function renderBin() {
    $('edBinList').innerHTML = bin.map(function (b) {
      return '<div class="ed-binitem' + (b.missing ? ' missing' : '') + '" draggable="true" data-bin="' + esc(b.id) + '" title="Double-click to add to the timeline">' +
        (b.thumb ? '<img src="' + esc(b.thumb) + '" alt="">' : '<span class="ed-thumbph">' + (b.kind === 'audio' ? '🎵' : '🎬') + '</span>') +
        '<div class="ed-binmeta"><b>' + esc(b.name) + '</b><span>' + (b.missing ? 're-import needed' : (b.dur ? b.dur.toFixed(1) + 's' : '…')) + (b.origin === 'studio' ? ' · studio' : '') + '</span></div></div>';
    }).join('');
    $('edBinHint').style.display = bin.length ? 'none' : 'block';
  }

  function addToTimeline(binId, atT) {
    var b = binById(binId);
    if (!b || b.missing) return toast('That source needs re-importing first');
    snap();
    if (b.kind === 'audio') {
      project.audio.push({ id: uid(), srcId: b.id, label: b.name, start: Math.max(0, atT != null ? atT : t), in: 0, out: (isFinite(b.dur) && b.dur > 0) ? b.dur : 10, gain: 1 });
    } else {
      project.video.push({ id: uid(), srcId: b.id, label: b.name, in: 0, out: (isFinite(b.dur) && b.dur > 0) ? b.dur : 4, speed: 1, trans: { type: 'cut', dur: 0 } });
    }
    renderAll(); save();
  }

  /* ── timeline render ────────────────────────────────────────────── */
  function contentWidth() {
    var d = C.duration(project);
    if (!isFinite(d)) d = 600;
    return Math.min(600000, Math.max(d * zoom + 240, $('edTimeline').clientWidth - 34));
  }

  function renderRuler() {
    var w = contentWidth();
    var el = $('edRuler'); el.style.width = w + 'px';
    var step = zoom >= 120 ? 1 : zoom >= 50 ? 2 : 5;
    var h = '';
    for (var s = 0; s * zoom < w; s += step) h += '<span class="tick" style="left:' + (s * zoom) + 'px">' + (s % (step * 2) === 0 ? C.tc(s, project.fps).slice(3, 8) : '') + '</span>';
    // Screening Room notes land here as review markers — click one to jump.
    (project.markers || []).forEach(function (m, i) {
      h += '<span class="tick" data-mark="' + (+m.sec || 0) + '" title="' + esc(m.text || '') + '" style="left:' + ((+m.sec || 0) * zoom) + 'px;border-left:2px solid #C9A86C;height:100%;cursor:pointer">▾</span>';
    });
    el.innerHTML = h;
  }

  function clipEl(cls, id, left, width, inner, track) {
    return '<div class="ed-clip ' + cls + (sel && sel.id === id ? ' sel' : '') + '" draggable="true" data-id="' + esc(id) + '" data-tr="' + track + '" style="left:' + left + 'px;width:' + Math.max(14, width) + 'px">' +
      '<div class="ed-handle l" data-h="l"></div>' + inner + '<div class="ed-handle r" data-h="r"></div></div>';
  }

  function renderTimeline() {
    renderRuler();
    var w = contentWidth();
    ['edTrackVideo', 'edTrackTitles', 'edTrackAudio'].forEach(function (id) { $(id).style.width = w + 'px'; $(id).parentElement.style.width = (w + 34) + 'px'; });
    var st = C.starts(project);
    $('edTrackVideo').innerHTML = project.video.map(function (c, i) {
      var trans = c.trans && c.trans.type !== 'cut' && c.trans.dur > 0;
      return clipEl('', c.id, st[i] * zoom, C.effDur(c) * zoom,
        (trans ? '<div class="ed-trans"></div>' : '') +
        '<b>' + esc(c.label || 'Clip') + '</b><span class="ed-clipmeta">' + C.effDur(c).toFixed(1) + 's' + ((c.speed || 1) !== 1 ? ' · ' + esc(c.speed) + 'x' : '') + '</span>' +
        '<canvas class="ed-wave" data-wave="' + esc(c.srcId) + '"></canvas>', 'video');
    }).join('');
    $('edTrackTitles').innerHTML = project.titles.map(function (ti) {
      return clipEl('ed-title-clip', ti.id, ti.start * zoom, ti.dur * zoom, '<b>T</b> ' + esc(ti.text.slice(0, 22)), 'titles');
    }).join('');
    $('edTrackAudio').innerHTML = project.audio.map(function (a) {
      return clipEl('ed-audio-clip', a.id, a.start * zoom, C.effDur(a) * zoom,
        '<b>♪ ' + esc(a.label.slice(0, 20)) + '</b><canvas class="ed-wave" data-wave="' + esc(a.srcId) + '"></canvas>', 'audio');
    }).join('');
    $('edPlayhead').style.left = (34 + t * zoom) + 'px';
    $('edDur').textContent = '/ ' + C.tc(C.duration(project), project.fps);
    fillWaves();
  }

  /* waveforms, lazily */
  function getAudioBuffer(srcId) {
    if (audioBufs[srcId]) return audioBufs[srcId];
    var b = binById(srcId);
    if (!b || b.missing) return Promise.resolve(null);
    audioBufs[srcId] = fetch(b.url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      var ctx = new AC();
      return ctx.decodeAudioData(ab).then(function (buf) { ctx.close(); return buf; }, function () { ctx.close(); return null; });
    }).catch(function () { return null; });
    return audioBufs[srcId];
  }
  function fillWaves() {
    Array.prototype.forEach.call(document.querySelectorAll('canvas.ed-wave'), function (cv) {
      var srcId = cv.getAttribute('data-wave');
      if (peaksCache[srcId] === 'none') return;
      var draw = function (pk) {
        if (!pk) { peaksCache[srcId] = 'none'; return; }
        cv.width = cv.offsetWidth || 100; cv.height = 14;
        var g = cv.getContext('2d'); g.fillStyle = 'rgba(139,163,184,.8)';
        var n = pk.length;
        for (var i = 0; i < cv.width; i++) {
          var v = pk[Math.floor(i / cv.width * n)] || 0;
          g.fillRect(i, 14 - v * 13, 1, v * 13 + 1);
        }
      };
      if (peaksCache[srcId] && peaksCache[srcId] !== 'none') return draw(peaksCache[srcId]);
      getAudioBuffer(srcId).then(function (buf) {
        if (!buf) { peaksCache[srcId] = 'none'; return; }
        peaksCache[srcId] = C.peaks(buf.getChannelData(0), 240);
        draw(peaksCache[srcId]);
      });
    });
  }

  /* ── preview ────────────────────────────────────────────────────── */
  function ensureVideo(srcId) {
    if (vids[srcId]) return vids[srcId];
    var b = binById(srcId);
    var v = document.createElement('video');
    v.preload = 'auto'; v.muted = false; v.crossOrigin = 'anonymous'; v.playsInline = true;
    if (b) v.src = b.url;
    vids[srcId] = v;
    return v;
  }
  function seekVideo(v, time, fps) {
    return new Promise(function (res) {
      if (Math.abs(v.currentTime - time) < 1 / (2 * (fps || 24)) && v.readyState >= 2) return res();
      var done = function () { v.removeEventListener('seeked', done); res(); };
      v.addEventListener('seeked', done);
      try { v.currentTime = Math.max(0, time); } catch (e) { res(); }
      setTimeout(done, 2000);
    });
  }

  async function drawFrame(tt, ctx, W, H, exact) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    var hit = C.videoAt(project, tt);
    if (hit) {
      var v = ensureVideo(hit.clip.srcId);
      if (exact) await seekVideo(v, hit.srcTime, project.fps);
      if (v.readyState >= 2) {
        ctx.filter = C.cssFilter(hit.clip.color);
        drawCover(ctx, v, W, H);
        ctx.filter = 'none';
      }
      if (hit.prevHold && prevFrame.width) {
        ctx.globalAlpha = hit.prevHold.alpha;
        ctx.drawImage(prevFrame, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      if (hit.blackAlpha > 0) {
        ctx.globalAlpha = Math.min(1, hit.blackAlpha);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }
    C.titlesAt(project, tt).forEach(function (o) {
      var ti = o.title;
      ctx.save();
      ctx.globalAlpha = o.alpha;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 12;
      var y = ti.pos === 'lower' ? H * 0.82 : H * 0.5;
      ctx.fillStyle = '#E8EEF2';
      ctx.font = '700 ' + Math.round((ti.size || 64) * H / 720) + 'px Cinzel, serif';
      ctx.fillText(ti.text || '', W / 2, y);
      if (ti.sub) {
        ctx.font = '400 ' + Math.round((ti.size || 64) * 0.38 * H / 720) + 'px Inter, sans-serif';
        ctx.fillStyle = '#A0B4C8';
        ctx.fillText(ti.sub, W / 2, y + (ti.size || 64) * 0.75 * H / 720);
      }
      ctx.restore();
    });
  }
  function drawCover(ctx, v, W, H) {
    var vw = v.videoWidth || W, vh = v.videoHeight || H;
    // widescreen targets letterbox (contain); vertical/square social
    // targets crop-fill (cover) so the frame is full-bleed
    var s = (H >= W) ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
    var dw = vw * s, dh = vh * s;
    ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  var cv, cx;
  var scrubQueued = false;
  function seek(tt) {
    t = Math.max(0, Math.min(C.duration(project) || 0, tt));
    $('edTc').textContent = C.tc(t, project.fps);
    $('edPlayhead').style.left = (34 + t * zoom) + 'px';
    if (scrubQueued) return;
    scrubQueued = true;
    drawFrame(t, cx, cv.width, cv.height, true).then(function () { scrubQueued = false; });
  }

  var rafId = null, lastWall = 0, activeSrc = null, lastHitI = -1, shuttle = 1;
  function play() {
    if (playing) return pause();
    if (!project.video.length) return toast('Add clips to the timeline first');
    if (t >= C.duration(project) - 0.05) t = 0;
    playing = true; $('edPlay').textContent = '❚❚';
    lastWall = performance.now();
    var loop = function (now) {
      if (!playing) return;
      t += (now - lastWall) / 1000 * shuttle; lastWall = now;
      var total = C.duration(project);
      if (t >= total) { pause(); seek(total); return; }
      var hit = C.videoAt(project, t);
      if (hit) {
        var v = ensureVideo(hit.clip.srcId);
        if (hit.i !== lastHitI) {
          // cache outgoing frame for crossfades, hand off playback
          try { prevFrame.width = cv.width; prevFrame.height = cv.height; prevFrame.getContext('2d').drawImage(cv, 0, 0); } catch (e) {}
          if (activeSrc && vids[activeSrc] && activeSrc !== hit.clip.srcId) vids[activeSrc].pause();
          lastHitI = hit.i; activeSrc = hit.clip.srcId;
          v.currentTime = hit.srcTime;
          v.playbackRate = (hit.clip.speed || 1) * shuttle;
          v.play().catch(function () {});
        } else if (Math.abs(v.currentTime - hit.srcTime) > 0.18) {
          v.currentTime = hit.srcTime;
        }
      }
      syncAudio(true);
      drawFrame(t, cx, cv.width, cv.height, false);
      $('edTc').textContent = C.tc(t, project.fps);
      $('edPlayhead').style.left = (34 + t * zoom) + 'px';
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }
  function pause() {
    playing = false; $('edPlay').textContent = '▶';
    if (rafId) cancelAnimationFrame(rafId);
    Object.keys(vids).forEach(function (k) { vids[k].pause(); });
    audioEls.forEach(function (a) { a.el.pause(); });
    lastHitI = -1;
  }
  var audioEls = [];
  function syncAudio(playingNow) {
    project.audio.forEach(function (a) {
      var rec = audioEls.find(function (x) { return x.id === a.id; });
      if (!rec) {
        var b = binById(a.srcId);
        if (!b) return;
        var el = document.createElement(b.kind === 'audio' ? 'audio' : 'video');
        el.src = b.url; el.crossOrigin = 'anonymous';
        rec = { id: a.id, el: el };
        audioEls.push(rec);
      }
      var within = t >= a.start && t < a.start + C.effDur(a);
      rec.el.volume = Math.max(0, Math.min(1, a.gain == null ? 1 : a.gain));
      if (playingNow && within) {
        var want = a.in + (t - a.start);
        if (rec.el.paused) { rec.el.currentTime = want; rec.el.play().catch(function () {}); }
        else if (Math.abs(rec.el.currentTime - want) > 0.25) rec.el.currentTime = want;
      } else if (!within || !playingNow) rec.el.pause();
    });
  }

  /* ── selection + inspector ──────────────────────────────────────── */
  function findSel() {
    if (!sel) return null;
    var arr = project[sel.track] || [];
    return arr.find(function (x) { return x.id === sel.id; }) || null;
  }
  function renderInspector() {
    var el = $('edInspector');
    var it = findSel();
    if (!it) { el.innerHTML = '<p class="ed-dim">Select a clip, title or audio block.</p>'; return; }
    if (sel.track === 'video') {
      var b = binById(it.srcId) || {};
      el.innerHTML =
        '<label>Clip <input data-f="label" value="' + esc(it.label) + '"></label>' +
        '<label>In (s) <input data-f="in" type="number" step="0.1" value="' + it.in.toFixed(2) + '"></label>' +
        '<label>Out (s) <input data-f="out" type="number" step="0.1" value="' + it.out.toFixed(2) + '" max="' + esc(b.dur || '') + '"></label>' +
        '<label>Speed <select data-f="speed">' + [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4].map(function (s) {
          return '<option value="' + esc(s) + '"' + ((it.speed || 1) === s ? ' selected' : '') + '>' + esc(s) + 'x</option>';
        }).join('') + '</select></label>' +
        '<label>Transition in <select data-f="transType">' + ['cut', 'crossfade', 'fadeblack'].map(function (ty) {
          return '<option' + ((it.trans && it.trans.type) === ty ? ' selected' : '') + '>' + ty + '</option>';
        }).join('') + '</select></label>' +
        '<label>Transition length <input data-f="transDur" type="number" step="0.1" min="0" max="3" value="' + esc((it.trans && it.trans.dur) || 0) + '"></label>' +
        '<h3 style="margin-top:10px">Color</h3>' +
        '<label>Exposure <input data-f="colEx" type="range" min="0.5" max="1.6" step="0.02" value="' + esc((it.color && it.color.ex) || 1) + '"></label>' +
        '<label>Contrast <input data-f="colCt" type="range" min="0.6" max="1.6" step="0.02" value="' + esc((it.color && it.color.ct) || 1) + '"></label>' +
        '<label>Saturation <input data-f="colSat" type="range" min="0" max="2" step="0.05" value="' + esc((it.color && it.color.sat) || 1) + '"></label>' +
        '<label>Warmth <input data-f="colTw" type="range" min="-1" max="1" step="0.05" value="' + esc((it.color && it.color.tw) || 0) + '"></label>' +
        '<div style="display:flex;gap:6px;margin:4px 0 8px">' +
          '<button class="tb-btn" id="edAutoColor" title="Balance exposure and contrast from this frame">✨ Auto</button>' +
          '<button class="tb-btn" id="edResetColor">Reset</button></div>' +
        '<button class="tb-btn" id="edDelSel">✕ Remove clip</button>';
    } else if (sel.track === 'titles') {
      el.innerHTML =
        '<label>Title text <input data-f="text" value="' + esc(it.text) + '"></label>' +
        '<label>Subtitle <input data-f="sub" value="' + esc(it.sub || '') + '"></label>' +
        '<label>Start (s) <input data-f="start" type="number" step="0.1" value="' + it.start.toFixed(1) + '"></label>' +
        '<label>Length (s) <input data-f="dur" type="number" step="0.1" min="0.5" value="' + it.dur.toFixed(1) + '"></label>' +
        '<label>Position <select data-f="pos"><option' + (it.pos === 'center' ? ' selected' : '') + '>center</option><option' + (it.pos === 'lower' ? ' selected' : '') + '>lower</option></select></label>' +
        '<label>Size <input data-f="size" type="number" min="20" max="160" value="' + esc(it.size || 64) + '"></label>' +
        '<button class="tb-btn" id="edDelSel">✕ Remove title</button>';
    } else {
      el.innerHTML =
        '<label>Audio <input data-f="label" value="' + esc(it.label) + '"></label>' +
        '<label>Start (s) <input data-f="start" type="number" step="0.1" value="' + it.start.toFixed(1) + '"></label>' +
        '<label>In (s) <input data-f="in" type="number" step="0.1" value="' + it.in.toFixed(1) + '"></label>' +
        '<label>Out (s) <input data-f="out" type="number" step="0.1" value="' + it.out.toFixed(1) + '"></label>' +
        '<label>Volume <input data-f="gain" type="range" min="0" max="1" step="0.05" value="' + esc(it.gain == null ? 1 : it.gain) + '"></label>' +
        '<button class="tb-btn" id="edDelSel">✕ Remove audio</button>';
    }
    el.querySelectorAll('[data-f]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var it2 = findSel(); if (!it2) return;
        var before = JSON.stringify(project);
        snap();
        var f = inp.getAttribute('data-f'), val = inp.value;
        if (f === 'transType') { it2.trans = it2.trans || { dur: 0.5 }; it2.trans.type = val; if (val !== 'cut' && !it2.trans.dur) it2.trans.dur = 0.5; }
        else if (f === 'transDur') { it2.trans = it2.trans || { type: 'crossfade' }; it2.trans.dur = parseFloat(val) || 0; }
        else if (f.indexOf('col') === 0) {
          it2.color = it2.color || { ex: 1, ct: 1, sat: 1, tw: 0 };
          it2.color[{ colEx: 'ex', colCt: 'ct', colSat: 'sat', colTw: 'tw' }[f]] = parseFloat(val);
        }
        else if (['in', 'out', 'speed', 'start', 'dur', 'gain', 'size'].indexOf(f) >= 0) it2[f] = parseFloat(val);
        else it2[f] = val;
        if (sel.track === 'video') C.clampTrim(it2, (binById(it2.srcId) || {}).dur || 0);
        if (JSON.stringify(project) === before) undoStack.pop(); // no-op change — keep undo clean
        renderAll(); save(); seek(t);
      });
    });
    var auto = $('edAutoColor');
    if (auto) auto.addEventListener('click', function () {
      var it2 = findSel(); if (!it2) return;
      var v = ensureVideo(it2.srcId);
      if (!v || v.readyState < 2) return toast('Scrub onto the clip first so a frame is loaded');
      snap();
      var cnv = document.createElement('canvas'); cnv.width = 160; cnv.height = 90;
      var cctx = cnv.getContext('2d', { willReadFrequently: true });
      try {
        cctx.drawImage(v, 0, 0, 160, 90);
        var d = cctx.getImageData(0, 0, 160, 90).data;
        var hist = new Array(256).fill(0);
        for (var px = 0; px < d.length; px += 4) {
          hist[Math.min(255, Math.round(0.2126 * d[px] + 0.7152 * d[px + 1] + 0.0722 * d[px + 2]))]++;
        }
        it2.color = C.autoColor(hist);
        renderInspector(); save(); seek(t);
        toast('Balanced — exposure ' + it2.color.ex + ' · contrast ' + it2.color.ct);
      } catch (e) { toast('This source blocks pixel reads — re-import it as a local file'); }
    });
    var resetC = $('edResetColor');
    if (resetC) resetC.addEventListener('click', function () {
      var it2 = findSel(); if (!it2) return;
      snap(); delete it2.color; renderInspector(); save(); seek(t);
    });
    var del = $('edDelSel');
    if (del) del.addEventListener('click', function () {
      snap();
      var arr = project[sel.track];
      var i = arr.findIndex(function (x) { return x.id === sel.id; });
      if (i >= 0) arr.splice(i, 1);
      sel = null; renderAll(); save(); seek(t);
    });
  }

  function renderAll() { renderBin(); renderTimeline(); renderInspector(); }

  /* ── timeline interactions ──────────────────────────────────────── */
  function wireTimeline() {
    var tl = $('edTimeline');
    $('edRuler').addEventListener('click', function (e) {
      var r = $('edRuler').getBoundingClientRect();
      seek((e.clientX - r.left) / zoom);
    });
    tl.addEventListener('click', function (e) {
      var clip = e.target.closest('.ed-clip');
      if (!clip) return;
      sel = { track: clip.getAttribute('data-tr'), id: clip.getAttribute('data-id') };
      renderTimeline(); renderInspector();
    });
    // drag to reorder video clips / move titles+audio
    var dragId = null, dragTr = null;
    tl.addEventListener('dragstart', function (e) {
      var clip = e.target.closest('.ed-clip'); if (!clip) return;
      dragId = clip.getAttribute('data-id'); dragTr = clip.getAttribute('data-tr');
      clip.classList.add('dragging');
      e.dataTransfer.setData('text/plain', dragId);
    });
    tl.addEventListener('dragend', function (e) {
      var clip = e.target.closest('.ed-clip'); if (clip) clip.classList.remove('dragging');
    });
    tl.addEventListener('dragover', function (e) { e.preventDefault(); });
    tl.addEventListener('drop', function (e) {
      e.preventDefault();
      var binId = e.dataTransfer.getData('text/plain');
      // from bin?
      if (binById(binId) && !dragId) {
        var r2 = $('edRuler').getBoundingClientRect();
        addToTimeline(binId, (e.clientX - r2.left) / zoom);
        return;
      }
      if (!dragId) return;
      if (dragTr === 'video') {
        var target = e.target.closest('.ed-clip[data-tr="video"]');
        var from = project.video.findIndex(function (c) { return c.id === dragId; });
        var to = target ? project.video.findIndex(function (c) { return c.id === target.getAttribute('data-id'); }) : project.video.length - 1;
        if (from >= 0 && to >= 0 && from !== to) { snap(); C.move(project.video, from, to); renderAll(); save(); }
      } else {
        var arr = project[dragTr];
        var it = arr.find(function (x) { return x.id === dragId; });
        var r3 = $('edRuler').getBoundingClientRect();
        if (it) { snap(); it.start = Math.max(0, (e.clientX - r3.left) / zoom); renderAll(); save(); }
      }
      dragId = null;
    });
    // trim handles (pointer events)
    tl.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('.ed-handle'); if (!h) return;
      var clipEl2 = h.closest('.ed-clip');
      var tr = clipEl2.getAttribute('data-tr'), id = clipEl2.getAttribute('data-id'), side = h.getAttribute('data-h');
      var it = (project[tr] || []).find(function (x) { return x.id === id; });
      if (!it) return;
      e.preventDefault(); e.stopPropagation();
      clipEl2.draggable = false;
      snap();
      var startX = e.clientX;
      var orig = JSON.parse(JSON.stringify(it));
      var srcDur = (binById(it.srcId) || {}).dur || 0;
      var moveFn = function (ev) {
        var dt = (ev.clientX - startX) / zoom;
        if (tr === 'titles') {
          if (side === 'l') { var ns = Math.max(0, orig.start + dt); it.dur = Math.max(0.5, orig.dur + (orig.start - ns)); it.start = ns; }
          else it.dur = Math.max(0.5, orig.dur + dt);
        } else {
          var sp = it.speed || 1;
          if (side === 'l') it.in = orig.in + dt * sp;
          else it.out = orig.out + dt * sp;
          C.clampTrim(it, srcDur);
          if (tr === 'audio' && side === 'l') it.start = Math.max(0, orig.start + dt);
        }
        renderTimeline();
      };
      var upFn = function () {
        document.removeEventListener('pointermove', moveFn);
        document.removeEventListener('pointerup', upFn);
        clipEl2.draggable = true;
        renderAll(); save(); seek(t);
      };
      document.addEventListener('pointermove', moveFn);
      document.addEventListener('pointerup', upFn);
    });
  }

  /* ── export: WebCodecs → our MP4 writer ─────────────────────────── */
  function prog(pct, txt) {
    $('edProgWrap').classList.remove('hidden');
    $('edProg').style.width = Math.round(pct * 100) + '%';
    $('edProgTxt').textContent = txt || Math.round(pct * 100) + '%';
    if (pct >= 1) setTimeout(function () { $('edProgWrap').classList.add('hidden'); }, 1800);
  }

  function fallbackAsc(sampleRate, channels) {
    var rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
    var idx = rates.indexOf(sampleRate); if (idx < 0) idx = 3;
    return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3)]);
  }

  async function mixAudio(durSec, sampleRate) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    var ctx = new OAC(2, Math.max(1, Math.ceil(durSec * sampleRate)), sampleRate);
    var st = C.starts(project);
    var jobs = [];
    project.video.forEach(function (c, i) {
      jobs.push(getAudioBuffer(c.srcId).then(function (buf) {
        if (!buf) return;
        var src = ctx.createBufferSource();
        src.buffer = buf; src.playbackRate.value = c.speed || 1;
        src.connect(ctx.destination);
        src.start(st[i], c.in, c.out - c.in);
      }));
    });
    project.audio.forEach(function (a) {
      jobs.push(getAudioBuffer(a.srcId).then(function (buf) {
        if (!buf) return;
        var src = ctx.createBufferSource();
        src.buffer = buf;
        var g = ctx.createGain(); g.gain.value = a.gain == null ? 1 : a.gain;
        src.connect(g); g.connect(ctx.destination);
        src.start(a.start, a.in, a.out - a.in);
      }));
    });
    await Promise.all(jobs);
    return ctx.startRendering();
  }

  async function encodeAudio(rendered) {
    if (!window.AudioEncoder || !rendered) return null;
    var cfg = { codec: 'mp4a.40.2', sampleRate: rendered.sampleRate, numberOfChannels: 2, bitrate: 128000 };
    try {
      var sup = await AudioEncoder.isConfigSupported(cfg);
      if (!sup || !sup.supported) return null;
    } catch (e) { return null; }
    var chunks = [], sizes = [], durs = [], desc = null;
    var enc = new AudioEncoder({
      output: function (chunk, meta) {
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !desc) desc = new Uint8Array(meta.decoderConfig.description.slice ? meta.decoderConfig.description : new Uint8Array(meta.decoderConfig.description));
        var u = new Uint8Array(chunk.byteLength); chunk.copyTo(u);
        chunks.push(u); sizes.push(u.length);
        durs.push(Math.round((chunk.duration || 21333) * rendered.sampleRate / 1e6));
      },
      error: function (e) { console.warn('[Cinamate] audio encode', e); }
    });
    enc.configure(cfg);
    var L = rendered.getChannelData(0), R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
    var BLOCK = 4096;
    for (var off = 0; off < rendered.length; off += BLOCK) {
      var n = Math.min(BLOCK, rendered.length - off);
      var data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      enc.encode(new AudioData({
        format: 'f32-planar', sampleRate: rendered.sampleRate, numberOfFrames: n,
        numberOfChannels: 2, timestamp: Math.round(off / rendered.sampleRate * 1e6), data: data
      }));
    }
    await enc.flush(); enc.close();
    if (!chunks.length) return null;
    var total = sizes.reduce(function (a, b) { return a + b; }, 0);
    var data2 = new Uint8Array(total), o = 0;
    chunks.forEach(function (c) { data2.set(c, o); o += c.length; });
    return {
      type: 'audio', timescale: rendered.sampleRate, durations: durs, sizes: sizes, data: data2,
      description: desc || fallbackAsc(rendered.sampleRate, 2), channels: 2, sampleRate: rendered.sampleRate
    };
  }

  async function exportMp4() {
    if (!project.video.length) return toast('Nothing on the timeline yet');
    var res = $('edRes').value.split('x');
    var W = +res[0], H = +res[1];
    var fps = +$('edFps').value || 24;
    if (!window.VideoEncoder) return exportRealtime();
    var codecs = ['avc1.640028', 'avc1.4d401f', 'avc1.42001f'];
    var cfg = null;
    for (var i = 0; i < codecs.length; i++) {
      var c0 = { codec: codecs[i], width: W, height: H, bitrate: Math.round(W * H * fps * 0.12), framerate: fps, avc: { format: 'avc' } };
      try {
        var sup = await VideoEncoder.isConfigSupported(c0);
        if (sup && sup.supported) { cfg = c0; break; }
      } catch (e) {}
    }
    if (!cfg) { toast('No H.264 encoder in this browser — using compatibility export'); return exportRealtime(); }

    pause();
    var wasT = t;
    var total = C.duration(project);
    var frames = Math.ceil(total * fps);
    var off = document.createElement('canvas'); off.width = W; off.height = H;
    var octx = off.getContext('2d');
    var chunks = [], sizes = [], syncs = [], desc = null, errored = null;
    var enc = new VideoEncoder({
      output: function (chunk, meta) {
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !desc) desc = new Uint8Array(meta.decoderConfig.description);
        var u = new Uint8Array(chunk.byteLength); chunk.copyTo(u);
        chunks.push(u); sizes.push(u.length); syncs.push(chunk.type === 'key');
      },
      error: function (e) { errored = e; }
    });
    enc.configure(cfg);
    prog(0, 'rendering audio…');
    var audioTrack = null;
    try { audioTrack = await encodeAudio(await mixAudio(total, 48000)); } catch (e) { console.warn('[Cinamate] audio mix skipped', e); }

    try {
      for (var f = 0; f < frames; f++) {
        var tt = f / fps;
        await drawFrame(tt, octx, W, H, true);
        var frame = new VideoFrame(off, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
        frame.close();
        while (enc.encodeQueueSize > 4) await new Promise(function (r) { setTimeout(r, 8); });
        if (errored) throw errored;
        if (f % 6 === 0) prog(f / frames * 0.95, 'frame ' + f + '/' + frames);
      }
      await enc.flush(); enc.close();
    } catch (e) {
      try { enc.close(); } catch (e2) {}
      prog(1, 'failed');
      if (String(e.name || e).indexOf('Security') >= 0) return toast('A source blocks cross-origin rendering — re-import it as a local file and try again');
      return toast('Export failed: ' + (e.message || e));
    }
    prog(0.97, 'writing MP4…');
    var totalB = sizes.reduce(function (a, b) { return a + b; }, 0);
    var vdata = new Uint8Array(totalB), o = 0;
    chunks.forEach(function (c2) { vdata.set(c2, o); o += c2.length; });
    var tracks = [{
      type: 'video', timescale: 90000,
      durations: sizes.map(function () { return Math.round(90000 / fps); }),
      sizes: sizes, data: vdata, sync: syncs,
      description: desc || new Uint8Array([1, 66, 0, 31, 255, 225, 0, 0]), width: W, height: H
    }];
    if (audioTrack) tracks.push(audioTrack);
    var mp4 = M.buildMp4(tracks);
    var name = (project.name || 'cinamate-cut').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cinamate-cut';
    dl(name + '.mp4', new Blob([mp4], { type: 'video/mp4' }), 'video/mp4');
    window.__cutLastExport = { when: new Date().toISOString(), dur: Math.round(total * 10) / 10, res: W + 'x' + H, audio: !!audioTrack };
    save();
    prog(1, 'done');
    toast('Exported ' + name + '.mp4 (' + (mp4.length / 1048576).toFixed(1) + ' MB' + (audioTrack ? ', with audio' : ', video only') + ')');
    seek(wasT);
  }

  /* real-time fallback for browsers without WebCodecs */
  function exportRealtime() {
    if (!window.MediaRecorder || !cv.captureStream) return toast('This browser cannot export video — try Chrome, Edge or Safari 26+');
    pause();
    var total = C.duration(project);
    var stream = cv.captureStream(30);
    var rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
    var parts = [];
    rec.ondataavailable = function (e) { if (e.data.size) parts.push(e.data); };
    rec.onstop = function () {
      var name = (project.name || 'cinamate-cut').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'cinamate-cut';
      dl(name + '.webm', new Blob(parts, { type: 'video/webm' }), 'video/webm');
      window.__cutLastExport = { when: new Date().toISOString(), dur: Math.round(total * 10) / 10, res: cv.width + 'x' + cv.height, audio: false };
      save();
      toast('Compatibility export finished (.webm, silent) — picture only');
    };
    toast('Compatibility export: playing the cut once in real time…');
    seek(0); rec.start(250); play();
    var watch = setInterval(function () {
      if (!playing) { clearInterval(watch); rec.stop(); }
    }, 300);
  }

  /* ── boot ───────────────────────────────────────────────────────── */
  async function loadSaved() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!d) return;
    if (d.project) project = Object.assign(C.blank(), d.project);
    window.__cutLastExport = d.lastExport || null;
    var items = d.bin || [];
    for (var i = 0; i < items.length; i++) {
      var b = items[i];
      if (b.idb) {
        var blob = await idbGet(b.id);
        if (blob) b.url = URL.createObjectURL(blob);
        else b.missing = true;
      }
      if (!b.url && !b.missing) b.missing = true;
      bin.push(b);
      if (b.url && !b.thumb) probe(b.url, b.kind).then((function (bb) {
        return function (meta) { Object.assign(bb, meta); renderBin(); };
      })(b));
    }
  }

  function wire() {
    $('edFromStudio').addEventListener('click', loadStudioClips);
    $('edImport').addEventListener('click', function () { $('edFile').click(); });
    $('edFile').addEventListener('change', function () { if (this.files.length) addFiles(Array.prototype.slice.call(this.files)); });
    $('edBinList').addEventListener('dblclick', function (e) {
      var it = e.target.closest('.ed-binitem');
      if (it) addToTimeline(it.getAttribute('data-bin'));
    });
    $('edBinList').addEventListener('dragstart', function (e) {
      var it = e.target.closest('.ed-binitem');
      if (it) e.dataTransfer.setData('text/plain', it.getAttribute('data-bin'));
    });
    $('edName').addEventListener('change', function () { project.name = this.value || 'Untitled Cut'; save(); });
    $('edPlay').addEventListener('click', play);
    $('edToStart').addEventListener('click', function () { pause(); seek(0); });
    $('edSplit').addEventListener('click', function () { snap(); if (C.split(project, t)) { renderAll(); save(); } else toast('Park the playhead inside a clip to split'); });
    $('edAddTitle').addEventListener('click', function () {
      snap();
      var ti = { id: uid(), text: 'TITLE', sub: '', start: Math.round(t * 10) / 10, dur: 3, pos: 'center', size: 64 };
      project.titles.push(ti);
      sel = { track: 'titles', id: ti.id };
      renderAll(); save(); seek(t);
    });
    $('edZoom').addEventListener('input', function () { zoom = +this.value; renderTimeline(); });
    $('edUndo').addEventListener('click', undo);
    $('edRedo').addEventListener('click', redo);
    var bAsm = $('edAssemble');
    if (bAsm) bAsm.addEventListener('click', function () {
      var sources = bin.filter(function (b) { return b.kind === 'video' && b.dur > 0.4 && !b.missing; })
        .map(function (b) {
          var m = /sc(?:ene)?\s*(\d+)/i.exec(b.name || '');
          return { id: b.id, dur: b.dur, label: b.name, scene: m ? +m[1] : null };
        });
      if (!sources.length) return toast('Load Studio clips or import footage first');
      snap();
      var n = C.assemble(project, sources, {});
      renderAll(); save(); seek(0);
      toast('Rough cut assembled — ' + n + ' clips in story order, crossfades on scene changes');
    });
    async function envelopeFor(srcId, rate) {
      var b = binById(srcId); if (!b || !b.url) return null;
      try {
        var ab = await (await fetch(b.url)).arrayBuffer();
        var ac = new (window.AudioContext || window.webkitAudioContext)();
        var buf = await ac.decodeAudioData(ab);
        var ch = buf.getChannelData(0);
        var per = Math.max(1, Math.floor(buf.sampleRate / rate));
        var env = [];
        for (var i = 0; i < ch.length; i += per) {
          var m = 0;
          for (var k2 = i; k2 < Math.min(ch.length, i + per); k2 += 16) m = Math.max(m, Math.abs(ch[k2]));
          env.push(m);
        }
        ac.close();
        return env;
      } catch (e) { return null; }
    }
    var bTight = $('edTighten');
    if (bTight) bTight.addEventListener('click', async function () {
      if (!project.video.length) return toast('Nothing on the timeline yet');
      bTight.disabled = true;
      toast('Listening for dead air…');
      var silBySrc = {}, seen = {};
      for (var i = 0; i < project.video.length; i++) {
        var srcId = project.video[i].srcId;
        if (seen[srcId]) continue; seen[srcId] = 1;
        var env = await envelopeFor(srcId, 50);
        if (env) silBySrc[srcId] = C.silences(env, 50, {});
      }
      snap();
      var cut2 = C.tighten(project, silBySrc, {});
      bTight.disabled = false;
      renderAll(); save(); seek(0);
      toast(cut2 > 0 ? 'Tightened — ' + cut2 + 's of dead air removed' : 'No leading/trailing silence found');
    });
    var bBeats = $('edBeatCut');
    if (bBeats) bBeats.addEventListener('click', async function () {
      if (!project.audio.length) return toast('Drop a music track on A1 first — cuts land on its beats');
      if (!project.video.length) return toast('Nothing on the timeline yet');
      bBeats.disabled = true;
      toast('Finding the beat…');
      var env = await envelopeFor(project.audio[0].srcId, 50);
      bBeats.disabled = false;
      if (!env) return toast('Could not decode that audio — try a local file');
      var bts = C.beats(env, 50, {});
      if (bts.length < 3) return toast('No steady beat found in that track');
      snap();
      var srcDur = {};
      bin.forEach(function (b) { srcDur[b.id] = b.dur || 0; });
      var n2 = C.cutToBeats(project, bts, srcDur);
      renderAll(); save(); seek(0);
      toast('Cut to the music — ' + n2 + ' cuts on ' + bts.length + ' beats');
    });
    $('edExport').addEventListener('click', exportMp4);
    $('edEdl').addEventListener('click', function () {
      if (!project.video.length) return toast('Nothing to export yet');
      dl((project.name || 'cut').replace(/\s+/g, '_') + '.edl', C.edl(project), 'text/plain');
    });
    $('edOtio').addEventListener('click', function () {
      if (!project.video.length) return toast('Nothing to export yet');
      var srcMap = {};
      bin.forEach(function (b) { srcMap[b.id] = { url: b.origin === 'file' ? b.name : b.url }; });
      dl((project.name || 'cut').replace(/\s+/g, '_') + '.otio', JSON.stringify(C.otio(project, srcMap), null, 2), 'application/json');
    });
    document.addEventListener('keydown', function (e) {
      if (/input|textarea|select/i.test((e.target.tagName || ''))) return;
      if (e.code === 'Space') { e.preventDefault(); shuttle = 1; play(); }
      if (e.key === 'j' || e.key === 'J') { seek(Math.max(0, t - 1)); }
      if (e.key === 'k' || e.key === 'K') { shuttle = 1; if (playing) pause(); else play(); }
      if (e.key === 'l' || e.key === 'L') {
        if (!playing) { shuttle = 1; play(); }
        else { shuttle = shuttle >= 4 ? 1 : shuttle * 2; toast('▶ ' + shuttle + 'x'); }
      }
      if (e.key === 's' || e.key === 'S') $('edSplit').click();
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { var d = $('edDelSel'); if (d) d.click(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    });
    wireTimeline();
  }

  async function init() {
    cv = $('edCanvas'); cx = cv.getContext('2d');
    await loadSaved();
    $('edName').value = project.name || 'Untitled Cut';
    wire();
    renderAll();
    seek(0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CCutApp = {
    getProject: function () { return project; },
    getBin: function () { return bin; },
    addBinItem: addBinItem,
    addToTimeline: addToTimeline,
    seek: seek,
    drawFrame: drawFrame,
    exportMp4: exportMp4,
    save: save,
    renderAll: renderAll
  };
})();
