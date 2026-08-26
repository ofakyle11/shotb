/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — VFX Pipeline engine (CVfx)
   Pure logic, no DOM: scan the screenplay for VFX-likely action, keep a shot
   board (VFX-010, VFX-020 …) through the bid → award → plates → temp →
   final → approved life-cycle, planning estimates by complexity (labelled
   as planning estimates, never quotes), bid-vs-estimate comparison, on-set
   plate checklists scaled by complexity, and the on-set VFX day sheet.
   Award money is committed to the Money Room by the page script, never here.

   Section 7 closes the bid → final loop: an awarded shot carries the PO
   number, a PO the owner marks paid is the real cost, and the difference
   between that and the RAW bid corrects the planning band for the next shot.
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
  /* internalEst(complexity, opts?) — the planning band.
     opts {finals, vendor} corrects the shipped band by what this production's
     own finalled shots actually cost (section 7). With no opts, or with too
     little evidence to stand on, the band is exactly what it always was and
     learnedN is 0 — a caller that shows a multiplier shows it only when there
     is one. evidenceN is what has been observed either way, so the page can
     say "1 so far, 2 needed" instead of pretending the silence is neutrality. */
  function internalEst(complexity, opts) {
    var r = RATES[complexity] || RATES.medium;
    var tier = RATES[complexity] ? complexity : 'medium';
    var o = opts || {};
    var cal = o.finals ? calibrateEst(o.finals, tier, o.vendor)
                       : { mult: 1, n: 0, basis: 'none', learned: false };
    var f = cal.learned ? cal.mult : 1;
    var lo = Math.round(r.lo * f), hi = Math.round(r.hi * f);
    return { complexity: tier,
             lo: lo, hi: hi, mid: Math.round((lo + hi) / 2),
             rawLo: r.lo, rawHi: r.hi,
             mult: f, learnedN: cal.learned ? cal.n : 0,
             evidenceN: cal.n, basis: cal.basis,
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
      /* false until awarded, then the PO NUMBER the Money Room gave back —
         the join key the whole bid-vs-final loop in section 7 hangs on. */
      committedPo: false
    };
  }
  function statusRank(status) { return STATUSES.indexOf(status); }

  /* bid vs planning estimate for one shot. opts is passed through to
     internalEst, so a board with recorded finals compares the bid against the
     corrected band rather than the shipped one. */
  function bidVsEst(shot, opts) {
    var est = internalEst(shot && shot.complexity, opts);
    var bid = shot && +shot.bid > 0 ? +shot.bid : 0;
    if (!bid) return { est: est, bid: 0, status: 'no-bid', delta: 0 };
    if (bid < est.lo) return { est: est, bid: bid, status: 'below', delta: bid - est.lo };
    if (bid > est.hi) return { est: est, bid: bid, status: 'above', delta: bid - est.hi };
    return { est: est, bid: bid, status: 'within', delta: 0 };
  }

  /* board(shots, opts?) → per-status counts, totals, awarded money.
     A shot's bid counts as awarded once its status is 'awarded' or later.
     opts {finals} corrects each shot's band by that shot's own vendor and
     tier, so the range on the totals line is the same arithmetic as the rows.
     estLearned counts how many of those bands were actually corrected, and
     legacyPo how many carry a pre-upgrade committedPo that no longer names a
     PO — money committed that no final can ever be joined back to.          */
  function board(shots, opts) {
    var counts = {};
    STATUSES.forEach(function (s) { counts[s] = 0; });
    var o = opts || {};
    var totalBid = 0, totalAwarded = 0, estLo = 0, estHi = 0, uncommitted = 0;
    var estLearned = 0, legacyPo = 0;
    (shots || []).forEach(function (sh) {
      if (counts[sh.status] != null) counts[sh.status]++;
      var e = internalEst(sh.complexity, o.finals ? { finals: o.finals, vendor: sh.vendor } : null);
      estLo += e.lo; estHi += e.hi;
      if (e.learnedN) estLearned++;
      if (sh.committedPo === true) legacyPo++;
      if (+sh.bid > 0) totalBid += +sh.bid;
      if (statusRank(sh.status) >= statusRank('awarded') && +sh.bid > 0) {
        totalAwarded += +sh.bid;
        if (!sh.committedPo) uncommitted++;
      }
    });
    return { counts: counts, total: (shots || []).length,
             totalBid: totalBid, totalAwarded: totalAwarded,
             estLo: estLo, estHi: estHi, uncommitted: uncommitted,
             estLearned: estLearned, legacyPo: legacyPo };
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

  /* ── 7 · bid → final: the one closed loop ─────────────────────────────
     Every department here bids work and commits a PO, and none of them ever
     learns what the work cost. The two ends already exist: the bid on the
     shot, and the PO in SB_Money_v1. All that was missing was the join key.

     Discipline copied from props/lib-props.js recordQuote, the loop that gets
     this right:
       · learn from the RAW bid, never from an already-corrected number —
         calibrating from calibrated output teaches the loop its own opinion;
       · suppress the correction below MIN_FINALS and hand the count back, so
         the display can say how much it is standing on;
       · no Date.now() — the observation is dated by the PO.               */

  /* VFX is 15200 in the chart of accounts (js/lib-money-accounts.js) — the
     account the estimator budgets VFX to, and the account the award posts to,
     so the budget line and the spend meet. Exported because the page and the
     legacy-PO recovery below must agree on it. */
  var ACCT = '15200';
  var MIN_FINALS = 2;      // one data point is an anecdote — CLearn.calibration's threshold
  var MAX_FINALS = 200;    // a production has tens of VFX shots; this is a ceiling, not a budget

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function tierOf(c) { return COMPLEXITIES.indexOf(c) >= 0 ? c : 'medium'; }
  function vendKey(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  /* Integer cents, the platform's money rule. CMoneyMath loads before this
     file on the page and in the suite; the fallback keeps a bare loader from
     throwing on an amount it can still read correctly. */
  function toCents(v) {
    if (root.CMoneyMath) return root.CMoneyMath.cents(v);
    var n = parseFloat(v);
    return isFinite(n) ? Math.round(n * 100) : 0;
  }

  /* The join key. A committed shot carries the PO NUMBER; boards written
     before that carry `true` — committed, number lost. */
  function poRef(shot) {
    var p = shot && shot.committedPo;
    return typeof p === 'string' && p ? p : '';
  }

  /* migratePoRefs(shots, money) → {migrated, unjoinable}   MUTATES shots.
     Recovers the lost number from the Money Room: the award writes
     '<code> — <desc>' on the VFX account, which is enough to identify it, and
     a number already claimed by another shot is never claimed twice. What
     cannot be matched is marked poUnjoinable rather than dropped — the money
     is real, and a board that quietly forgets it is how a commitment goes
     missing. The flag clears itself if the PO later turns up.              */
  function migratePoRefs(shots, money) {
    var pos = (money && money.pos) || [];
    var claimed = {};
    (shots || []).forEach(function (s) { var r = poRef(s); if (r) claimed[r] = 1; });
    var migrated = 0, unjoinable = 0;
    (shots || []).forEach(function (sh) {
      if (!sh || sh.committedPo !== true) return;
      var hit = null;
      for (var i = 0; i < pos.length; i++) {
        var po = pos[i];
        if (!po || !po.num || po.status === 'void') continue;
        if (String(po.acct) !== ACCT || claimed[po.num]) continue;
        if (String(po.desc || '').indexOf(sh.code + ' ') !== 0) continue;
        hit = po; break;
      }
      if (hit) { sh.committedPo = hit.num; claimed[hit.num] = 1; delete sh.poUnjoinable; migrated++; }
      else { sh.poUnjoinable = true; unjoinable++; }
    });
    return { migrated: migrated, unjoinable: unjoinable };
  }

  /* observeFinals(shots, money, known) → [obs]  — the new observations only.
     A PO is learned from at status 'paid' and no earlier: that is the settled
     invoice, a terminal state, so re-reading it on every render records
     nothing new. An open or invoiced PO is a commitment, not a cost — the
     mid-shoot partial actual is exactly what dragged the budget loop toward
     0.5x, and it has no business here.
     obs = {po, shot, acct, complexity, vendor, bid, final, t}; bid and final
     are INTEGER CENTS, and bid is the raw vendor bid on the shot.          */
  function observeFinals(shots, money, known) {
    var byNum = {};
    ((money && money.pos) || []).forEach(function (p) { if (p && p.num) byNum[p.num] = p; });
    var seen = {};
    (known || []).forEach(function (o) { if (o && o.po) seen[o.po] = 1; });
    var out = [];
    (shots || []).forEach(function (sh) {
      var ref = poRef(sh);
      if (!ref || seen[ref]) return;
      var po = byNum[ref];
      if (!po || po.status !== 'paid') return;
      var bid = toCents(sh.bid), fin = toCents(po.amount);
      if (!(bid > 0) || !(fin > 0)) return;
      seen[ref] = 1;
      out.push({ po: ref, shot: sh.code || '', acct: String(po.acct || ACCT),
                 complexity: tierOf(sh.complexity),
                 vendor: String(sh.vendor || po.vendor || '').trim(),
                 bid: bid, final: fin, t: po.date || '' });
    });
    return out;
  }

  /* mergeFinals(existing, fresh) → the bounded observation list. */
  function mergeFinals(existing, fresh) {
    var all = (existing || []).concat(fresh || []);
    return all.length > MAX_FINALS ? all.slice(-MAX_FINALS) : all;
  }

  /* calibrateEst(finals, complexity, vendor?) → {mult, n, basis, tier, vendor, learned}
     Vendor first when there is enough of it — the same house prices the same
     way twice — otherwise the complexity tier. Below MIN_FINALS the multiplier
     is 1 and `learned` is false, but n still reports what has been seen.
     Same EWMA as CLearn.learnBudget (recent films weigh more), same clamps:
     a single wild overage cannot more than double a future band.           */
  function calibrateEst(finals, complexity, vendor) {
    var tier = tierOf(complexity), vk = vendKey(vendor);
    var tierRows = (finals || []).filter(function (o) {
      return o && o.bid > 0 && o.final > 0 && tierOf(o.complexity) === tier;
    });
    var vendRows = vk ? tierRows.filter(function (o) { return vendKey(o.vendor) === vk; }) : [];
    var useVendor = vendRows.length >= MIN_FINALS;
    var rows = useVendor ? vendRows : tierRows;
    if (rows.length < MIN_FINALS) {
      return { mult: 1, n: rows.length, basis: 'none', tier: tier, vendor: '', learned: false };
    }
    rows = rows.slice().sort(function (a, b) {
      return String(a.t) < String(b.t) ? -1 : String(a.t) > String(b.t) ? 1 : 0;
    });
    var r = 1;
    rows.forEach(function (o, i) {
      var ratio = clamp(o.final / o.bid, 0.25, 4);
      r = i === 0 ? ratio : r * 0.7 + ratio * 0.3;
    });
    return { mult: Math.round(clamp(r, 0.5, 2) * 100) / 100, n: rows.length,
             basis: useVendor ? 'vendor' : 'complexity', tier: tier,
             vendor: useVendor ? String(rows[rows.length - 1].vendor || '') : '', learned: true };
  }

  /* finalNote(finals, complexity, vendor?) → one honest sentence, or ''.
     Empty at zero evidence, deliberately: a neutral-looking 1.00x over nothing
     reads exactly like knowledge, which is the failure this loop exists to
     end. One observation says so and says what it would take.              */
  function finalNote(finals, complexity, vendor) {
    var cal = calibrateEst(finals, complexity, vendor);
    if (!cal.n) return '';
    var noun = cal.n === 1 ? 'shot' : 'shots';
    if (!cal.learned) {
      return cal.n + ' ' + cal.tier + ' ' + noun + ' finalled so far — ' + MIN_FINALS +
             ' needed before the planning band is corrected.';
    }
    return 'Your last ' + cal.n + ' ' + cal.tier + ' ' + noun +
           (cal.basis === 'vendor' && cal.vendor ? ' with ' + cal.vendor : '') +
           ' finalled at ' + cal.mult.toFixed(2) + '× bid.';
  }

  root.CVfx = {
    STATUSES: STATUSES, COMPLEXITIES: COMPLEXITIES, RATES: RATES,
    ACCT: ACCT, MIN_FINALS: MIN_FINALS,
    splitScenes: splitScenes, detectShots: detectShots,
    nextCode: nextCode, makeShot: makeShot, statusRank: statusRank,
    internalEst: internalEst, bidVsEst: bidVsEst,
    plateChecklist: plateChecklist, board: board,
    poRef: poRef, migratePoRefs: migratePoRefs, observeFinals: observeFinals,
    mergeFinals: mergeFinals, calibrateEst: calibrateEst, finalNote: finalNote,
    versionName: versionName, bumpVersion: bumpVersion, daySheet: daySheet
  };
})(typeof window !== 'undefined' ? window : globalThis);
