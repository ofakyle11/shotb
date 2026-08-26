/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — one reader for the budget sheet (CBudgetSheet)

   SB_BudgetSheet_v1 stores each line item as { amt, units, rate, est, actual }.
   The Producer Suite's calculator writes amt x units x rate and leaves `est`
   at 0; five other readers summed `est` and nothing else. The consequences
   were not subtle: the Money Room's cost report showed a budget of $0 against
   real committed spend, and the quarterly investor letter declared the picture
   over budget by its entire spend, because it was comparing actuals against
   a budget of nothing.

   So the rule that decides what a line item is worth lives here, once, and
   finance, investors, workflow/advisor-ui, js/learn and the Producer Suite all
   ask this module. `syncEst()` closes the loop from the other side: the writer
   stores the number it computed, so a sheet on disk is readable by anything.

   Depends on js/lib-money-math.js. Pure logic, no DOM.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function MM() {
    var m = root.CMoneyMath;
    if (!m) throw new Error('js/lib-money-sheet.js requires js/lib-money-math.js to load first');
    return m;
  }

  /* The one definition of what a budget line is worth, in integer cents.
     Amt x Units x Rate wins when all three are set — that is the calculator
     the producer typed into; the manual `est` is the fallback for a line that
     was entered as a lump sum. */
  function itemEstCents(it) {
    var M = MM();
    if (!it) return 0;
    var a = M.num(it.amt), u = M.num(it.units), r = M.num(it.rate);
    if (a > 0 && u > 0 && r > 0) return M.mulCents(M.cents(r), a * u);
    return M.cents(it.est);
  }
  function itemEst(it) { return MM().dollars(itemEstCents(it)); }
  function itemActualCents(it) { return MM().cents(it && it.actual); }
  function itemActual(it) { return MM().dollars(itemActualCents(it)); }

  /* A line whose stored `est` disagrees with its calculator. */
  function itemNeedsSync(it) {
    var M = MM();
    if (!it) return false;
    return itemEstCents(it) !== M.cents(it.est);
  }

  function catCents(cat) {
    var est = 0, act = 0;
    ((cat && cat.items) || []).forEach(function (it) {
      est += itemEstCents(it);
      act += itemActualCents(it);
    });
    return { est: est, actual: act };
  }
  function catTotals(cat) {
    var M = MM(), c = catCents(cat);
    return { est: M.dollars(c.est), actual: M.dollars(c.actual) };
  }

  function categories(sheet) { return ((sheet && sheet.categories) || []); }

  function subtotalCents(sheet) {
    var t = 0;
    categories(sheet).forEach(function (c) { t += catCents(c).est; });
    return t;
  }
  function actualCents(sheet) {
    var t = 0;
    categories(sheet).forEach(function (c) { t += catCents(c).actual; });
    return t;
  }
  function subtotal(sheet) { return MM().dollars(subtotalCents(sheet)); }
  function actualTotal(sheet) { return MM().dollars(actualCents(sheet)); }

  /* Budget by account, for the cost report. Categories that share an account
     are merged rather than one silently overwriting the other. */
  function byAcctCents(sheet) {
    var out = {};
    categories(sheet).forEach(function (c) {
      var a = String(c.acct == null ? '' : c.acct);
      var row = out[a] || (out[a] = { acct: a, budget: 0, name: c.name || a });
      row.budget += catCents(c).est;
      if (!row.name && c.name) row.name = c.name;
    });
    return out;
  }
  function byAcct(sheet) {
    var M = MM(), cents = byAcctCents(sheet), out = {};
    Object.keys(cents).forEach(function (a) {
      out[a] = { budget: M.dollars(cents[a].budget), name: cents[a].name };
    });
    return out;
  }

  /* Labour base, for payroll fringes — asked of the chart of accounts, not of
     a second hand-kept list. */
  function laborBaseCents(sheet) {
    var A = root.CAccounts;
    var t = 0;
    categories(sheet).forEach(function (c) {
      if (A ? A.isLabor(c.acct) : false) t += catCents(c).est;
    });
    return t;
  }

  /* Write the calculator's answer back onto the item, so a stored sheet says
     what it means and any reader — including one written before this module —
     reads the same number. Returns how many lines were corrected. */
  function syncEst(sheet) {
    var M = MM(), n = 0;
    categories(sheet).forEach(function (c) {
      (c.items || []).forEach(function (it) {
        var want = itemEstCents(it);
        if (want !== M.cents(it.est)) { it.est = M.dollars(want); n++; }
      });
    });
    return n;
  }

  root.CBudgetSheet = {
    itemEst: itemEst, itemEstCents: itemEstCents,
    itemActual: itemActual, itemActualCents: itemActualCents,
    itemNeedsSync: itemNeedsSync,
    catTotals: catTotals, catCents: catCents,
    subtotal: subtotal, subtotalCents: subtotalCents,
    actualTotal: actualTotal, actualCents: actualCents,
    byAcct: byAcct, byAcctCents: byAcctCents,
    laborBaseCents: laborBaseCents,
    syncEst: syncEst
  };
})(typeof window !== 'undefined' ? window : globalThis);
