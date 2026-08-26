/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Money Room engine (CMoney)
   The weekly cost report exactly as studio accounting runs it: for every
   budget account — Budget, Actual (paid/invoiced + petty cash), Committed
   (open purchase orders and signed deals), Estimate-To-Complete, then
   EFC = Actual + Committed + ETC and Variance = Budget − EFC. Overruns
   surface while there is still time to act, and every actual feeds the
   learning layer so the next film's estimates calibrate automatically.
   Pure logic, no DOM.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function uid() { return 'm' + Math.random().toString(36).slice(2, 9); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function blank() {
    return { v: 1, pos: [], petty: [], etc: {}, snapshots: [], nextPo: 1001 };
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

  /* ── the cost report ───────────────────────────────────────────────── */
  function budgetByAcct(sheet) {
    var out = {};
    ((sheet && sheet.categories) || []).forEach(function (c) {
      var t = 0;
      (c.items || []).forEach(function (it) { t += num(it.est); });
      out[String(c.acct)] = { budget: t, name: c.name || c.acct };
    });
    return out;
  }

  function costReport(sheet, m) {
    var accts = budgetByAcct(sheet);
    var rows = {};
    function row(acct) {
      if (!rows[acct]) {
        rows[acct] = { acct: acct, name: (accts[acct] && accts[acct].name) || 'Unbudgeted · ' + acct,
                       budget: (accts[acct] && accts[acct].budget) || 0,
                       actual: 0, committed: 0, etc: 0, efc: 0, variance: 0, over: false };
      }
      return rows[acct];
    }
    Object.keys(accts).forEach(row);
    (m.pos || []).forEach(function (po) {
      if (po.status === 'void') return;
      var r = row(String(po.acct));
      if (po.status === 'open') r.committed += po.amount;
      else r.actual += po.amount;                      // invoiced or paid = real money
    });
    (m.petty || []).forEach(function (p) { row(String(p.acct)).actual += p.amount; });

    var totals = { budget: 0, actual: 0, committed: 0, etc: 0, efc: 0, variance: 0 };
    var list = Object.keys(rows).sort().map(function (a) {
      var r = rows[a];
      var override = m.etc && m.etc[a];
      r.etc = override != null && override !== '' ? num(override)
        : Math.max(0, r.budget - r.actual - r.committed);   // default: spend the plan, no more
      r.efc = Math.round(r.actual + r.committed + r.etc);
      r.variance = Math.round(r.budget - r.efc);
      r.over = r.variance < 0;
      ['budget', 'actual', 'committed', 'etc', 'efc', 'variance'].forEach(function (k) { totals[k] += r[k]; });
      return r;
    });
    totals.over = totals.variance < 0;
    return { rows: list, totals: totals,
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

  function csv(report) {
    var lines = ['Acct,Category,Budget,Actual,Committed,ETC,EFC,Variance'];
    report.rows.forEach(function (r) {
      lines.push([csvCell(r.acct), csvCell(r.name),
        r.budget, r.actual, r.committed, r.etc, r.efc, r.variance].join(','));
    });
    var t = report.totals;
    lines.push(['TOTAL', '', t.budget, t.actual, t.committed, t.etc, t.efc, t.variance].join(','));
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
    snapshot: snapshot, csv: csv, feedLearning: feedLearning
  };
})(typeof window !== 'undefined' ? window : globalThis);
