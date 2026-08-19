/* Cinamate Tools — money tabs: Timecards, Hot Costs, Finance Waterfall.
 * UI over TMoney. All original code, written for Cinamate.
 */
(function (root) {
  'use strict';
  var C = root.TCore, M = root.TMoney, esc = C.esc, fm = C.fmtMoney, num = C.num;
  root.TTabs = root.TTabs || {};

  /* ── Timecards ────────────────────────────────────────────────── */
  root.TTabs.timecards = function () {
    var el = C.$('pane-timecards');
    el.innerHTML = '<h2>Union Timecard Calculator</h2>' +
      '<p class="tk-desc">Call and wrap in, gross pay out — film overtime conventions built in: 1.5× after 8 worked hours, 2× after 12 elapsed, golden time 3× after 15, meal penalties, forced-call turnaround, 6th/7th-day premiums and fringes. Rules are editable to match your agreement. A planning tool, not payroll.</p>' +
      '<div class="tk-grid">' +
      f('tcName', 'Crew member', 'text', '') +
      f('tcRate', 'Hourly rate ($)', 'text', '50') +
      f('tcCall', 'Call', 'time', '06:00') +
      f('tcWrap', 'Wrap', 'time', '18:30') +
      sel('tcMeals', 'Meals taken', ['0', '1', '2'], '1') +
      f('tcFirstMeal', 'First meal at (hrs after call)', 'text', '5.5') +
      sel('tcDow', 'Day', ['Weekday', '6th consecutive day', '7th consecutive day'], 'Weekday') +
      f('tcPrevWrap', "Yesterday's wrap (optional)", 'time', '') +
      f('tcFringe', 'Fringe %', 'text', '28') +
      '</div>' +
      '<div class="tk-bar"><button class="tb-btn gold" id="tcCalc">Calculate</button>' +
      '<button class="tb-btn" id="tcLog">Save to day log</button></div>' +
      '<div id="tcOut"></div><div id="tcLogWrap" style="margin-top:16px"></div>' +
      '<p class="tk-note">Crew names and rates auto-suggest from the Crew directory. Defaults follow the published 12-hour-day convention; productions on different sideletters should edit the thresholds in the fields above.</p>';

    function f(id, label, type, val) {
      return '<div class="tk-field"><label>' + esc(label) + '</label><input id="' + id + '" type="' + type + '" value="' + esc(val) + '"></div>';
    }
    function sel(id, label, opts, val) {
      return '<div class="tk-field"><label>' + esc(label) + '</label><select id="' + id + '">' +
        opts.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
    }
    function calc() {
      var dow = { 'Weekday': 3, '6th consecutive day': 6, '7th consecutive day': 7 }[C.$('tcDow').value];
      var fm1 = C.$('tcFirstMeal').value.trim();
      var res = M.timecard({
        rate: num(C.$('tcRate').value), call: C.$('tcCall').value, wrap: C.$('tcWrap').value,
        mealsTaken: parseInt(C.$('tcMeals').value, 10) || 0,
        firstMealAtHr: fm1 === '' ? null : num(fm1),
        dayOfWeek: dow, prevWrap: C.$('tcPrevWrap').value || null,
        rules: { fringePct: num(C.$('tcFringe').value) / 100 }
      });
      var out = C.$('tcOut');
      if (res.error) { out.innerHTML = '<div class="tk-result">⚠ ' + esc(res.error) + '</div>'; return null; }
      var h = '<div class="tk-result"><div>Elapsed <b>' + res.elapsed + 'h</b> · worked <b>' + res.worked + 'h</b></div>';
      h += '<table class="bud-table" style="margin-top:8px"><tbody>';
      res.lines.forEach(function (l) {
        if (l.hours || l.pay) h += '<tr><td>' + esc(l.label) + '</td><td class="bud-r">' + (l.hours ? l.hours + 'h' : '') + '</td><td class="bud-r">' + fm(l.pay) + '</td></tr>';
      });
      res.penaltyLines.forEach(function (l) {
        h += '<tr><td style="color:var(--red)">' + esc(l.label) + '</td><td></td><td class="bud-r" style="color:var(--red)">' + fm(l.pay) + '</td></tr>';
      });
      h += '<tr><td>Fringes (' + Math.round(res.fringePct * 100) + '%)</td><td></td><td class="bud-r">' + fm(res.fringes) + '</td></tr>';
      h += '</tbody></table><div class="big" style="margin-top:8px">' + fm(res.total) + '</div></div>';
      out.innerHTML = h;
      return res;
    }
    C.$('tcCalc').onclick = calc;

    var log = new C.Register({
      key: 'SB_Timecards_v1',
      fields: [
        { id: 'date', label: 'Date', type: 'date', width: '130px' },
        { id: 'name', label: 'Name' }, { id: 'call', label: 'Call', width: '70px' },
        { id: 'wrap', label: 'Wrap', width: '70px' }, { id: 'hours', label: 'Worked', width: '70px' },
        { id: 'total', label: 'Total ($)', width: '90px' }, { id: 'notes', label: 'Notes' }
      ],
      summary: function (rows) {
        var t = rows.reduce(function (s, r) { return s + num(r.total); }, 0);
        return '<b>' + rows.length + '</b> timecards logged · gross+fringe total <b>' + fm(t) + '</b>';
      }
    });
    log.render('tcLogWrap');
    C.$('tcLog').onclick = function () {
      var res = calc();
      if (!res) return;
      log.add({ date: C.today(), name: C.$('tcName').value, call: C.$('tcCall').value, wrap: C.$('tcWrap').value, hours: res.worked, total: res.total, notes: '' });
      log.render('tcLogWrap');
      C.toast('Timecard logged');
    };

    // rate autosuggest from crew directory
    var crew = C.load('SB_Crew_v1', []);
    if (crew.length) {
      C.$('tcName').setAttribute('list', 'tcNames');
      var dl = document.createElement('datalist');
      dl.id = 'tcNames';
      dl.innerHTML = crew.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join('');
      el.appendChild(dl);
      C.$('tcName').addEventListener('change', function () {
        var hit = crew.find(function (c) { return c.name === C.$('tcName').value; });
        if (hit && hit.rate) C.$('tcRate').value = hit.rate;
      });
    }
  };

  /* ── Hot Costs ────────────────────────────────────────────────── */
  root.TTabs.hotcosts = function () {
    var el = C.$('pane-hotcosts');
    el.innerHTML = '<h2>Hot Costs — Actuals vs Budget</h2>' +
      '<p class="tk-desc">Log spend and purchase orders against your top-sheet account codes; the report shows actual + committed against budget per account, the way a daily hot-cost report reads. Budget column seeds from your saved top sheet.</p>' +
      '<div id="hcPostWrap"></div>' +
      '<div class="tk-bar" style="margin-top:14px"><button class="tb-btn gold" id="hcSeed">Seed budget from top sheet</button><span class="ps-hint">Uses the Producer Suite Budget tab\'s saved sheet</span></div>' +
      '<div id="hcReport"></div>';

    var postings = new C.Register({
      key: 'SB_HotCost_v1',
      hint: 'kind: actual = invoiced/spent · PO = committed but not yet billed',
      fields: [
        { id: 'date', label: 'Date', type: 'date', width: '130px' },
        { id: 'acct', label: 'Acct', width: '70px' },
        { id: 'desc', label: 'Description' },
        { id: 'kind', label: 'Kind', type: 'select', options: ['actual', 'po'] },
        { id: 'amount', label: 'Amount ($)', width: '100px' }
      ],
      blank: function () { return { date: C.today(), kind: 'actual' }; }
    });
    function budgetByAcct() {
      var sheet = C.load('SB_BudgetSheet_v1', null);
      var by = {};
      if (sheet && sheet.categories) sheet.categories.forEach(function (cat) {
        var t = (cat.items || []).reduce(function (s, it) {
          var calc = num(it.amt) * num(it.units) * num(it.rate);
          return s + (calc > 0 ? calc : num(it.est));
        }, 0);
        if (t > 0) by[cat.acct] = t;
      });
      return by;
    }
    function report() {
      var hc = M.hotCost(postings.rows.map(function (r) { return { acct: r.acct, kind: r.kind, amount: num(r.amount) }; }), budgetByAcct());
      var h = '<div class="bud-tablewrap" style="margin-top:10px"><table class="bud-table"><thead><tr><th>Acct</th><th class="bud-r">Actual</th><th class="bud-r">Committed (PO)</th><th class="bud-r">Total</th><th class="bud-r">Budget</th><th class="bud-r">Variance</th><th class="bud-r">Used</th></tr></thead><tbody>';
      hc.rows.forEach(function (r) {
        h += '<tr><td>' + esc(r.acct) + '</td><td class="bud-r">' + fm(r.actual) + '</td><td class="bud-r">' + fm(r.committed) + '</td><td class="bud-r"><b>' + fm(r.total) + '</b></td><td class="bud-r">' + fm(r.budget) + '</td>' +
          '<td class="bud-r" style="color:var(--' + (r.variance >= 0 ? 'green' : 'red') + ')">' + (r.variance >= 0 ? '' : '−') + fm(Math.abs(r.variance)) + '</td>' +
          '<td class="bud-r">' + (r.pctUsed == null ? '—' : r.pctUsed + '%') + (r.pctUsed > 100 ? ' <span class="tk-chip bad">OVER</span>' : r.pctUsed > 85 ? ' <span class="tk-chip warn">HOT</span>' : '') + '</td></tr>';
      });
      var t = hc.totals;
      h += '<tr><td><b>TOTAL</b></td><td class="bud-r"><b>' + fm(t.actual) + '</b></td><td class="bud-r"><b>' + fm(t.committed) + '</b></td><td class="bud-r"><b>' + fm(t.total) + '</b></td><td class="bud-r"><b>' + fm(t.budget) + '</b></td>' +
        '<td class="bud-r"><b style="color:var(--' + (t.variance >= 0 ? 'green' : 'red') + ')">' + (t.variance >= 0 ? '' : '−') + fm(Math.abs(t.variance)) + '</b></td><td></td></tr>';
      h += '</tbody></table></div>';
      C.$('hcReport').innerHTML = h;
    }
    var origPersist = postings.persist.bind(postings);
    postings.persist = function () { origPersist(); report(); };
    postings.render('hcPostWrap');
    C.$('hcSeed').onclick = function () {
      var by = budgetByAcct();
      C.toast(Object.keys(by).length ? 'Budget loaded for ' + Object.keys(by).length + ' accounts' : 'No saved top sheet found — fill the Budget tab first');
      report();
    };
    report();
  };

  /* ── Finance waterfall instruments ────────────────────────────── */
  root.TTabs.finance = function () {
    var el = C.$('pane-finance');
    el.innerHTML = '<h2>Finance Waterfall — Instruments</h2>' +
      '<p class="tk-desc">Layer real investor mechanics onto a lifetime-revenue number: deferrals first, then each class recoups with its premium, then the pool splits by corridor. Take the lifetime figure from the Sales tab\'s waterfall.</p>' +
      '<div id="fwClasses"></div><div id="fwDefs" style="margin-top:12px"></div>' +
      '<div class="tk-grid" style="margin-top:12px"><div class="tk-field"><label>Distributable lifetime revenue ($)</label><input id="fwLifetime" value="3,000,000"></div></div>' +
      '<div class="tk-bar"><button class="tb-btn gold" id="fwRun">Run waterfall</button></div>' +
      '<div id="fwOut"></div>';

    var classes = new C.Register({
      key: 'SB_FinClasses_v1',
      hint: 'premium 0.2 = 120% recoupment · corridor 0.5 = 50% of the post-recoup pool',
      fields: [
        { id: 'name', label: 'Class' }, { id: 'invested', label: 'Invested ($)', width: '110px' },
        { id: 'premiumPct', label: 'Premium (0–1)', width: '100px' }, { id: 'corridorPct', label: 'Corridor (0–1)', width: '100px' }
      ],
      blank: function () { return { name: 'Class A equity', invested: '1000000', premiumPct: '0.2', corridorPct: '0.5' }; }
    });
    classes.render('fwClasses');
    var defs = new C.Register({
      key: 'SB_FinDefs_v1',
      hint: 'Deferrals pay before equity recoupment.',
      fields: [{ id: 'name', label: 'Deferral' }, { id: 'amount', label: 'Amount ($)', width: '110px' }]
    });
    defs.render('fwDefs');
    C.$('fwRun').onclick = function () {
      var wf = M.instrumentWaterfall(num(C.$('fwLifetime').value),
        classes.rows.map(function (r) { return { name: r.name, invested: num(r.invested), premiumPct: num(r.premiumPct), corridorPct: num(r.corridorPct) }; }),
        defs.rows.map(function (r) { return { name: r.name, amount: num(r.amount) }; }));
      var h = '<div class="bud-tablewrap" style="margin-top:10px"><table class="bud-table"><thead><tr><th>Step</th><th class="bud-r">Due</th><th class="bud-r">Paid</th></tr></thead><tbody>';
      wf.steps.forEach(function (s) {
        var short = s.paid < s.due - 0.01;
        h += '<tr><td>' + esc(s.step) + '</td><td class="bud-r">' + fm(s.due) + '</td><td class="bud-r"' + (short ? ' style="color:var(--red)"' : '') + '>' + fm(s.paid) + (short ? ' ⚠' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="tk-result">Post-recoupment pool <b>' + fm(wf.pool) + '</b> · producer/talent net <span class="big">' + fm(wf.producerNet) + '</span>' +
        (wf.breakeven ? ' <span class="tk-chip good">ALL CLASSES WHOLE</span>' : ' <span class="tk-chip bad">SHORTFALL</span>') + '</div>';
      C.$('fwOut').innerHTML = h;
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
