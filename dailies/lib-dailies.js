/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Dailies Logger engine (CDailies)
   Pure logic, no DOM: on-set take logging math — auto slate/take suggestion,
   circled-take rates, script coverage gaps, the planned-vs-shot coverage join,
   classic per-day camera & sound report text exports, and the editor's pull
   list of circled takes.
   All state is passed in; nothing here touches storage or the page.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-dailies.js requires js/lib-scenes.js to be loaded first');

  /* The shoot day (js/lib-shootdays.js) is the join key between this page, the
     stripboard and the day planner, and it also owns the ONE translation of
     the other take store's circle. It is resolved at call time rather than
     captured at load: the pages that need it load it first, and the two suites
     that only ask this file to split a screenplay must not be made to carry
     it. Every entry point that genuinely needs it says so and throws. */
  function SD() { return root.CShootDays || null; }
  function needSD(what) {
    var sd = SD();
    if (!sd) throw new Error('lib-dailies ' + what + ' requires js/lib-shootdays.js to be loaded first');
    return sd;
  }

  function num(v) { var n = parseInt(v, 10); return isFinite(n) ? n : 0; }
  function str(v) { return String(v == null ? '' : v).trim(); }

  /* ── 1 · screenplay scenes (the one scene model) ─────────────────────────
     sceneList used to renumber the scenes 1..n by position, which is how a
     take slated "24" could not be matched to the scene the script calls 24.
     CScenes.sceneList carries the printed number through instead.          */
  var splitScenes = CS.split;
  var sceneList = CS.sceneList;

  /* ── 2 · slate arithmetic ────────────────────────────────────────────────
     Slates follow the classic scheme: scene number + setup letter
     (12A, 12B … 12Z, 12AA). Letters are bijective base-26.                 */
  function lettersToNum(s) {
    var n = 0, up = str(s).toUpperCase();
    for (var i = 0; i < up.length; i++) {
      var c = up.charCodeAt(i);
      if (c < 65 || c > 90) return 0;
      n = n * 26 + (c - 64);
    }
    return n;
  }
  function numToLetters(n) {
    var s = '';
    n = Math.floor(n);
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseSlate(slate) {
    var m = /^\s*(\d+)?\s*([A-Za-z]+)?\s*$/.exec(str(slate));
    if (!m) return { scene: 0, letters: '', ord: 0 };
    return { scene: num(m[1]), letters: str(m[2]).toUpperCase(), ord: lettersToNum(m[2] || '') };
  }
  /* nextSlate(takes, scene): what the 2nd AC would chalk next.
     Same scene as an existing take → same slate, take + 1.
     A scene with no takes yet → slate '<scene>A', take 1.                  */
  function nextSlate(takes, scene) {
    var sc = str(scene);
    var same = (takes || []).filter(function (t) { return str(t.scene) === sc; });
    if (same.length) {
      var last = same[same.length - 1];
      return { slate: str(last.slate) || (sc + 'A'), take: num(last.take) + 1, fresh: false };
    }
    return { slate: sc + 'A', take: 1, fresh: true };
  }
  /* nextSetup(takes, scene): new camera setup on the same scene → next
     unused letter for that scene (12A used → 12B; 12Z used → 12AA).        */
  function nextSetup(takes, scene) {
    var sc = str(scene), max = 0;
    (takes || []).forEach(function (t) {
      if (str(t.scene) !== sc) return;
      var p = parseSlate(t.slate);
      if (p.ord > max) max = p.ord;
    });
    return { slate: sc + numToLetters(max + 1), take: 1, fresh: max === 0 };
  }

  /* ── 3 · take normalisation ─────────────────────────────────────────── */
  function makeTake(fields, id) {
    var f = fields || {};
    var cam = str(f.camera).toUpperCase();
    return {
      id: str(id || f.id) || 't' + Math.random().toString(36).slice(2, 9),
      day: str(f.day), scene: str(f.scene),
      slate: str(f.slate).toUpperCase(), take: Math.max(1, num(f.take) || 1),
      camera: cam === 'B' ? 'B' : 'A',
      circled: !!f.circled, ngReason: str(f.ngReason), notes: str(f.notes),
      soundRoll: str(f.soundRoll), lens: str(f.lens), tcIn: str(f.tcIn)
    };
  }
  function sortTakes(takes) {
    return (takes || []).slice().sort(function (a, b) {
      if (str(a.day) !== str(b.day)) return str(a.day) < str(b.day) ? -1 : 1;
      var pa = parseSlate(a.slate), pb = parseSlate(b.slate);
      if (pa.scene !== pb.scene) return pa.scene - pb.scene;
      if (pa.ord !== pb.ord) return pa.ord - pb.ord;
      return num(a.take) - num(b.take);
    });
  }

  /* ── 4 · circle rate ──────────────────────────────────────────────────
     circled / total, overall and per shoot day.                            */
  function circleRate(takes) {
    var all = takes || [];
    var byDay = {}, order = [];
    all.forEach(function (t) {
      var d = str(t.day) || '(no day)';
      if (!byDay[d]) { byDay[d] = { day: d, total: 0, circled: 0, pct: 0 }; order.push(d); }
      byDay[d].total++;
      if (t.circled) byDay[d].circled++;
    });
    order.sort();
    var days = order.map(function (d) {
      var r = byDay[d];
      r.pct = r.total ? Math.round(100 * r.circled / r.total) : 0;
      return r;
    });
    var total = all.length, circled = all.filter(function (t) { return t.circled; }).length;
    return { overall: { total: total, circled: circled, pct: total ? Math.round(100 * circled / total) : 0 },
             byDay: days };
  }

  /* ── 5 · coverage: which script scenes have zero takes ─────────────── */
  function coverageByScene(takes, scriptText) {
    var scenes = sceneList(scriptText);
    var counts = {}, circles = {};
    (takes || []).forEach(function (t) {
      var n = num(t.scene) || parseSlate(t.slate).scene;
      if (!n) return;
      counts[n] = (counts[n] || 0) + 1;
      if (t.circled) circles[n] = (circles[n] || 0) + 1;
    });
    var rows = scenes.map(function (s) {
      return { n: s.n, slug: s.slug, takes: counts[s.n] || 0,
               circled: circles[s.n] || 0, covered: (counts[s.n] || 0) > 0 };
    });
    return { scenes: rows,
             gaps: rows.filter(function (r) { return !r.covered; }),
             covered: rows.filter(function (r) { return r.covered; }).length,
             total: rows.length };
  }

  /* ── 6 · classic per-day report exports ─────────────────────────────── */
  function pad(s, w) {
    s = str(s);
    while (s.length < w) s += ' ';
    return s.length > w ? s.slice(0, w - 1) + '…' : s;
  }
  function dayTakes(takes, day) {
    return sortTakes((takes || []).filter(function (t) { return str(t.day) === str(day); }));
  }
  function cameraReport(takes, day, opts) {
    var o = opts || {};
    var rows = dayTakes(takes, day);
    var out = ['CAMERA REPORT — ' + (str(day) || 'no day') + (o.unit ? '  ·  ' + o.unit + ' unit' : ''),
               (o.production ? 'Production: ' + o.production : 'Production: (untitled)') +
               '   ·   circled takes marked ●',
               '',
               pad('SCENE', 7) + pad('SLATE', 8) + pad('TK', 4) + pad('CAM', 5) +
               pad('LENS', 9) + pad('TC IN', 13) + 'NOTES',
               '-------------------------------------------------------------'];
    rows.forEach(function (t) {
      out.push(pad(t.scene, 7) + pad(t.slate, 8) + pad(t.take, 4) + pad(t.camera, 5) +
               pad(t.lens || '—', 9) + pad(t.tcIn || '—', 13) +
               (t.circled ? '● ' : '') + str(t.notes) +
               (t.ngReason ? ' [NG: ' + t.ngReason + ']' : ''));
    });
    if (!rows.length) out.push('(no takes logged for this day)');
    var cr = circleRate(rows);
    out.push('');
    out.push('Takes: ' + cr.overall.total + '   Circled: ' + cr.overall.circled +
             ' (' + cr.overall.pct + '%)');
    out.push('Logged on set with CINAMATE Dailies — cross-check against the');
    out.push('camera assistant\'s written report before lab/DIT turnover.');
    return out.join('\n');
  }
  function soundReport(takes, day, opts) {
    var o = opts || {};
    var rows = dayTakes(takes, day);
    var out = ['SOUND REPORT — ' + (str(day) || 'no day') + (o.unit ? '  ·  ' + o.unit + ' unit' : ''),
               (o.production ? 'Production: ' + o.production : 'Production: (untitled)') +
               '   ·   circled takes marked ●',
               '',
               pad('SCENE', 7) + pad('SLATE', 8) + pad('TK', 4) + pad('ROLL', 7) +
               pad('TC IN', 13) + 'NOTES',
               '-------------------------------------------------------------'];
    rows.forEach(function (t) {
      out.push(pad(t.scene, 7) + pad(t.slate, 8) + pad(t.take, 4) +
               pad(t.soundRoll || '—', 7) + pad(t.tcIn || '—', 13) +
               (t.circled ? '● ' : '') + str(t.notes) +
               (t.ngReason ? ' [NG: ' + t.ngReason + ']' : ''));
    });
    if (!rows.length) out.push('(no takes logged for this day)');
    out.push('');
    out.push('Logged on set with CINAMATE Dailies — cross-check against the');
    out.push('sound mixer\'s written report before turnover.');
    return out.join('\n');
  }

  /* ── 7 · editor picks: circled takes grouped by scene ────────────────── */
  function editorPicks(takes) {
    var circled = sortTakes((takes || []).filter(function (t) { return t.circled; }));
    return circled.map(function (t) {
      return { scene: str(t.scene), slate: str(t.slate), take: num(t.take),
               notes: str(t.notes), day: str(t.day), camera: t.camera === 'B' ? 'B' : 'A' };
    });
  }
  function picksText(picks) {
    var out = ['EDITOR PULL LIST — circled takes', ''];
    var lastScene = null;
    (picks || []).forEach(function (p) {
      if (p.scene !== lastScene) { out.push('Scene ' + p.scene); lastScene = p.scene; }
      out.push('  ' + pad(p.slate, 8) + 'take ' + pad(p.take, 4) +
               (p.camera ? p.camera + '-cam  ' : '') + str(p.notes));
    });
    if (!(picks || []).length) out.push('(no circled takes yet)');
    out.push('');
    out.push('Circles are the director\'s on-set preference — the cut is not bound by them.');
    return out.join('\n');
  }

  root.CDailies = {
    splitScenes: splitScenes, sceneList: sceneList,
    lettersToNum: lettersToNum, numToLetters: numToLetters, parseSlate: parseSlate,
    nextSlate: nextSlate, nextSetup: nextSetup,
    makeTake: makeTake, sortTakes: sortTakes,
    circleRate: circleRate, coverageByScene: coverageByScene,
    cameraReport: cameraReport, soundReport: soundReport,
    editorPicks: editorPicks, picksText: picksText
  };
})(typeof window !== 'undefined' ? window : globalThis);
