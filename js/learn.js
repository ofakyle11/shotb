/* CINAMATE — the learning layer (CLearn).
 *
 * Cross-project memory that makes the platform measurably better and
 * faster the more it is used. Lives under CIN_Learn_v1 — deliberately
 * OUTSIDE the per-project SB_* namespace, so what one production
 * teaches survives project switches and improves the next film.
 *
 * Three closed loops, all fed by the user's own data on their own
 * machine (nothing leaves the browser):
 *   1. Budget calibration — every line item where a real actual lands
 *      next to an estimate teaches a per-account correction that is
 *      applied to future seeded estimates.
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
   * sheet never double-learns. */
  function learnBudget(sheet) {
    if (!sheet || !Array.isArray(sheet.categories)) return 0;
    var learned = 0;
    sheet.categories.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        var est = parseFloat(it.est), act = parseFloat(it.actual);
        if (!(est > 0) || !(act > 0)) return;
        var fp = (c.acct || '?') + '|' + (it.desc || '') + '|' + est + '|' + act;
        if (state.seen.indexOf(fp) >= 0) return;
        state.seen.push(fp);
        if (state.seen.length > 500) state.seen = state.seen.slice(-400);
        var ratio = clamp(act / est, 0.25, 4);
        var b = state.budget[c.acct] || { r: 1, n: 0 };
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
  function budgetSummary() {
    var n = 0, w = 0, wm = 0;
    Object.keys(state.budget).forEach(function (a) {
      var b = state.budget[a];
      n += b.n; w += b.n * clamp(b.r, 0.5, 2); wm += b.n;
    });
    return { lines: n, avgMult: wm ? Math.round(w / wm * 100) / 100 : 1 };
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
  function cachePut(k, v, ttl, now) {
    try {
      state.cache[k] = { t: now || Date.now(), ttl: ttl || WEEK, v: v };
      var keys = Object.keys(state.cache);
      if (keys.length > 60) {
        keys.sort(function (a, b) { return state.cache[a].t - state.cache[b].t; });
        keys.slice(0, keys.length - 50).forEach(function (x) { delete state.cache[x]; });
      }
      save();
    } catch (e) {}
  }

  function summary() {
    var b = budgetSummary(), r = renderStats();
    return {
      budgetLines: b.lines, avgMult: b.avgMult,
      renders: r.n, wallPerClip: r.wallPerClip, trend: r.trend,
      cached: Object.keys(state.cache).length
    };
  }
  function reset() { state = norm({}); save(); }

  root.CLearn = {
    KEY: KEY,
    learnBudget: learnBudget, calibration: calibration, budgetSummary: budgetSummary,
    recordRender: recordRender, renderStats: renderStats, genSecPerClip: genSecPerClip,
    cacheGet: cacheGet, cachePut: cachePut,
    summary: summary, reset: reset,
    _state: function () { return state; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
