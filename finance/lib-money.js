/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Money Room engine (CMoney)
   The weekly cost report exactly as studio accounting runs it: for every
   budget account — Budget, Actual (paid/invoiced + petty cash + labour), Committed
   (open purchase orders and signed deals), Estimate-To-Complete, then
   EFC = Actual + Committed + ETC and Variance = Budget − EFC. Overruns
   surface while there is still time to act, and every actual feeds the
   learning layer so the next film's estimates calibrate automatically.

   Arithmetic is carried in integer cents (js/lib-money-math.js) and the budget
   is read through the one line-item reader (js/lib-money-sheet.js). Both are
   load-bearing: the report used to round each row's EFC and variance while
   summing the raw columns, so the TOTAL row did not foot — $79 of cost that
   was never committed, at 240 accounts, on the report that goes weekly to the
   studio and the completion bond. And it summed `est` alone, so a sheet built
   with the Amt x Units x Rate calculator showed a budget of $0.
   Pure logic, no DOM.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function MM() {
    var m = root.CMoneyMath;
    if (!m) throw new Error('finance/lib-money.js requires js/lib-money-math.js');
    return m;
  }
  function SHEET() {
    var s = root.CBudgetSheet;
    if (!s) throw new Error('finance/lib-money.js requires js/lib-money-sheet.js');
    return s;
  }

  function uid() { return 'm' + Math.random().toString(36).slice(2, 9); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function blank() {
    /* labor is DERIVED — rebuilt from the timecards by js/lib-payroll.js on
       every render, never edited here. It is declared so the shape the report
       reads is visible in one place. */
    return { v: 1, pos: [], petty: [], etc: {}, labor: [], snapshots: [], nextPo: 1001 };
  }

  /* ── purchase orders ─────────────────────────────────────────────────
     status: open (committed) → invoiced/paid (actual) → void (gone)     */
  function addPO(m, fields) {
    var po = {
      id: uid(), num: 'PO-' + m.nextPo++,
      vendor: fields.vendor || '', desc: fields.desc || '',
      acct: String(fields.acct || '3000'), amount: num(fields.amount),
      status: 'open', date: fields.date || '', notes: fields.notes || ''
    };
    m.pos.push(po);
    return po;
  }
  function setPoStatus(m, id, status) {
    var po = m.pos.filter(function (p) { return p.id === id; })[0];
    if (!po || ['open', 'invoiced', 'paid', 'void'].indexOf(status) < 0) return null;
    po.status = status;
    return po;
  }
  function addPetty(m, fields) {
    var row = { id: uid(), who: fields.who || '', desc: fields.desc || '',
                acct: String(fields.acct || '3000'), amount: num(fields.amount), date: fields.date || '' };
    m.petty.push(row);
    return row;
  }
  function removeRow(m, id) {
    var n = m.pos.length + m.petty.length;
    m.pos = m.pos.filter(function (p) { return p.id !== id; });
    m.petty = m.petty.filter(function (p) { return p.id !== id; });
    return n !== m.pos.length + m.petty.length;
  }

  /* ── the cost report ─────────────────────────────────────────────────
     The budget side is read through CBudgetSheet, so a line entered as
     Amt x Units x Rate counts for what the calculator says it is worth.   */
  function budgetByAcct(sheet) { return SHEET().byAcct(sheet); }

  /* Where a posting lands on the report. A department posts to the account it
     actually spends on — VFX bids to 15200, cast offers to 4000 — and the
     report shows it against the budget line that covers it, rolling a detail
     account up to its major account when only the major one is budgeted.
     A genuinely unknown account still surfaces as Unbudgeted, which is the
     point of that row. */
  function postAcct(accts, a) {
    var k = String(a == null ? '' : a);
    if (accts[k]) return k;
    var A = root.CAccounts;
    var up = A ? A.rollup(k) : k;
    return (up !== k && accts[up]) ? up : k;
  }

  function costReport(sheet, m) {
    var M = MM();
    m = m || {};
    var accts = SHEET().byAcctCents(sheet);
    var rows = {};
    function row(acct) {
      if (!rows[acct]) {
        rows[acct] = { acct: acct, name: (accts[acct] && accts[acct].name) || 'Unbudgeted · ' + acct,
                       budget: (accts[acct] && accts[acct].budget) || 0,   // cents until the end
                       actual: 0, committed: 0, etc: 0, efc: 0, variance: 0, over: false };
      }
      return rows[acct];
    }
    Object.keys(accts).forEach(row);
    (m.pos || []).forEach(function (po) {
      if (po.status === 'void') return;
      var r = row(postAcct(accts, po.acct));
      if (po.status === 'open') r.committed += M.cents(po.amount);
      else r.actual += M.cents(po.amount);              // invoiced or paid = real money
    });
    (m.petty || []).forEach(function (p) { row(postAcct(accts, p.acct)).actual += M.cents(p.amount); });

    /* Labour. Half to two-thirds of a film is people, and until this line
       existed none of it reached the report: every EFC and every variance was
       wrong by the size of the crew. The postings arrive as plain data on
       m.labor — {acct, kind:'actual'|'committed', cents} — built by
       js/lib-payroll.js from the timecards. Deliberately dumb on this side:
       this file is script-loaded by six other module pages, so the join
       cannot add a dependency here. `cents` is authoritative when present so
       payroll's integer arithmetic survives the trip. */
    var labor = { actual: 0, committed: 0 };
    (m.labor || []).forEach(function (p) {
      if (!p || p.kind === 'void') return;
      var c = p.cents != null ? M.roundHalfAway(p.cents) : M.cents(p.amount);
      if (!c) return;
      var r = row(postAcct(accts, p.acct));
      if (p.kind === 'committed') { r.committed += c; labor.committed += c; }
      else { r.actual += c; labor.actual += c; }
    });

    /* Totals are the sum of the cents that were actually posted — never a sum
       of already-rounded rows, and EFC/variance are DERIVED from those sums
       rather than added up separately. That is what makes the TOTAL row foot:
       totals.efc === actual + committed + etc, exactly, every time. */
    var tc = { budget: 0, actual: 0, committed: 0, etc: 0 };
    var list = Object.keys(rows).sort().map(function (a) {
      var r = rows[a];
      var override = m.etc && m.etc[a];
      r.etc = override != null && override !== ''
        ? M.cents(override)
        : Math.max(0, r.budget - r.actual - r.committed);  // default: spend the plan, no more
      tc.budget += r.budget; tc.actual += r.actual;
      tc.committed += r.committed; tc.etc += r.etc;
      var efc = r.actual + r.committed + r.etc;
      var variance = r.budget - efc;
      r.budget = M.dollars(r.budget);
      r.actual = M.dollars(r.actual);
      r.committed = M.dollars(r.committed);
      r.etc = M.dollars(r.etc);
      r.efc = M.dollars(efc);
      r.variance = M.dollars(variance);
      r.over = variance < 0;
      return r;
    });
    var efcC = tc.actual + tc.committed + tc.etc;
    var varC = tc.budget - efcC;
    var totals = {
      budget: M.dollars(tc.budget), actual: M.dollars(tc.actual),
      committed: M.dollars(tc.committed), etc: M.dollars(tc.etc),
      efc: M.dollars(efcC), variance: M.dollars(varC), over: varC < 0
    };
    return { rows: list, totals: totals,
             labor: { actual: M.dollars(labor.actual), committed: M.dollars(labor.committed),
                      total: M.dollars(labor.actual + labor.committed),
                      postings: (m.labor || []).length },
             openPOs: (m.pos || []).filter(function (p) { return p.status === 'open'; }).length };
  }

  /* weekly snapshot — the report of record, immutable once taken */
  function snapshot(m, report, when) {
    var s = { week: (m.snapshots.length + 1), date: when || '',
              totals: JSON.parse(JSON.stringify(report.totals)) };
    m.snapshots.push(s);
    if (m.snapshots.length > 60) m.snapshots = m.snapshots.slice(-52);
    return s;
  }

  /* A cell that opens with = + - @ (or a tab or carriage return that scrolls
     one into place) is a formula to Excel and Sheets, not text -- so a line
     item typed on this site would run on the machine of whoever opens the
     export. The leading apostrophe is what those programs read as "this is
     literal", and they strip it on display. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /* Money columns are written with two fixed decimals. A raw JS float in a CSV
     ships a float into the cell the producer then sums: the multiplication
     3 × 5 × 1061.64 evaluates to 15924.600000000002, and the two-item sum
     15920.3 + 4.3 to 15924.599999999999. Different expressions, different
     error — the figures are not interchangeable, and this comment previously
     used the addition's value for the multiplication. */
  function csv(report) {
    var M = MM();
    var COLS = ['budget', 'actual', 'committed', 'etc', 'efc', 'variance'];
    var lines = ['Acct,Category,Budget,Actual,Committed,ETC,EFC,Variance'];
    (report.rows || []).forEach(function (r) {
      lines.push([csvCell(r.acct), csvCell(r.name)].concat(
        COLS.map(function (k) { return M.csvNum(r[k]); })).join(','));
    });
    var t = report.totals || {};
    lines.push(['TOTAL', ''].concat(COLS.map(function (k) { return M.csvNum(t[k]); })).join(','));
    return lines.join('\n');
  }

  /* every real actual calibrates future estimates (per budget account) */
  function feedLearning(sheet, m) {
    if (!root.CLearn || !root.CLearn.learnBudget) return 0;
    var report = costReport(sheet, m);
    var cats = report.rows
      .filter(function (r) { return r.budget > 0 && r.actual > 0; })
      .map(function (r) {
        return { acct: r.acct, items: [{ desc: 'cost report actuals', est: r.budget, actual: r.actual }] };
      });
    if (!cats.length) return 0;
    try { return root.CLearn.learnBudget({ categories: cats }); } catch (e) { return 0; }
  }

  root.CMoney = {
    blank: blank, addPO: addPO, setPoStatus: setPoStatus, addPetty: addPetty,
    removeRow: removeRow, budgetByAcct: budgetByAcct, costReport: costReport,
    postAcct: postAcct, snapshot: snapshot, csv: csv, feedLearning: feedLearning
  };
})(typeof window !== 'undefined' ? window : globalThis);
