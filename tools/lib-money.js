/* TMoney — production money math:
 *  1. Union timecard engine — call/wrap → gross pay under film OT
 *     conventions (published rate-card rules: 1.5× after 8, 2× after 12,
 *     3× after 15 elapsed; SAG-style day-performer OT; meal penalties;
 *     turnaround invasion; 6th/7th-day premiums; fringes).
 *  2. Hot-cost journal — postings against top-sheet account codes,
 *     actual + committed vs budget (plain double-entry-style ledger).
 *  3. Waterfall instruments — investor classes with premium/corridor
 *     layered on a lifetime-revenue number.
 *
 * All original code, written for Cinamate. Rules are published industry
 * conventions (facts), parameterized so productions can match their own
 * agreements. Not payroll or legal advice.
 */
(function (root) {
  'use strict';

  /* ── 1. timecard ─────────────────────────────────────────────── */
  var TC_DEFAULTS = {
    otAfter: 8,          // 1.5× after this many worked hours
    dtAfter: 12,         // 2× after this many ELAPSED hours (12-hr convention)
    gtAfter: 15,         // 3× ("golden time") after this many elapsed hours
    mealAfter: 6,        // first meal due within N hours of call
    mealLenMin: 30,      // meal length that stops the clock (unpaid)
    mealPenaltySteps: [25, 30, 50],  // per half-hour violated, escalating
    turnaroundHrs: 10,   // rest between wrap and next call
    fringePct: 0.28,     // payroll tax + benefits, configurable per crew basis
    sixthDayMult: 1.5,
    seventhDayMult: 2.0
  };

  function hoursBetween(callHHMM, wrapHHMM) {
    function p(t) { var m = String(t).match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1] + (+m[2]) / 60) : null; }
    var a = p(callHHMM), b = p(wrapHHMM);
    if (a == null || b == null) return null;
    var h = b - a;
    if (h <= 0) h += 24;             // wrap past midnight
    return Math.round(h * 100) / 100;
  }

  /* One day for one crew member.
   * inp: { rate (hourly), call:'HH:MM', wrap:'HH:MM', mealsTaken (count),
   *        firstMealAtHr (hours after call, null if none), dayOfWeek (1-7,
   *        7=7th consecutive), prevWrap:'HH:MM' (yesterday, optional),
   *        rules (overrides) }
   */
  function timecard(inp) {
    var R = Object.assign({}, TC_DEFAULTS, inp.rules || {});
    var rate = Number(inp.rate) || 0;
    var elapsed = hoursBetween(inp.call, inp.wrap);
    if (elapsed == null) return { error: 'bad call/wrap time' };
    var mealOff = Math.min(2, inp.mealsTaken || 0) * (R.mealLenMin / 60);
    var worked = Math.max(0, elapsed - mealOff);

    var lines = [];
    /* straight / OT / DT / golden split.
     * OT threshold applies to WORKED hours; DT + golden to ELAPSED
     * (the industry 12-hour-day convention). */
    var straight = Math.min(worked, R.otAfter);
    var goldenElapsed = Math.max(0, elapsed - R.gtAfter);
    var dtElapsed = Math.max(0, Math.min(elapsed, R.gtAfter) - R.dtAfter);
    var otHours = Math.max(0, worked - straight - dtElapsed - goldenElapsed);

    lines.push({ label: 'Straight time', hours: r2(straight), mult: 1 });
    if (otHours > 0) lines.push({ label: 'Overtime 1.5×', hours: r2(otHours), mult: 1.5 });
    if (dtElapsed > 0) lines.push({ label: 'Double time 2×', hours: r2(dtElapsed), mult: 2 });
    if (goldenElapsed > 0) lines.push({ label: 'Golden time 3×', hours: r2(goldenElapsed), mult: 3 });

    var dayMult = 1;
    if (inp.dayOfWeek === 6) dayMult = R.sixthDayMult;
    if (inp.dayOfWeek === 7) dayMult = R.seventhDayMult;

    var gross = 0;
    lines.forEach(function (l) { l.pay = r2(l.hours * rate * l.mult * dayMult); gross += l.pay; });
    if (dayMult > 1) lines.push({ label: (inp.dayOfWeek === 7 ? '7th' : '6th') + '-day premium ×' + dayMult, hours: 0, mult: dayMult, pay: 0, note: 'applied to all hours above' });

    /* meal penalties: first meal must start within mealAfter hours */
    var penalties = 0, penaltyLines = [];
    var firstMeal = inp.firstMealAtHr;
    if (worked > R.mealAfter && (firstMeal == null || firstMeal > R.mealAfter)) {
      var violatedHalfHours = firstMeal == null
        ? Math.ceil((worked - R.mealAfter) * 2)
        : Math.ceil((firstMeal - R.mealAfter) * 2);
      violatedHalfHours = Math.min(violatedHalfHours, 12);
      for (var i = 0; i < violatedHalfHours; i++) {
        var step = R.mealPenaltySteps[Math.min(i, R.mealPenaltySteps.length - 1)];
        penalties += step;
      }
      penaltyLines.push({ label: 'Meal penalty × ' + violatedHalfHours + ' half-hour' + (violatedHalfHours === 1 ? '' : 's'), pay: r2(penalties) });
    }

    /* turnaround invasion: rest since yesterday's wrap */
    var invasion = 0;
    if (inp.prevWrap) {
      var rest = hoursBetween(inp.prevWrap, inp.call);
      if (rest != null && rest < R.turnaroundHrs) {
        invasion = r2((R.turnaroundHrs - rest) * rate);
        penaltyLines.push({ label: 'Forced call — turnaround invaded ' + r2(R.turnaroundHrs - rest) + 'h', pay: invasion });
      }
    }

    var subtotal = r2(gross + penalties + invasion);
    var fringes = r2(subtotal * R.fringePct);
    return {
      elapsed: r2(elapsed), worked: r2(worked),
      lines: lines, penaltyLines: penaltyLines,
      gross: r2(gross), penalties: r2(penalties + invasion),
      fringes: fringes, fringePct: R.fringePct,
      total: r2(subtotal + fringes)
    };
  }
  function r2(n) { return Math.round(n * 100) / 100; }

  /* ── 2. hot-cost journal ─────────────────────────────────────── */
  /* postings: [{date, acct, desc, kind:'actual'|'po', amount}] */
  function hotCost(postings, budgetByAcct) {
    var by = {};
    (postings || []).forEach(function (p) {
      var a = String(p.acct || 'misc');
      by[a] = by[a] || { acct: a, actual: 0, committed: 0 };
      if (p.kind === 'po') by[a].committed += Number(p.amount) || 0;
      else by[a].actual += Number(p.amount) || 0;
    });
    var rows = Object.keys(by).sort().map(function (a) {
      var r = by[a];
      r.budget = Number((budgetByAcct || {})[a]) || 0;
      r.total = r2(r.actual + r.committed);
      r.variance = r2(r.budget - r.total);
      r.pctUsed = r.budget > 0 ? Math.round(r.total / r.budget * 100) : null;
      return r;
    });
    var t = rows.reduce(function (s, r) {
      s.actual += r.actual; s.committed += r.committed; s.budget += r.budget; return s;
    }, { actual: 0, committed: 0, budget: 0 });
    t.total = r2(t.actual + t.committed);
    t.variance = r2(t.budget - t.total);
    return { rows: rows, totals: t };
  }

  /* ── 3. waterfall instruments ────────────────────────────────── */
  /* classes: [{name, invested, premiumPct (e.g. 0.2), corridorPct (share of
   *   pool AFTER recoupment, 0–1)}], producerPct fills the remainder.
   * lifetime: total distributable revenue after fees/P&A (from the Sales tab).
   */
  function instrumentWaterfall(lifetime, classes, deferrals) {
    var remaining = Math.max(0, Number(lifetime) || 0);
    var steps = [];
    (deferrals || []).forEach(function (d) {
      var pay = Math.min(remaining, Number(d.amount) || 0);
      steps.push({ step: 'Deferral — ' + d.name, due: Number(d.amount) || 0, paid: r2(pay) });
      remaining -= pay;
    });
    (classes || []).forEach(function (c) {
      var due = (Number(c.invested) || 0) * (1 + (Number(c.premiumPct) || 0));
      var pay = Math.min(remaining, due);
      steps.push({ step: c.name + ' — recoup + ' + Math.round((c.premiumPct || 0) * 100) + '% premium', due: r2(due), paid: r2(pay) });
      remaining -= pay;
    });
    var pool = r2(remaining);
    var corridorTotal = 0;
    (classes || []).forEach(function (c) {
      if (c.corridorPct) {
        var share = r2(pool * c.corridorPct);
        corridorTotal += c.corridorPct;
        steps.push({ step: c.name + ' — back-end ' + Math.round(c.corridorPct * 100) + '% of pool', due: share, paid: share });
      }
    });
    var producer = r2(pool * Math.max(0, 1 - corridorTotal));
    steps.push({ step: 'Producer / talent pool', due: producer, paid: producer });
    var invested = (classes || []).reduce(function (s, c) { return s + (Number(c.invested) || 0); }, 0);
    return { steps: steps, pool: pool, producerNet: producer, invested: r2(invested),
      breakeven: invested > 0 ? steps.filter(function (s) { return s.paid < s.due; }).length === 0 : true };
  }

  root.TMoney = { TC_DEFAULTS: TC_DEFAULTS, hoursBetween: hoursBetween, timecard: timecard,
    hotCost: hotCost, instrumentWaterfall: instrumentWaterfall };
})(typeof window !== 'undefined' ? window : globalThis);
