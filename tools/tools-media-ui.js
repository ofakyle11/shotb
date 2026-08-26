/* Cinamate Tools — media tabs: Slate & Takes, Offload/MHL, Dailies Review,
 * Lens & Coverage, Look/LUTs, Credit Roll, Moodboard.
 * All original code, written for Cinamate. Uses only built-in browser APIs
 * (canvas, WebCrypto, MediaRecorder, requestVideoFrameCallback).
 */
(function (root) {
  'use strict';
  /* Attribute-safe escaping for any value interpolated into markup.
     C.esc leaves the apostrophe raw, so use this one for values. */
  function escAttr(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var C = root.TCore, MD = root.TMedia, esc = C.esc, num = C.num;
  root.TTabs = root.TTabs || {};

  /* ── Slate & take logger ─────────────────────────────────────── */
  root.TTabs.takes = function () {
    var el = C.$('pane-takes');
    var KEY = 'SB_Slate_v1';
    var sl = C.load(KEY, { scene: '1', take: 1, roll: 'A001' });
    el.innerHTML = '<h2>Digital Slate & Take Log</h2>' +
      '<p class="tk-desc">A phone-friendly slate: tap it to mark — it flashes and beeps for sync, logs the take, and bumps the counter. The take log is your script supervisor\'s record: circled takes, camera notes, all exportable.</p>' +
      '<div class="tk-cols"><div>' +
      '<div class="tk-slate" id="slSlate"><div class="row">' +
      '<div><div class="sc" id="slScene">' + esc(sl.scene) + '</div><div class="lbl">Scene</div></div>' +
      '<div><div class="sc" id="slTake">' + escAttr(sl.take) + '</div><div class="lbl">Take</div></div>' +
      '<div><div class="sc" id="slRoll">' + esc(sl.roll) + '</div><div class="lbl">Roll</div></div></div>' +
      '<div class="lbl" style="margin-top:14px">TAP TO MARK</div></div>' +
      '<div class="tk-grid" style="margin-top:10px;max-width:520px">' +
      '<div class="tk-field"><label>Scene</label><input id="slSceneIn" value="' + esc(sl.scene) + '"></div>' +
      '<div class="tk-field"><label>Take</label><input id="slTakeIn" value="' + escAttr(sl.take) + '"></div>' +
      '<div class="tk-field"><label>Roll</label><input id="slRollIn" value="' + esc(sl.roll) + '"></div></div>' +
      '</div><div id="tkLogWrap"></div></div>';

    /* The shoot day is a FIELD on the take, not something a reader may guess.
       Without it these rows carried only a wall-clock `time`, so the daily
       production report had nothing to filter on and reported every take ever
       logged on every date. `day` is the same 'YYYY-MM-DD' the shoot-day
       record and /dailies/ use — one join key across all three. */
    function shootDay() {
      var SD = root.CShootDays;
      if (!SD) return C.today();
      var rec = SD.currentDay(SD.load(root.localStorage), C.today());
      return (rec && rec.date) || C.today();
    }
    var log = new C.Register({
      key: 'SB_TakeLog_v1',
      blank: function () { return { day: shootDay(), time: '', scene: sl.scene, take: sl.take, roll: sl.roll, grade: '—', note: '' }; },
      fields: [
        { id: 'day', label: 'Shoot day', type: 'date', width: '112px' },
        { id: 'time', label: 'Time', width: '80px' },
        { id: 'scene', label: 'Scene', width: '70px' },
        { id: 'take', label: 'Take', width: '60px' },
        { id: 'roll', label: 'Roll', width: '70px' },
        { id: 'grade', label: 'Grade', type: 'select', options: ['—', 'Circled ⭕', 'Good', 'NG', 'False start'] },
        { id: 'note', label: 'Note' }
      ],
      summary: function (rows) {
        var circ = rows.filter(function (r) { return /Circled/.test(r.grade || ''); }).length;
        return '<b>' + rows.length + '</b> takes logged · <b>' + circ + '</b> circled';
      }
    });
    log.render('tkLogWrap');

    function persist() { C.save(KEY, sl); }
    ['Scene', 'Take', 'Roll'].forEach(function (k) {
      C.$('sl' + k + 'In').addEventListener('change', function () {
        sl[k.toLowerCase()] = this.value;
        C.$('sl' + k).textContent = this.value;
        persist();
      });
    });
    C.$('slSlate').onclick = function () {
      var d = C.$('slSlate');
      d.classList.add('flash');
      setTimeout(function () { d.classList.remove('flash'); }, 120);
      try {
        var ac = new (root.AudioContext || root.webkitAudioContext)();
        var o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 1000; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.25, ac.currentTime);
        o.start(); o.stop(ac.currentTime + 0.08);
      } catch (e) {}
      var now = new Date();
      log.add({ day: shootDay(), time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'), scene: sl.scene, take: sl.take, roll: sl.roll, grade: '—', note: '' });
      log.render('tkLogWrap');
      sl.take = (parseInt(sl.take, 10) || 0) + 1;
      C.$('slTake').textContent = sl.take;
      C.$('slTakeIn').value = sl.take;
      persist();
    };
  };

  /* ── Offload / media hash manifest ───────────────────────────── */
  root.TTabs.offload = function () {
    var el = C.$('pane-offload');
    el.innerHTML = '<h2>Offload Verification — Hash Manifest</h2>' +
      '<p class="tk-desc">Pick a card\'s files: every file is SHA-256 hashed in this browser (nothing uploads anywhere) and a verifiable MHL-style manifest is generated. Later, load the manifest and re-pick the copied files to prove the copy is bit-perfect.</p>' +
      '<div class="tk-bar"><input type="file" id="ofFiles" multiple style="display:none">' +
      '<button class="tb-btn gold" onclick="document.getElementById(\'ofFiles\').click()">1 · Pick files & hash</button>' +
      '<input type="file" id="ofManifest" accept=".xml,.mhl" style="display:none">' +
      '<button class="tb-btn" onclick="document.getElementById(\'ofManifest\').click()">2 · Verify against manifest</button></div>' +
      '<div id="ofOut"></div>';
    var lastEntries = null, loadedManifest = null;
    async function hashFiles(files, cb) {
      var out = [], done = 0, total = files.length;
      C.$('ofOut').innerHTML = '<div class="tk-result">Hashing 0/' + escAttr(total) + '…</div>';
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var buf = await f.arrayBuffer();
        var dig = await crypto.subtle.digest('SHA-256', buf);
        var hex = Array.from(new Uint8Array(dig)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        out.push({ path: f.webkitRelativePath || f.name, size: f.size, sha256: hex });
        done++;
        C.$('ofOut').innerHTML = '<div class="tk-result">Hashing ' + escAttr(done) + '/' + escAttr(total) + '…</div>';
      }
      cb(out);
    }
    C.$('ofFiles').onchange = function () {
      if (!this.files.length) return;
      hashFiles(Array.prototype.slice.call(this.files), function (entries) {
        lastEntries = entries;
        if (loadedManifest) return verify(entries);
        var xml = MD.manifestXml(entries, { project: (C.load('SB_Timeline_v1', {}) || {}).projectName || 'Cinamate' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
        a.download = 'cinamate-manifest.xml';
        a.click();
        C.$('ofOut').innerHTML = '<div class="tk-result"><span class="tk-chip good">' + entries.length + ' FILES HASHED</span> manifest downloaded — store it with the media.' +
          '<div class="bud-tablewrap" style="margin-top:8px"><table class="bud-table"><tbody>' +
          entries.slice(0, 12).map(function (e) { return '<tr><td>' + esc(e.path) + '</td><td class="bud-r" style="font-family:var(--mono);font-size:10px">' + e.sha256.slice(0, 16) + '…</td></tr>'; }).join('') +
          '</tbody></table></div></div>';
      });
    };
    C.$('ofManifest').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        loadedManifest = MD.parseManifest(r.result);
        C.$('ofOut').innerHTML = '<div class="tk-result">Manifest loaded — ' + loadedManifest.length + ' files on record. Now pick the copied files to verify.</div>';
        if (lastEntries) verify(lastEntries);
      };
      r.readAsText(f);
    };
    function verify(entries) {
      var v = MD.verifyAgainst(loadedManifest, entries);
      C.$('ofOut').innerHTML = '<div class="tk-result">' +
        (v.clean ? '<span class="tk-chip good">COPY VERIFIED — BIT-PERFECT</span> ' : '<span class="tk-chip bad">MISMATCH</span> ') +
        v.ok.length + ' ok · ' + v.changed.length + ' changed · ' + v.missing.length + ' missing · ' + v.extra.length + ' extra' +
        (v.changed.length ? '<br>Changed: ' + v.changed.map(esc).join(', ') : '') +
        (v.missing.length ? '<br>Missing: ' + v.missing.map(esc).join(', ') : '') + '</div>';
    }
  };

  /* ── Dailies review ───────────────────────────────────────────── */
  root.TTabs.review = function () {
    var el = C.$('pane-review');
    el.innerHTML = '<h2>Dailies Review</h2>' +
      '<p class="tk-desc">Load a clip, step frame by frame, draw notes right on the picture and log timecoded comments. Files play locally — nothing uploads.</p>' +
      '<div class="tk-bar"><input type="file" id="rvFile" accept="video/*" style="display:none">' +
      '<button class="tb-btn gold" onclick="document.getElementById(\'rvFile\').click()">Load clip</button>' +
      '<button class="tb-btn" id="rvPlay">⏯</button>' +
      '<button class="tb-btn" id="rvBack">−1f</button>' +
      '<button class="tb-btn" id="rvFwd">+1f</button>' +
      '<span class="ps-hint" id="rvTc">00:00:00,000</span>' +
      '<button class="tb-btn" id="rvClear">Clear drawing</button>' +
      '<button class="tb-btn" id="rvNote">+ Note at timecode</button></div>' +
      '<div class="tk-cols"><div class="tk-canvaswrap" style="max-width:640px">' +
      '<video id="rvVid" playsinline muted></video><canvas id="rvDraw" class="tk-overlay"></canvas></div>' +
      '<div id="rvNotes"></div></div>';
    var vid = C.$('rvVid'), cv = C.$('rvDraw'), ctx = cv.getContext('2d');
    var FR = 1 / 24;
    C.$('rvFile').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      vid.src = URL.createObjectURL(f);
      vid.onloadedmetadata = function () {
        cv.width = vid.videoWidth || 1280;
        cv.height = vid.videoHeight || 720;
      };
    };
    C.$('rvPlay').onclick = function () { vid.paused ? vid.play() : vid.pause(); };
    C.$('rvBack').onclick = function () { vid.pause(); vid.currentTime = Math.max(0, vid.currentTime - FR); };
    C.$('rvFwd').onclick = function () { vid.pause(); vid.currentTime += FR; };
    C.$('rvClear').onclick = function () { ctx.clearRect(0, 0, cv.width, cv.height); };
    function tcNow() { return root.TScript.msToTc(vid.currentTime * 1000); }
    (function tick() { C.$('rvTc').textContent = tcNow(); requestAnimationFrame(tick); })();
    var drawing = false, px = 0, py = 0;
    function pos(e) {
      var r = cv.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return [(t.clientX - r.left) * cv.width / r.width, (t.clientY - r.top) * cv.height / r.height];
    }
    function down(e) { drawing = true; var p = pos(e); px = p[0]; py = p[1]; e.preventDefault(); }
    function move(e) {
      if (!drawing) return;
      var p = pos(e);
      ctx.strokeStyle = '#d4a843'; ctx.lineWidth = Math.max(2, cv.width / 320); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(p[0], p[1]); ctx.stroke();
      px = p[0]; py = p[1]; e.preventDefault();
    }
    cv.addEventListener('mousedown', down); cv.addEventListener('mousemove', move);
    cv.addEventListener('touchstart', down); cv.addEventListener('touchmove', move);
    root.addEventListener('mouseup', function () { drawing = false; });
    root.addEventListener('touchend', function () { drawing = false; });

    var notes = new C.Register({
      key: 'SB_ReviewNotes_v1',
      fields: [
        { id: 'clip', label: 'Clip' },
        { id: 'tc', label: 'TC', width: '120px' },
        { id: 'note', label: 'Note' },
        { id: 'status', label: 'Status', type: 'select', options: ['Open', 'Addressed', 'Won\'t fix'] }
      ],
      summary: function (rows) {
        var open = rows.filter(function (r) { return r.status === 'Open'; }).length;
        return '<b>' + escAttr(open) + '</b> open note' + (open === 1 ? '' : 's') + ' of ' + rows.length;
      }
    });
    notes.render('rvNotes');
    C.$('rvNote').onclick = function () {
      var f = C.$('rvFile').files[0];
      notes.add({ clip: f ? f.name : '—', tc: tcNow(), note: '', status: 'Open' });
      notes.render('rvNotes');
    };
  };

  /* ── Lens & coverage ─────────────────────────────────────────── */
  root.TTabs.lens = function () {
    var el = C.$('pane-lens');
    var opts = Object.keys(MD.SENSORS).map(function (k) {
      return '<option value="' + escAttr(k) + '">' + esc(MD.SENSORS[k].label) + '</option>';
    }).join('');
    el.innerHTML = '<h2>Lens & Coverage</h2>' +
      '<p class="tk-desc">Sensor + focal length → field of view and how wide the frame is at your subject. The top-down diagram shows the frustum, for blocking conversations that start with “what do we see?”</p>' +
      '<div class="tk-grid" style="max-width:640px">' +
      '<div class="tk-field"><label>Sensor</label><select id="lnSensor">' + opts + '</select></div>' +
      '<div class="tk-field"><label>Focal length (mm)</label><input id="lnFocal" type="number" value="35"></div>' +
      '<div class="tk-field"><label>Subject distance (m)</label><input id="lnDist" type="number" value="3"></div></div>' +
      '<div id="lnOut"></div>' +
      '<div class="tk-canvaswrap" style="max-width:640px;background:var(--surface)"><canvas id="lnCv" width="640" height="300"></canvas></div>';
    function draw() {
      var r = MD.lensCalc(C.$('lnSensor').value, num(C.$('lnFocal').value) || 35, num(C.$('lnDist').value) || 3);
      C.$('lnOut').innerHTML = '<div class="tk-result">HFOV <span class="big">' + escAttr(r.hfov) + '°</span> · VFOV <b>' + escAttr(r.vfov) + '°</b> · full-frame equiv <b>' + escAttr(r.ffEquiv) + 'mm</b>' +
        (r.widthAt ? '<br>Frame at subject: <b>' + escAttr(r.widthAt) + 'm wide × ' + escAttr(r.heightAt) + 'm tall</b>' : '') + '</div>';
      var cv = C.$('lnCv'), x = cv.getContext('2d');
      x.clearRect(0, 0, 640, 300);
      x.fillStyle = 'rgba(212,168,67,.10)';
      var half = r.hfov / 2 * Math.PI / 180;
      var camX = 40, camY = 150, len = 560;
      var dy = Math.tan(half) * len;
      x.beginPath(); x.moveTo(camX, camY); x.lineTo(camX + len, camY - dy); x.lineTo(camX + len, camY + dy); x.closePath(); x.fill();
      x.strokeStyle = '#d4a843'; x.stroke();
      x.fillStyle = '#8e8e9e'; x.font = '11px monospace';
      x.fillText('camera', camX - 10, camY + 28);
      var d = num(C.$('lnDist').value) || 3;
      var px = camX + Math.min(len, d / (d + 2) * len * 1.6);
      x.strokeStyle = '#60a5fa';
      x.beginPath(); x.moveTo(px, camY - Math.tan(half) * (px - camX)); x.lineTo(px, camY + Math.tan(half) * (px - camX)); x.stroke();
      x.fillText(d + 'm → ' + (r.widthAt || '?') + 'm wide', px - 40, camY + Math.tan(half) * (px - camX) + 16);
      x.fillStyle = '#e8e8ec';
      x.beginPath(); x.arc(camX, camY, 5, 0, 7); x.fill();
    }
    ['lnSensor', 'lnFocal', 'lnDist'].forEach(function (id) { C.$(id).addEventListener('input', draw); });
    draw();
  };

  /* ── Look / LUTs ─────────────────────────────────────────────── */
  root.TTabs.look = function () {
    var el = C.$('pane-look');
    el.innerHTML = '<h2>Look Development — LUT Preview</h2>' +
      '<p class="tk-desc">Load a still (or grab a frame in Dailies Review), load any .cube LUT, and preview the look with an intensity blend — all in this browser.</p>' +
      '<div class="tk-bar"><input type="file" id="lkImg" accept="image/*" style="display:none">' +
      '<button class="tb-btn gold" onclick="document.getElementById(\'lkImg\').click()">Load still</button>' +
      '<input type="file" id="lkCube" accept=".cube" style="display:none">' +
      '<button class="tb-btn" onclick="document.getElementById(\'lkCube\').click()">Load .cube LUT</button>' +
      '<label class="ps-inline">Mix <input type="range" id="lkMix" min="0" max="100" value="100" style="width:120px"></label>' +
      '<span class="ps-hint" id="lkInfo"></span>' +
      '<button class="tb-btn" id="lkExport">Export PNG</button></div>' +
      '<div class="tk-cols"><div class="tk-canvaswrap"><canvas id="lkBefore"></canvas><div class="lbl" style="padding:4px 8px;font-size:10px;color:var(--dim)">ORIGINAL</div></div>' +
      '<div class="tk-canvaswrap"><canvas id="lkAfter"></canvas><div class="lbl" style="padding:4px 8px;font-size:10px;color:var(--dim)">GRADED</div></div></div>';
    var img = null, lut = null;
    function render() {
      if (!img) return;
      var W = Math.min(640, img.width), H = Math.round(img.height * W / img.width);
      [['lkBefore', false], ['lkAfter', true]].forEach(function (p) {
        var cv = C.$(p[0]);
        cv.width = W; cv.height = H;
        var x = cv.getContext('2d');
        x.drawImage(img, 0, 0, W, H);
        if (p[1] && lut) {
          var id = x.getImageData(0, 0, W, H);
          var orig = new Uint8ClampedArray(id.data);
          MD.applyLutToPixels(lut, id.data);
          var mix = num(C.$('lkMix').value) / 100;
          if (mix < 1) for (var i = 0; i < id.data.length; i++) id.data[i] = Math.round(orig[i] * (1 - mix) + id.data[i] * mix);
          x.putImageData(id, 0, 0);
        }
      });
    }
    C.$('lkImg').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      img = new Image();
      img.onload = render;
      img.src = URL.createObjectURL(f);
    };
    C.$('lkCube').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          lut = MD.parseCube(r.result);
          C.$('lkInfo').textContent = (lut.title || f.name) + ' · ' + lut.size + '³';
          render();
        } catch (e) { C.toast(e.message); }
      };
      r.readAsText(f);
    };
    C.$('lkMix').addEventListener('input', render);
    C.$('lkExport').onclick = function () {
      var a = document.createElement('a');
      a.href = C.$('lkAfter').toDataURL('image/png');
      a.download = 'graded.png';
      a.click();
    };
  };

  /* ── Credit roll ─────────────────────────────────────────────── */
  root.TTabs.credits = function () {
    var el = C.$('pane-credits');
    var saved = C.load('SB_Credits_v1', null);
    el.innerHTML = '<h2>Credit Roll</h2>' +
      '<p class="tk-desc">Credits build themselves from your project title, script characters and Crew directory — edit the text, preview the scroll, and export a WebM video ready to drop at the end of your cut.</p>' +
      '<div class="tk-bar"><button class="tb-btn" id="crSeed">⚡ Rebuild from project</button>' +
      '<label class="ps-inline">Scroll <select id="crSpeed" class="uc-sel"><option value="40">Slow</option><option value="60" selected>Standard</option><option value="90">Fast</option></select></label>' +
      '<button class="tb-btn gold" id="crPlay">▶ Preview</button>' +
      '<button class="tb-btn" id="crExport">⬇ Export WebM</button><span class="ps-hint" id="crStatus"></span></div>' +
      '<div class="tk-cols"><div class="tk-field" style="flex:1"><label>Credits text (blank line = spacing · lines with “ — ” become role/name pairs)</label>' +
      '<textarea id="crText" style="min-height:300px;font-family:var(--mono);font-size:12px"></textarea></div>' +
      '<div class="tk-canvaswrap" style="max-width:420px"><canvas id="crCv" width="720" height="405"></canvas></div></div>';
    function seed() {
      var st = C.load('SB_Timeline_v1', {}) || {};
      var crew = C.load('SB_Crew_v1', []);
      var lines = [(st.projectName || 'UNTITLED').toUpperCase(), '', ''];
      var cast = Object.keys(st.characters || {});
      if (cast.length) { lines.push('CAST', ''); cast.forEach(function (c) { lines.push(c + ' — ' + c); }); lines.push('', ''); }
      if (crew.length) {
        lines.push('CREW', '');
        crew.forEach(function (c) { if (c.name) lines.push((c.role || 'Crew') + ' — ' + c.name); });
        lines.push('', '');
      }
      lines.push('', 'Made with CINAMATE', 'cinamate-studio.netlify.app');
      C.$('crText').value = lines.join('\n');
      C.save('SB_Credits_v1', C.$('crText').value);
    }
    if (saved) C.$('crText').value = saved; else seed();
    C.$('crSeed').onclick = seed;
    C.$('crText').addEventListener('change', function () { C.save('SB_Credits_v1', this.value); });

    var cv = C.$('crCv'), x = cv.getContext('2d');
    var anim = null;
    function frame(offset) {
      x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height);
      var lines = C.$('crText').value.split('\n');
      var y = cv.height - offset;
      lines.forEach(function (ln) {
        if (y > -40 && y < cv.height + 40 && ln.trim()) {
          var parts = ln.split(' — ');
          if (parts.length === 2) {
            x.font = '16px Georgia'; x.textAlign = 'right'; x.fillStyle = '#8BA3B8';
            x.fillText(parts[0], cv.width / 2 - 14, y);
            x.textAlign = 'left'; x.fillStyle = '#E8EEF2';
            x.fillText(parts[1], cv.width / 2 + 14, y);
          } else {
            x.font = (ln === ln.toUpperCase() && ln.length > 2 ? '700 ' : '') + '18px Georgia';
            x.textAlign = 'center'; x.fillStyle = '#E8EEF2';
            x.fillText(ln, cv.width / 2, y);
          }
        }
        y += 30;
      });
      return y; // bottom of content
    }
    function totalHeight() { return C.$('crText').value.split('\n').length * 30 + cv.height; }
    function play(onDone, recording) {
      cancelAnimationFrame(anim);
      var speed = num(C.$('crSpeed').value);
      var start = performance.now();
      (function loop(t) {
        var off = (t - start) / 1000 * speed;
        frame(off);
        if (off < totalHeight()) anim = requestAnimationFrame(loop);
        else if (onDone) onDone();
      })(start);
    }
    C.$('crPlay').onclick = function () { play(); };
    C.$('crExport').onclick = function () {
      if (!root.MediaRecorder || !cv.captureStream) return C.toast('This browser cannot record canvas — use Chrome');
      var stream = cv.captureStream(30);
      var rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      var chunks = [];
      rec.ondataavailable = function (e) { chunks.push(e.data); };
      rec.onstop = function () {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
        a.download = 'credits.webm';
        a.click();
        C.$('crStatus').textContent = '';
        C.toast('Credit roll exported');
      };
      C.$('crStatus').textContent = 'Recording…';
      rec.start();
      play(function () { rec.stop(); }, true);
    };
    frame(0);
  };

  /* ── Moodboard ───────────────────────────────────────────────── */
  root.TTabs.moodboard = function () {
    var el = C.$('pane-moodboard');
    var KEY = 'SB_Moodboard_v1';
    el.innerHTML = '<h2>Moodboard</h2>' +
      '<p class="tk-desc">Drop reference images and notes on the board, drag them around, scroll to resize. Saved in this browser; export the whole board as a PNG for the lookbook.</p>' +
      '<div class="tk-bar"><input type="file" id="mbImg" accept="image/*" multiple style="display:none">' +
      '<button class="tb-btn gold" onclick="document.getElementById(\'mbImg\').click()">+ Images</button>' +
      '<button class="tb-btn" id="mbNote">+ Note</button>' +
      '<button class="tb-btn" id="mbExport">Export PNG</button>' +
      '<button class="tb-btn" id="mbClearSel">Delete selected</button></div>' +
      '<div class="tk-board" id="mbBoard"></div>';
    var items = C.load(KEY, []);
    var board = C.$('mbBoard'), selId = null;
    function persist() { C.save(KEY, items); }
    function render() {
      board.innerHTML = '';
      items.forEach(function (it) {
        var d = document.createElement('div');
        d.className = 'tk-boarditem' + (it.kind === 'note' ? ' note' : '') + (it.id === selId ? ' sel' : '');
        d.style.left = it.x + 'px'; d.style.top = it.y + 'px';
        if (it.kind === 'note') {
          d.textContent = it.text || 'Double-click to edit';
          d.ondblclick = function () {
            var t = prompt('Note', it.text || '');
            if (t != null) { it.text = t; persist(); render(); }
          };
        } else {
          var im = document.createElement('img');
          im.src = it.src; im.style.width = (it.w || 180) + 'px';
          d.appendChild(im);
        }
        d.onmousedown = function (e) {
          selId = it.id; render();
          var sx = e.clientX - it.x, sy = e.clientY - it.y;
          function mv(ev) { it.x = ev.clientX - sx; it.y = ev.clientY - sy; d.style.left = it.x + 'px'; d.style.top = it.y + 'px'; }
          function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); persist(); }
          document.addEventListener('mousemove', mv);
          document.addEventListener('mouseup', up);
          e.preventDefault();
        };
        d.onwheel = function (e) {
          if (it.kind === 'note') return;
          it.w = Math.max(60, Math.min(560, (it.w || 180) - e.deltaY * 0.3));
          persist(); render(); e.preventDefault();
        };
        board.appendChild(d);
      });
    }
    C.$('mbImg').onchange = function () {
      Array.prototype.forEach.call(this.files, function (f, i) {
        var r = new FileReader();
        r.onload = function () {
          // downscale to keep localStorage sane
          var im = new Image();
          im.onload = function () {
            var W = Math.min(480, im.width);
            var c = document.createElement('canvas');
            c.width = W; c.height = Math.round(im.height * W / im.width);
            c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            items.push({ id: C.uid(), kind: 'img', src: c.toDataURL('image/jpeg', 0.82), x: 30 + i * 40, y: 30 + i * 30, w: 200 });
            persist(); render();
          };
          im.src = r.result;
        };
        r.readAsDataURL(f);
      });
    };
    C.$('mbNote').onclick = function () {
      items.push({ id: C.uid(), kind: 'note', text: 'New note', x: 60, y: 60 });
      persist(); render();
    };
    C.$('mbClearSel').onclick = function () {
      items = items.filter(function (i) { return i.id !== selId; });
      selId = null; persist(); render();
    };
    C.$('mbExport').onclick = function () {
      var cv = document.createElement('canvas');
      cv.width = board.clientWidth * 2; cv.height = board.clientHeight * 2;
      var x = cv.getContext('2d');
      x.scale(2, 2);
      x.fillStyle = '#0c0c12'; x.fillRect(0, 0, board.clientWidth, board.clientHeight);
      var loads = items.map(function (it) {
        return new Promise(function (res) {
          if (it.kind === 'note') {
            x.fillStyle = '#C9A86C';
            x.fillRect(it.x, it.y, 180, 60);
            x.fillStyle = '#1a1408'; x.font = '12px sans-serif';
            String(it.text || '').split('\n').forEach(function (ln, i) { x.fillText(ln.slice(0, 28), it.x + 8, it.y + 18 + i * 15); });
            return res();
          }
          var im = new Image();
          im.onload = function () { x.drawImage(im, it.x, it.y, it.w || 180, (it.w || 180) * im.height / im.width); res(); };
          im.src = it.src;
        });
      });
      Promise.all(loads).then(function () {
        var a = document.createElement('a');
        a.href = cv.toDataURL('image/png');
        a.download = 'moodboard.png';
        a.click();
      });
    };
    render();
  };
})(typeof window !== 'undefined' ? window : globalThis);
