/* CINAMATE — the learning layer (CLearn).
 *
 * Cross-project memory that makes the platform measurably better and
 * faster the more it is used. Lives under CIN_Learn_v1 — deliberately
 * OUTSIDE the per-project SB_* namespace, so what one production
 * teaches survives project switches and improves the next film.
 *
 * Three closed loops, all fed by the user's own data on their own
 * machine (nothing leaves the browser):
 *   1. Budget calibration — every line item on a WRAPPED production where a
 *      real actual lands next to an estimate teaches a per-account correction
 *      that is applied to future seeded estimates. Before each observation is
 *      folded in, the prediction that correction would have produced is
 *      recorded next to the truth (state.pw). That walk-forward record is the
 *      only thing here that can say whether the learning works — and it is the
 *      only thing that may be labelled "self-learning". The size of the
 *      corrections is not accuracy; it goes UP as the platform gets it wrong.
 *   2. Render-speed learning — every completed Cinamate AI render is
 *      timed; schedules and time estimates use the machine's real
 *      measured speed instead of the shipped default.
 *   3. Research cache — cast-intelligence lookups are remembered for a
 *      week, so repeat questions answer instantly and hit the external
 *      APIs less.
 * All original code, written for Cinamate.
 */
(function (root) {
  'use strict';
  var KEY = 'CIN_Learn_v1';

  function load() {
    try {
      var d = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null');
      if (d && typeof d === 'object') return d;
    } catch (e) {}
    return {};
  }
  function norm(d) {
    d.budget = d.budget || {};   // acct → {r: ewma ratio, n}
    d.seen = d.seen || [];       // learned line-item fingerprints
    d.render = d.render || [];   // [{c: clipSec, w: wallSec, t}]
    d.cache = d.cache || {};     // key → {t, ttl, v}
    /* The walk-forward record: what the platform PREDICTED for a line before it
       had ever seen that line, next to what the line really cost. This is the
       only store here that can answer "is the learning working". */
    d.pw = d.pw || [];           // [{acct, est, pred, act, n: priorsAtPredictTime, t}]
    return d;
  }
  var state = norm(load());
  function save() {
    try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ── 1 · budget calibration ─────────────────────────────────────── */
  /* Learn from every line item that has both an estimate and a real
   * actual. Idempotent: each row is fingerprinted so re-opening the
   * sheet never double-learns.
   *
   * What a line item is worth is decided in one place — js/lib-money-sheet.js
   * — because the Producer Suite writes Amt x Units x Rate and leaves `est`
   * at 0, so reading `est` alone learned from none of those lines. Pages that
   * load learn.js only for render stats need not carry the reader; a caller
   * that hands over its own {est, actual} rows (props does) still works. */
  function lineEst(it) {
    return root.CBudgetSheet ? root.CBudgetSheet.itemEst(it) : parseFloat(it.est);
  }

  /* ── the completion gate ──────────────────────────────────────────
     A production teaches ONCE, when it is finished. Mid-shoot, `actual` is
     whatever has been invoiced so far against a whole-picture estimate: a
     department that has spent 12% of its budget in week two looks like an 88%
     underrun, and folding that in drags every future seeded estimate down.
     producer/budget-sheet.js calls learnBudget on every save of the live sheet
     and finance/index.html on every render of the cost report, so without this
     gate the store was being taught the shape of a partial ledger, repeatedly.

     The marker lives on the project slot in CIN_Projects_v1 (projects/lib-vault.js
     setWrapped) and is read here directly, because the pages that learn — the
     Producer Suite, the money room, props — do not load the vault engine.     */
  var PROJ_KEY = 'CIN_Projects_v1';
  function projectMeta() {
    var out = { name: '', status: '', wrappedAt: '' };
    try {
      var m = JSON.parse((root.localStorage && root.localStorage.getItem(PROJ_KEY)) || 'null');
      if (!m || typeof m !== 'object') return out;
      out.name = String(m.active || '');
      var slot = (m.slots && m.slots[out.name]) || null;
      if (slot && typeof slot === 'object') {
        out.status = String(slot.status || '');
        out.wrappedAt = String(slot.wrappedAt || '');
      }
    } catch (e) {}
    return out;
  }
  /* What the learning layer is allowed to do right now, and why. */
  function gate() {
    var p = projectMeta();
    return {
      project: p.name, wrappedAt: p.wrappedAt,
      wrapped: p.status === 'wrapped',
      status: p.status === 'wrapped' ? 'wrapped' : 'in progress'
    };
  }

  /* A line teaches at most once, keyed on WHAT it is — production, account,
     line id — never on what it currently says. The old fingerprint carried the
     estimate AND the actual, so every revision of either was a brand-new fact:
     three postings against one invoice line taught three ratios from one
     purchase, and a mid-shoot account re-learned itself on every invoice. */
  function lineFp(project, acct, it, idx) {
    var id = (it && (it.id || it.desc)) || ('#' + idx);
    return project + '|' + (acct || '?') + '|' + String(id);
  }

  var PW_MAX = 300;
  function learnBudget(sheet, opts) {
    if (!sheet || !Array.isArray(sheet.categories)) return 0;
    opts = opts || {};
    var g = gate();
    /* `wrapped` can be forced by a caller that knows the observation is final
       (a test, or a page that has just marked the wrap itself). Everything else
       waits for the production to be wrapped in Projects. */
    var wrapped = opts.wrapped == null ? g.wrapped : !!opts.wrapped;
    if (!wrapped) return 0;
    var project = opts.project != null ? String(opts.project) : (g.project || '');
    var when = opts.t == null ? (typeof Date !== 'undefined' ? Date.now() : 0) : opts.t;
    var learned = 0;
    sheet.categories.forEach(function (c) {
      (c.items || []).forEach(function (it, idx) {
        var est = lineEst(it), act = parseFloat(it.actual);
        if (!(est > 0) || !(act > 0)) return;
        var fp = lineFp(project, c.acct, it, idx);
        if (state.seen.indexOf(fp) >= 0) return;
        state.seen.push(fp);
        if (state.seen.length > 500) state.seen = state.seen.slice(-400);
        /* BEFORE the fold. `pred` is the number the platform would have put in
           front of the owner for this line, from everything it had learned up
           to this moment — and `n` is how much evidence that stood on. Recorded
           here and nowhere else, because one instant later the observation is
           inside the multiplier and the prediction can never be reconstructed. */
        var b = state.budget[c.acct] || { r: 1, n: 0 };
        var nPrior = b.n;
        var pred = est * calibration(c.acct).mult;
        state.pw.push({ acct: c.acct, est: est, pred: Math.round(pred * 100) / 100,
                        act: act, n: nPrior, t: when });
        if (state.pw.length > PW_MAX) state.pw = state.pw.slice(-Math.round(PW_MAX * 0.8));

        var ratio = clamp(act / est, 0.25, 4);
        b.r = b.n === 0 ? ratio : b.r * 0.7 + ratio * 0.3;   // recent films weigh more
        b.n++;
        state.budget[c.acct] = b;
        learned++;
      });
    });
    if (learned) save();
    return learned;
  }
  function calibration(acct) {
    var b = state.budget[acct];
    if (!b || b.n < 2) return { mult: 1, n: b ? b.n : 0 };   // one data point is an anecdote
    return { mult: Math.round(clamp(b.r, 0.5, 2) * 100) / 100, n: b.n };
  }

  /* ── the honest accuracy metric ───────────────────────────────────
     Did the calibrated estimate beat the uncalibrated one? Over the rows where
     the platform had actually formed an opinion (n >= 2 priors, the same
     threshold calibration() uses), compare |pred − act| against |est − act|.
     Nothing else here may be labelled "self-learning": the average correction
     is a measure of how much correcting the platform has had to do, and it
     RISES as the platform gets more wrong.                                   */
  var WF_MIN_PRIOR = 2;   // an account with fewer priors predicted est unchanged
  var WF_MIN_ROWS = 5;    // below this the comparison is an anecdote, not evidence
  function walkForward(opts) {
    opts = opts || {};
    var minPrior = opts.minPrior == null ? WF_MIN_PRIOR : opts.minPrior;
    var minRows = opts.minRows == null ? WF_MIN_ROWS : opts.minRows;
    var accts = {}, rawErr = 0, calErr = 0, better = 0, worse = 0, n = 0;
    (state.pw || []).forEach(function (r) {
      if (!r || !(r.est > 0) || !(r.act > 0)) return;
      if (!(r.n >= minPrior)) return;
      var re = Math.abs(r.est - r.act);
      var ce = Math.abs((r.pred == null ? r.est : r.pred) - r.act);
      rawErr += re; calErr += ce;
      if (ce < re) better++; else if (ce > re) worse++;
      accts[r.acct] = 1;
      n++;
    });
    var improvePct = rawErr > 0 ? Math.round((rawErr - calErr) / rawErr * 1000) / 10 : 0;
    return {
      n: n, accounts: Object.keys(accts).length,
      rawErr: Math.round(rawErr), calErr: Math.round(calErr),
      better: better, worse: worse, improvePct: improvePct,
      minRows: minRows, minPrior: minPrior,
      enough: n >= minRows,
      verdict: n < minRows ? 'unproven' : (improvePct > 0 ? 'better' : (improvePct < 0 ? 'worse' : 'even'))
    };
  }

  /* Activity, not accuracy — and named so nobody can print it as accuracy
     again. `avgCorrection` is the n-weighted mean of the multipliers being
     applied; finding 44 is that this number was labelled "Self-learning" while
     going UP as the estimates got worse. It stays because it is worth seeing,
     under a name that says what it is. */
  function budgetSummary() {
    var n = 0, w = 0, wm = 0, accts = 0;
    Object.keys(state.budget).forEach(function (a) {
      var b = state.budget[a];
      accts++;
      n += b.n; w += b.n * clamp(b.r, 0.5, 2); wm += b.n;
    });
    return { lines: n, accounts: accts, avgCorrection: wm ? Math.round(w / wm * 100) / 100 : 1 };
  }

  /* The sentence the owner reads. It lives here, not in the page, so what the
     platform CLAIMS about itself is node-testable — the defect in finding 44
     was in an untested 166-line UI file. */
  function learningReport() {
    var w = walkForward(), g = gate(), b = budgetSummary();
    var head;
    if (!w.enough) {
      head = 'Self-learning: unproven — ' + w.n + ' of ' + w.minRows +
        ' closed line' + (w.minRows === 1 ? '' : 's') + ' needed before a calibrated estimate ' +
        'can be scored against the raw one it replaced' +
        (w.n === 0 ? '. Nothing has been re-estimated yet, so there is no accuracy to report.' : '.');
    } else if (w.verdict === 'better') {
      head = 'Self-learning: calibrated estimates beat raw by ' + w.improvePct + '% across ' +
        w.n + ' closed lines in ' + w.accounts + ' account' + (w.accounts === 1 ? '' : 's') +
        ' (' + w.better + ' closer, ' + w.worse + ' further off).';
    } else if (w.verdict === 'worse') {
      head = 'Self-learning: calibration is making estimates ' + Math.abs(w.improvePct) +
        '% WORSE than raw across ' + w.n + ' closed lines in ' + w.accounts + ' account' +
        (w.accounts === 1 ? '' : 's') + ' (' + w.better + ' closer, ' + w.worse +
        ' further off) — treat the seeded numbers as unhelped.';
    } else {
      head = 'Self-learning: calibrated and raw estimates are level across ' + w.n +
        ' closed lines — the correction is not earning its place yet.';
    }
    var gateNote = g.wrapped
      ? 'Learning from "' + (g.project || 'this production') + '", wrapped' +
        (g.wrappedAt ? ' ' + g.wrappedAt : '') + '.'
      : 'Nothing is being learned from "' + (g.project || 'this production') +
        '" — mark it wrapped in Projects when it is finished. A part-shot ledger ' +
        'reads as a huge underrun and would poison every future estimate.';
    var activity = b.lines
      ? b.lines + ' closed line' + (b.lines === 1 ? '' : 's') + ' folded in across ' +
        b.accounts + ' account' + (b.accounts === 1 ? '' : 's') + ' · average correction applied ×' +
        b.avgCorrection + ' (how much correcting it has done, not how well it works)'
      : 'No budget actuals folded in yet — fill the Actual column as invoices land.';
    return { headline: head, gate: gateNote, activity: activity, walk: w, wrapped: g.wrapped };
  }

  /* ── 2 · render-speed learning ──────────────────────────────────── */
  function recordRender(clipSec, wallSec, when) {
    clipSec = parseFloat(clipSec); wallSec = parseFloat(wallSec);
    if (!(clipSec > 0) || !(wallSec > 3)) return false;       // instant/cached results are not renders
    if (wallSec > 3600) return false;                          // stalls are not signal
    state.render.push({ c: clipSec, w: Math.round(wallSec * 10) / 10, t: when || 0 });
    if (state.render.length > 80) state.render = state.render.slice(-60);
    save();
    return true;
  }
  function renderStats() {
    var r = state.render;
    if (!r.length) return { n: 0, wallPerClip: 0, perClipSec: 0, trend: 'unknown' };
    var walls = r.map(function (x) { return x.w; });
    var spcs = r.map(function (x) { return x.w / x.c; });
    var trend = 'steady';
    if (r.length >= 8) {
      var early = median(walls.slice(0, Math.floor(r.length / 2)));
      var late = median(walls.slice(Math.floor(r.length / 2)));
      if (late < early * 0.85) trend = 'faster';
      else if (late > early * 1.15) trend = 'slower';
    }
    return {
      n: r.length,
      wallPerClip: Math.round(median(walls)),
      perClipSec: Math.round(median(spcs) * 10) / 10,
      trend: trend
    };
  }
  /* feeds the Studio estimator: measured seconds per clip once ≥3 real renders exist */
  function genSecPerClip(fallback) {
    var s = renderStats();
    if (s.n < 3) return fallback;
    return clamp(s.wallPerClip, 10, 900);
  }

  /* ── 3 · research cache ─────────────────────────────────────────── */
  var WEEK = 7 * 24 * 3600 * 1000;
  function cacheGet(k, now) {
    var e = state.cache[k];
    if (!e) return null;
    now = now || (typeof Date !== 'undefined' ? Date.now() : 0);
    if (now - e.t > (e.ttl || WEEK)) { delete state.cache[k]; save(); return null; }
    return e.v;
  }
  /* What goes in here is a reply from someone else's server — TMDB, Wikidata —
     kept for a week and rendered by whatever asked for it. The vault
     sanitiser never sees any of it: it covers the SB_* namespace, and this
     store sits outside that namespace on purpose so learning survives project
     switches. That is the right design for learning and the wrong one for
     trust, so the cleaning happens here instead, on the way in.

     Everything is neutralised by default. Nothing cached here is markup —
     these are names, dates, ids and short blurbs rendered as text — so
     removing the characters that end an attribute or open a tag costs
     nothing and does not depend on every consumer remembering to escape. */
  var CACHE_MAX_DEPTH = 40;
  function cleanCached(node, depth) {
    depth = depth || 0;
    if (depth > CACHE_MAX_DEPTH) return null;
    if (node === null || node === undefined) return node;
    if (typeof node === 'string') {
      /* A scheme can be hostile without containing a single markup character:
         "javascript:alert(1)" survives stripping <>"' untouched, and the app's
         CSP carries 'unsafe-inline', so such a URL in an href really does run.
         Third-party replies carry URLs (poster paths, homepages, wiki links)
         and several modules render them as href or src. */
      if (/^[\s\u0000-\u001f]*(javascript|vbscript|data|file)[\s\u0000-\u001f]*:/i.test(node)) return '';
      return node.replace(/[<>"']/g, '');
    }
    if (typeof node !== 'object') return node;
    if (Object.prototype.toString.call(node) === '[object Array]') {
      var out = [];
      for (var i = 0; i < node.length; i++) out.push(cleanCached(node[i], depth + 1));
      return out;
    }
    var o = {};
    Object.keys(node).forEach(function (key) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      o[key.replace(/[<>"']/g, '')] = cleanCached(node[key], depth + 1);
    });
    return o;
  }

  /* Returns the cleaned value. cleanCached builds new objects and does not
     mutate, so a caller that kept using its own reference — as the props
     lookup did, rendering and then persisting j.houses into SB_Props_v1 —
     stored the raw third-party reply even though the cache held a clean
     one. Cleaning a copy nobody uses is not cleaning. */
  function cachePut(k, v, ttl, now) {
    var cleaned = cleanCached(v, 0);
    try {
      state.cache[k] = { t: now || Date.now(), ttl: ttl || WEEK, v: cleaned };
      var keys = Object.keys(state.cache);
      if (keys.length > 60) {
        keys.sort(function (a, b) { return state.cache[a].t - state.cache[b].t; });
        keys.slice(0, keys.length - 50).forEach(function (x) { delete state.cache[x]; });
      }
      save();
    } catch (e) {}
    return cleaned;
  }

  function summary() {
    var b = budgetSummary(), r = renderStats();
    /* No avgMult. That key was the whole of finding 44: the page printed it as
       "Self-learning" and it rises as the platform gets more wrong. Accuracy
       now travels as `walk`, which can come back negative. */
    return {
      budgetLines: b.lines, budgetAccounts: b.accounts, avgCorrection: b.avgCorrection,
      walk: walkForward(), gate: gate(), report: learningReport(),
      renders: r.n, wallPerClip: r.wallPerClip, trend: r.trend,
      cached: Object.keys(state.cache).length
    };
  }
  function reset() { state = norm({}); save(); }

  root.CLearn = {
    KEY: KEY, PROJ_KEY: PROJ_KEY,
    learnBudget: learnBudget, calibration: calibration, budgetSummary: budgetSummary,
    walkForward: walkForward, learningReport: learningReport, gate: gate, lineFp: lineFp,
    recordRender: recordRender, renderStats: renderStats, genSecPerClip: genSecPerClip,
    cacheGet: cacheGet, cachePut: cachePut, cleanCached: cleanCached,
    summary: summary, reset: reset,
    _state: function () { return state; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
