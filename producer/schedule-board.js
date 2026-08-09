/* SHOTBREAK Producer Suite — Stripboard Scheduler + Day-Out-of-Days (our own
 * web take on the classic AD stripboard workflow CineSched implements on
 * macOS; written from scratch).
 *
 * Scenes come from the parsed screenplay, sized in eighths of a page, color
 * coded day/night. Drag strips between the Boneyard and shoot days (or
 * auto-schedule at a target pages/day pace). The DOOD report maps every cast
 * member across shoot days with the standard SW / W / H / WF / SWF codes. */
(function (root) {
  'use strict';

  var KEY = 'SB_ScheduleBoard_v1';

  function formatEighths(e) {
    e = Math.max(0, Math.round(e));
    var whole = Math.floor(e / 8), rem = e % 8;
    if (!whole && !rem) return '0';
    if (!whole) return rem + '/8';
    if (!rem) return String(whole);
    return whole + ' ' + rem + '/8';
  }

  /* Build scene strips from the timeline's saved script. */
  function scenesFromScript(st) {
    var chunks = SBBudget.splitScenes(st.scriptText || '');
    if (chunks.length < 2 && (st.clips || []).length) {
      // No sluglines — fall back to one strip per unique clip heading
      var seen = {}, out = [];
      (st.clips || []).forEach(function (c) {
        var h = String(c.heading || '').trim() || 'Scene';
        if (seen[h]) { seen[h].eighths += 1; return; }
        seen[h] = { heading: h, eighths: 1, text: c.description || '' };
        out.push(seen[h]);
      });
      chunks = out;
    }
    var analysis = SBBudget.analyze(st);
    var castByScene = {};
    Object.keys(analysis.sceneCast || {}).forEach(function (name) {
      analysis.sceneCast[name].forEach(function (i) {
        (castByScene[i] = castByScene[i] || []).push(name);
      });
    });
    return chunks.map(function (sc, i) {
      return {
        id: 'sc' + (i + 1),
        num: i + 1,
        heading: sc.heading || ('Scene ' + (i + 1)),
        eighths: sc.eighths || 1,
        dn: /\b(NIGHT|DUSK|EVENING|MIDNIGHT|PRE-DAWN)\b/i.test(sc.heading || '') ? 'night' : 'day',
        cast: castByScene[i] || [],
        day: -1
      };
    });
  }

  /* Fill days in script order at the target eighths/day pace. */
  function autoScheduleModel(scenes, pagesPerDay) {
    var perDay = Math.max(1, (pagesPerDay || 4.5) * 8);
    var day = 0, used = 0;
    scenes.forEach(function (sc) {
      if (used > 0 && used + sc.eighths > perDay) { day++; used = 0; }
      sc.day = day;
      used += sc.eighths;
    });
    return scenes;
  }

  /* DOOD matrix: rows per cast member, one column per shoot day, standard
   * codes — SW start, W work, H hold (idle day inside the span), WF finish,
   * SWF single-day role. */
  function doodMatrix(scenes) {
    var byActor = {};
    var maxDay = -1;
    scenes.forEach(function (sc) {
      if (sc.day < 0) return;
      if (sc.day > maxDay) maxDay = sc.day;
      (sc.cast || []).forEach(function (name) {
        (byActor[name] = byActor[name] || new Set()).add(sc.day);
      });
    });
    var days = maxDay + 1;
    var rows = Object.keys(byActor).map(function (name) {
      var workSet = byActor[name];
      var first = Infinity, last = -Infinity;
      workSet.forEach(function (d) { if (d < first) first = d; if (d > last) last = d; });
      var codes = [];
      for (var d = 0; d < days; d++) {
        if (d < first || d > last) codes.push('');
        else if (workSet.has(d)) {
          if (first === last) codes.push('SWF');
          else if (d === first) codes.push('SW');
          else if (d === last) codes.push('WF');
          else codes.push('W');
        } else codes.push('H');
      }
      var work = workSet.size;
      var hold = Math.max(0, (last - first + 1) - work);
      return { name: name, codes: codes, tot: last - first + 1, wrk: work, hld: hold };
    });
    rows.sort(function (a, b) { return b.wrk - a.wrk || a.name.localeCompare(b.name); });
    return { days: days, rows: rows };
  }

  /* ── persistence ─────────────────────────────────────────────────── */
  var board = null;
  function load() {
    try { var d = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null'); if (d && Array.isArray(d.scenes)) return d; } catch (e) {}
    return { pace: 4.5, scenes: [] };
  }
  function persist() {
    try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(board)); } catch (e) {}
  }

  /* ── rendering ───────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function stripHtml(sc) {
    return '<div class="ps-strip ' + sc.dn + '" draggable="true" data-id="' + sc.id + '" title="' + esc(sc.cast.join(', ')) + '">' +
      '<b>' + sc.num + '</b> · ' + esc(sc.heading.length > 46 ? sc.heading.slice(0, 45) + '…' : sc.heading) +
      '<div class="ps-strip-meta">' + formatEighths(sc.eighths) + ' pg' + (sc.cast.length ? ' · ' + esc(sc.cast.slice(0, 3).join(', ')) + (sc.cast.length > 3 ? ' +' + (sc.cast.length - 3) : '') : '') + '</div></div>';
  }

  function render() {
    var bone = $('sbBoneyard'), daysEl = $('sbDays');
    if (!bone || !daysEl) return;
    var unsched = board.scenes.filter(function (s) { return s.day < 0; });
    bone.innerHTML = unsched.map(stripHtml).join('') || '<div class="ps-empty">All scenes scheduled</div>';
    var boneMeta = $('sbBoneMeta');
    if (boneMeta) boneMeta.textContent = unsched.length ? unsched.length + ' scenes · ' + formatEighths(unsched.reduce(function (a, s) { return a + s.eighths; }, 0)) + ' pg' : '';

    var maxDay = board.scenes.reduce(function (m, s) { return Math.max(m, s.day); }, -1);
    var dayCount = Math.max(maxDay + 2, 1); // always one empty trailing day to drop into
    var targetEighths = board.pace * 8;
    var h = '';
    for (var d = 0; d < dayCount; d++) {
      var scs = board.scenes.filter(function (s) { return s.day === d; });
      var e = scs.reduce(function (a, s) { return a + s.eighths; }, 0);
      h += '<div class="ps-day"><div class="ps-day-head"><span>Day ' + (d + 1) + '</span>' +
        '<span class="ps-day-meta' + (e > targetEighths ? ' over' : '') + '">' + formatEighths(e) + ' / ' + formatEighths(targetEighths) + ' pg</span></div>' +
        '<div class="ps-strips" data-day="' + d + '">' + scs.map(stripHtml).join('') + '</div></div>';
    }
    daysEl.innerHTML = h;
    wireDnD();
    renderDood(false);
  }

  function wireDnD() {
    document.querySelectorAll('#pane-schedule .ps-strip').forEach(function (el) {
      el.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData('text/plain', el.dataset.id);
        ev.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); });
    });
    document.querySelectorAll('#pane-schedule .ps-strips').forEach(function (zone) {
      zone.addEventListener('dragover', function (ev) { ev.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('dragover'); });
      zone.addEventListener('drop', function (ev) {
        ev.preventDefault();
        zone.classList.remove('dragover');
        var id = ev.dataTransfer.getData('text/plain');
        var sc = board.scenes.find(function (s) { return s.id === id; });
        if (!sc) return;
        sc.day = parseInt(zone.dataset.day, 10);
        persist();
        render();
      });
    });
  }

  function renderDood(show) {
    var wrap = $('sbDoodWrap');
    if (!wrap) return;
    if (show === false && wrap.classList.contains('hidden')) return;
    var m = doodMatrix(board.scenes);
    if (!m.rows.length || m.days < 1) {
      wrap.innerHTML = '<div class="ps-empty">Schedule scenes with cast to generate the Day-out-of-Days.</div>';
      if (show) wrap.classList.remove('hidden');
      return;
    }
    var h = '<h3>Day-out-of-Days</h3><div style="overflow-x:auto"><table class="dood-table"><thead><tr><th>Cast</th>';
    for (var d = 0; d < m.days; d++) h += '<th>D' + (d + 1) + '</th>';
    h += '<th>TOT</th><th>WRK</th><th>HLD</th></tr></thead><tbody>';
    m.rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + '</td>';
      r.codes.forEach(function (c) {
        var cls = c === 'SW' || c === 'SWF' ? 'sw' : c === 'WF' ? 'wf' : c === 'H' ? 'h' : '';
        h += '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + c + '</td>';
      });
      h += '<td>' + r.tot + '</td><td>' + r.wrk + '</td><td>' + r.hld + '</td></tr>';
    });
    h += '</tbody></table></div><div class="dood-legend">SW = Start Work · W = Work · H = Hold · WF = Work Finish · SWF = Start/Work/Finish · TOT span · WRK worked · HLD holds</div>';
    wrap.innerHTML = h;
    if (show) wrap.classList.remove('hidden');
  }

  /* ── toolbar ─────────────────────────────────────────────────────── */
  function wireToolbar() {
    var seed = $('sbSeed');
    if (seed) seed.addEventListener('click', function () {
      var st = root.psProjectState ? root.psProjectState() : {};
      if (!st.scriptText && !(st.clips || []).length) return root.psToast && psToast('No script in the timeline yet — import one first');
      var scenes = scenesFromScript(st);
      if (!scenes.length) return root.psToast && psToast('No scenes found — check the script parses on the timeline page');
      board.scenes = scenes;
      persist(); render();
      if (root.psToast) psToast(scenes.length + ' scene strips built (' + formatEighths(scenes.reduce(function (a, s) { return a + s.eighths; }, 0)) + ' pages)');
    });
    var auto = $('sbAuto');
    if (auto) auto.addEventListener('click', function () {
      if (!board.scenes.length) return root.psToast && psToast('Seed scenes from the script first');
      autoScheduleModel(board.scenes, board.pace);
      persist(); render();
      var days = board.scenes.reduce(function (m, s) { return Math.max(m, s.day); }, -1) + 1;
      if (root.psToast) psToast('Scheduled across ' + days + ' shoot days at ' + board.pace + ' pages/day');
    });
    var pace = $('sbPace');
    if (pace) {
      pace.value = board.pace;
      pace.addEventListener('change', function () {
        board.pace = Math.max(1, Math.min(12, parseFloat(pace.value) || 4.5));
        persist(); render();
      });
    }
    var clear = $('sbClear');
    if (clear) clear.addEventListener('click', function () {
      board.scenes.forEach(function (s) { s.day = -1; });
      persist(); render();
    });
    var dood = $('sbDood');
    if (dood) dood.addEventListener('click', function () {
      var wrap = $('sbDoodWrap');
      if (wrap.classList.contains('hidden')) renderDood(true);
      else wrap.classList.add('hidden');
    });
    var print = $('sbPrint');
    if (print) print.addEventListener('click', function () { renderDood(true); window.print(); });
  }

  function init() {
    if (!$('sbDays')) return;
    board = load();
    render();
    wireToolbar();
  }

  root.SBScheduleBoard = {
    init: init,
    // exposed for tests
    scenesFromScript: scenesFromScript,
    autoScheduleModel: autoScheduleModel,
    doodMatrix: doodMatrix,
    formatEighths: formatEighths
  };
})(typeof window !== 'undefined' ? window : globalThis);
