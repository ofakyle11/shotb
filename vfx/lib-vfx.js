/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — VFX Pipeline engine (CVfx)
   Pure logic, no DOM: scan the screenplay for VFX-likely action, keep a shot
   board (VFX-010, VFX-020 …) through the bid → award → plates → temp →
   final → approved life-cycle, planning estimates by complexity (labelled
   as planning estimates, never quotes), bid-vs-estimate comparison, on-set
   plate checklists scaled by complexity, and the on-set VFX day sheet.
   Award money is committed to the Money Room by the page script, never here.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-vfx.js requires js/lib-scenes.js to be loaded first');


  var STATUSES = ['briefed', 'bid', 'awarded', 'plates', 'temp', 'final', 'approved'];
  var COMPLEXITIES = ['simple', 'medium', 'complex', 'hero'];

  /* ── 1 · planning rates (USD per shot) — planning estimates only ─────── */
  var RATES = {
    simple:  { lo: 500,   hi: 1500,  note: 'paint-outs, sky replacement, simple comps' },
    medium:  { lo: 1500,  hi: 6000,  note: 'wire removal, screen comps, ghost/hologram passes' },
    complex: { lo: 6000,  hi: 20000, note: 'destruction, fire/water sims, crash augmentation' },
    hero:    { lo: 20000, hi: 80000, note: 'full CG creatures, spaceships, signature set-pieces' }
  };
  function internalEst(complexity) {
    var r = RATES[complexity] || RATES.medium;
    return { complexity: RATES[complexity] ? complexity : 'medium',
             lo: r.lo, hi: r.hi, mid: Math.round((r.lo + r.hi) / 2),
             note: r.note, label: 'planning estimate' };
  }

  /* ── 2 · script scan: VFX-likely action cues ─────────────────────────── */
  var CUE_DEFS = [
    ['explosion|explodes?|detonates?|detonation|blast', 'Explosion — pyro augmentation / debris', 'complex'],
    ['creature|monster|beast', 'CG creature work', 'hero'],
    ['dragon', 'CG dragon — full creature animation', 'hero'],
    ['spaceship|starship|space station|ufo|alien craft', 'CG spaceship / space environment', 'hero'],
    ['crash(?:es|ed|ing)?|collision|collides?', 'Crash — CG takeover / debris sim', 'complex'],
    ['collapses?|crumbles?|cave[- ]?in', 'Structural collapse — destruction sim', 'complex'],
    ['transforms?|transformation|morphs?', 'Transformation / morph', 'complex'],
    ['disappears?|vanish(?:es|ed)?', 'Disappearance — paint-out / dissolve', 'medium'],
    ['engulf(?:s|ed)?|inferno|ablaze|bursts? into flames?', 'Fire engulfing — flame sim & comp', 'complex'],
    ['storm|tornado|hurricane|lightning|blizzard', 'Storm — sky & atmosphere FX', 'complex'],
    ['floods?|flooding|tidal wave|tsunami', 'Flood — water simulation', 'complex'],
    ['sky', 'Sky replacement / enhancement', 'simple'],
    ['holograms?|holographic', 'Hologram — monitor/volume comp', 'medium'],
    ['ghost(?:s|ly)?|spectral|apparition|phantom', 'Ghost — spectral comp pass', 'medium'],
    ['flies|flying|soars?|hurled|levitates?|hovers?', 'Wire removal — flying / hurled action', 'medium']
  ];
  var CUES = [];
  CUE_DEFS.forEach(function (d) {
    CUES.push({ re: new RegExp('\\b(?:' + d[0] + ')\\b', 'i'), hint: d[1], complexity: d[2] });
  });

  var splitScenes = CS.split;

  /* detectShots(scriptText) → [{scene, slug, hint, complexity, cue}] — one
     suggestion per cue per scene, ordered by scene then cue severity.      */
  function detectShots(scriptText) {
    var scenes = splitScenes(scriptText);
    var out = [];
    scenes.forEach(function (sc) {
      var body = sc.body.join('\n');
      CUES.forEach(function (c) {
        var m = body.match(c.re);
        if (!m) return;
        out.push({ scene: sc.n, sceneLabel: sc.label, slug: sc.slug, hint: c.hint,
                   complexity: c.complexity, cue: m[0].toLowerCase() });
      });
    });
    return out;
  }

  /* ── 3 · the shot board ──────────────────────────────────────────────── */
  function pad3(n) { var s = String(n); while (s.length < 3) s = '0' + s; return s; }
  function codeNum(code) {
    var m = /^VFX-(\d+)$/.exec(String(code || ''));
    return m ? parseInt(m[1], 10) : 0;
  }
  /* next code: VFX-010, VFX-020 … always 10 past the highest on the board */
  function nextCode(shots) {
    var hi = 0;
    (shots || []).forEach(function (s) { var n = codeNum(s.code); if (n > hi) hi = n; });
    return 'VFX-' + pad3(hi + 10);
  }
  function uid() { return 'v' + Math.random().toString(36).slice(2, 9); }
  function makeShot(shots, fields) {
    var f = fields || {};
    return {
      id: uid(), code: nextCode(shots),
      scene: +f.scene || 0, desc: f.desc || '',
      complexity: COMPLEXITIES.indexOf(f.complexity) >= 0 ? f.complexity : 'medium',
      method: f.method || '', vendor: f.vendor || '',
      bid: +f.bid > 0 ? +f.bid : 0,
      status: STATUSES.indexOf(f.status) >= 0 ? f.status : 'briefed',
      version: /^v\d{3,}$/.test(f.version || '') ? f.version : 'v001',
      committedPo: false
    };
  }
  function statusRank(status) { return STATUSES.indexOf(status); }

  /* bid vs planning estimate for one shot */
  function bidVsEst(shot) {
    var est = internalEst(shot && shot.complexity);
    var bid = shot && +shot.bid > 0 ? +shot.bid : 0;
    if (!bid) return { est: est, bid: 0, status: 'no-bid', delta: 0 };
    if (bid < est.lo) return { est: est, bid: bid, status: 'below', delta: bid - est.lo };
    if (bid > est.hi) return { est: est, bid: bid, status: 'above', delta: bid - est.hi };
    return { est: est, bid: bid, status: 'within', delta: 0 };
  }

  /* board(shots) → per-status counts, totals, awarded money.
     A shot's bid counts as awarded once its status is 'awarded' or later.  */
  function board(shots) {
    var counts = {};
    STATUSES.forEach(function (s) { counts[s] = 0; });
    var totalBid = 0, totalAwarded = 0, estLo = 0, estHi = 0, uncommitted = 0;
    (shots || []).forEach(function (sh) {
      if (counts[sh.status] != null) counts[sh.status]++;
      var e = internalEst(sh.complexity);
      estLo += e.lo; estHi += e.hi;
      if (+sh.bid > 0) totalBid += +sh.bid;
      if (statusRank(sh.status) >= statusRank('awarded') && +sh.bid > 0) {
        totalAwarded += +sh.bid;
        if (!sh.committedPo) uncommitted++;
      }
    });
    return { counts: counts, total: (shots || []).length,
             totalBid: totalBid, totalAwarded: totalAwarded,
             estLo: estLo, estHi: estHi, uncommitted: uncommitted };
  }

  /* ── 4 · plate checklist, scaled by complexity ───────────────────────── */
  function plateChecklist(complexity) {
    var list = [
      'Reference stills of the set from the shooting position',
      'Lens & camera data — focal, T-stop, lens height, tilt, FPS, filtration'
    ];
    var lvl = COMPLEXITIES.indexOf(complexity);
    if (lvl < 0) lvl = 1;
    if (lvl >= 1) list.push(
      'Clean plate — locked-off pass with no actors or rigs in frame',
      'Tracking markers on low-texture surfaces (remove-friendly tape)');
    if (lvl >= 2) list.push(
      'HDRI panorama from the centre of the action',
      'Chrome ball + grey ball pass under the shooting light');
    if (lvl >= 3) list.push(
      'HDRI re-shot on every lighting change',
      'Chrome/grey ball pass every camera setup',
      'Witness cam on the action from a second angle',
      'Set survey — measurements or photo-scan of interacting set pieces');
    return list;
  }

  /* ── 5 · version naming ──────────────────────────────────────────────── */
  function projSlug(project) {
    var s = String(project || '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 14);
    return s || 'PROJECT';
  }
  function versionName(project, shot, status) {
    var st = status || (shot && shot.status) || 'temp';
    return projSlug(project) + '_' + ((shot && shot.code) || 'VFX-000') + '_' +
           String(st).toLowerCase() + '_' + ((shot && shot.version) || 'v001');
  }
  function bumpVersion(v) {
    var m = /^v(\d+)$/.exec(String(v || ''));
    var n = m ? parseInt(m[1], 10) + 1 : 1;
    return 'v' + pad3(n);
  }

  /* ── 6 · on-set VFX day sheet ────────────────────────────────────────── */
  function daySheet(shots, project) {
    var byScene = {};
    (shots || []).forEach(function (sh) {
      var k = String(+sh.scene || 0);
      if (!byScene[k]) byScene[k] = [];
      byScene[k].push(sh);
    });
    var sceneNums = Object.keys(byScene).map(Number).sort(function (a, b) { return a - b; });
    var out = ['VFX ON-SET DAY SHEET — ' + (project || 'Untitled production'),
               'Every VFX shot by scene, with what set must capture for post.', ''];
    if (!sceneNums.length) out.push('(no VFX shots on the board yet)');
    sceneNums.forEach(function (n) {
      out.push('SCENE ' + (n || '—') + ' ' + Array(40).join('─'));
      var maxLvl = 0;
      byScene[n].forEach(function (sh) {
        var lvl = COMPLEXITIES.indexOf(sh.complexity);
        if (lvl > maxLvl) maxLvl = lvl;
        out.push('  ' + sh.code + '  [' + sh.complexity + ' · ' + sh.status + ']  ' +
                 (sh.desc || '(no description)') +
                 (sh.vendor ? '  — ' + sh.vendor : ''));
      });
      out.push('  Plates to capture (' + COMPLEXITIES[maxLvl] + ' level):');
      plateChecklist(COMPLEXITIES[maxLvl]).forEach(function (p) { out.push('    [ ] ' + p); });
      out.push('');
    });
    out.push('Supervisor note: confirm plate needs with each vendor before the shoot day —');
    out.push('vendor pipelines differ, and this sheet is a planning aid, not a vendor spec.');
    return out.join('\n');
  }

  root.CVfx = {
    STATUSES: STATUSES, COMPLEXITIES: COMPLEXITIES, RATES: RATES,
    splitScenes: splitScenes, detectShots: detectShots,
    nextCode: nextCode, makeShot: makeShot, statusRank: statusRank,
    internalEst: internalEst, bidVsEst: bidVsEst,
    plateChecklist: plateChecklist, board: board,
    versionName: versionName, bumpVersion: bumpVersion, daySheet: daySheet
  };
})(typeof window !== 'undefined' ? window : globalThis);
