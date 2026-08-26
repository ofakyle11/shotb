/* CINAMATE Producer Suite — Budget Top Sheet (our own take on the Movie
 * Magic / CineSpend workflow, implemented from scratch for the web).
 *
 * Three-level hierarchy: Top Sheet → account categories → line items with
 * an Amt × Units × Rate calculator, estimated vs actual columns, automatic
 * contingency, and one-click seeding from the script-driven estimator
 * (SBBudget). Autosaves to localStorage; save/load as .json; print for PDF. */
(function (root) {
  'use strict';

  var KEY = 'SB_BudgetSheet_v1';

  function MM() {
    var m = root.CMoneyMath;
    if (!m) throw new Error('producer/budget-sheet.js requires js/lib-money-math.js');
    return m;
  }
  function SHEET() {
    var s = root.CBudgetSheet;
    if (!s) throw new Error('producer/budget-sheet.js requires js/lib-money-sheet.js');
    return s;
  }

  /* Standard feature top-sheet skeleton with common starter line items.
     The account numbers are the platform's one chart (js/lib-money-accounts.js)
     — the same chart the deal memos, the casting office, VFX and the cost
     report post against. */
  var DEFAULT_CATEGORIES = [
    { acct: '1000',  name: 'Story & Rights',      items: ['Option / purchase', 'Screenplay / writer fees'] },
    { acct: '2000',  name: 'Producers Unit',      items: ['Producer fee', 'Line producer / UPM'] },
    { acct: '3000',  name: 'Direction',           items: ['Director fee'] },
    { acct: '4000',  name: 'Cast',                items: ['Leads', 'Supporting cast', 'Day players', 'Background & extras', 'Casting director', 'Cast fringes'] },
    { acct: '5000',  name: 'Production Staff',    items: ['ADs & production office', 'Script supervisor', 'PAs'] },
    { acct: '6000',  name: 'Camera',              items: ['Camera crew', 'Camera package rental'] },
    { acct: '7000',  name: 'Sound',               items: ['Sound mixer & boom', 'Sound package'] },
    { acct: '8000',  name: 'Grip & Electric',     items: ['G&E crew', 'G&E package & truck'] },
    { acct: '9000',  name: 'Art Department',      items: ['Production designer & crew', 'Set dressing & props', 'Stunts / SFX units'] },
    { acct: '10000', name: 'Wardrobe',            items: ['Costume designer & crew', 'Purchases & rentals'] },
    { acct: '11000', name: 'Makeup & Hair',       items: ['HMU crew', 'Supplies'] },
    { acct: '12000', name: 'Transportation',      items: ['Drivers & vehicles', 'Fuel & parking'] },
    { acct: '13000', name: 'Locations',           items: ['Location fees', 'Permits', 'Travel & living'] },
    { acct: '14000', name: 'Media & Stock',       items: ['Storage / media', 'Expendables'] },
    { acct: '15000', name: 'Post-Production',     items: ['Editorial', 'VFX', 'Sound design & mix', 'Music', 'Color / DI'] },
    { acct: '16000', name: 'Insurance & Legal',   items: ['Production insurance', 'Legal & finance', 'Completion bond'] },
    { acct: '17000', name: 'Publicity',           items: ['Unit publicist / stills'] },
    { acct: '18000', name: 'General Expenses',    items: ['Production office', 'Miscellaneous'] },
    /* Fringes are cross-departmental and belong on their own line. They used
       to sit inside General Expenses, where an unprefixed estimator line
       ($397k-$709k on an indie) also landed by accident — an account whose
       whole job is to be ~4% of BTL, reading five times the entire rest of it. */
    { acct: '20000', name: 'Payroll Fringes',     items: ['Payroll fringes (labor accounts)'] }
  ];

  /* Estimator account → top-sheet category routing for seeding: the chart's
     own rollup, so a detail account has exactly one home. */
  function seedTarget(acct) {
    var A = root.CAccounts;
    return A ? A.rollup(acct) : acct;
  }

  var _uid = 0;
  function uid() { return 'li' + (++_uid) + '_' + Math.random().toString(36).slice(2, 7); }

  function blankItem(desc) {
    return { id: uid(), desc: desc || 'New line item', amt: '', units: '', rate: '', est: 0, actual: 0, notes: '' };
  }

  function blankSheet() {
    return {
      name: 'Untitled Budget',
      preparedBy: '',
      contingencyPct: 10,
      categories: DEFAULT_CATEGORIES.map(function (c) {
        return { acct: c.acct, name: c.name, items: c.items.map(function (d) { return blankItem(d); }) };
      })
    };
  }

  function num(v) { return MM().num(v); }

  /* Amt × Units × Rate wins when all three are set; manual estimate otherwise.
     The rule lives in js/lib-money-sheet.js so finance, investors, the Advisor
     and the learning layer read a line item exactly the way the calculator
     wrote it — five readers summing `est` alone is why a fully built budget
     read $0 everywhere outside this page. */
  function itemEst(it) { return SHEET().itemEst(it); }
  function catTotals(cat) { return SHEET().catTotals(cat); }

  function sheetTotals(sheet) {
    var M = MM(), S = SHEET();
    var sub = S.subtotalCents(sheet);
    var act = S.actualCents(sheet);
    var laborBase = S.laborBaseCents(sheet);
    var fringes = M.pctOfCents(laborBase, sheet.fringesPct);
    var bond = M.pctOfCents(sub, sheet.bondPct);
    var insurance = M.pctOfCents(sub, sheet.insurancePct);
    var basis = sub + fringes + bond + insurance;
    var cont = M.pctOfCents(basis, sheet.contingencyPct);
    return { subtotal: M.dollars(sub), fringes: M.dollars(fringes),
             bond: M.dollars(bond), insurance: M.dollars(insurance),
             contingency: M.dollars(cont), grand: M.dollars(basis + cont),
             actual: M.dollars(act) };
  }

  /* ── line-producer brain: fringes, bond/insurance, norms, cashflow ──
     Labor accounts carry payroll fringes (union H&P + payroll taxes);
     bond and insurance quote as a % of the direct subtotal. All default
     to 0 so sheets that already carry fringe line items never double up.
     Which accounts are labour is the chart's call, not a second list here. */
  function extras(sheet) {
    var M = MM(), S = SHEET();
    var laborBase = S.laborBaseCents(sheet);
    var sub = S.subtotalCents(sheet);
    return {
      laborBase: M.dollars(laborBase),
      fringes: M.dollars(M.pctOfCents(laborBase, sheet.fringesPct)),
      bond: M.dollars(M.pctOfCents(sub, sheet.bondPct)),
      insurance: M.dollars(M.pctOfCents(sub, sheet.insurancePct))
    };
  }

  /* Typical share of the grand total per account — decades of published
     top sheets distilled into bands. Outside the band isn't wrong, it's
     a question the bond company will ask. */
  var NORMS = { '1000': [1, 8], '2000': [3, 9], '3000': [2, 8], '4000': [8, 30],
    '5000': [3, 10], '6000': [3, 9], '7000': [1, 3.5], '8000': [3, 9],
    '9000': [3, 12], '10000': [1, 4], '11000': [0.5, 3], '12000': [2, 7],
    '13000': [3, 11], '14000': [0.3, 2.5], '15000': [7, 18], '16000': [2, 7],
    '17000': [0.3, 2], '18000': [2, 7], '20000': [8, 25] };
  function norms(sheet) {
    var tot = sheetTotals(sheet);
    if (!(tot.grand > 0)) return [];
    return sheet.categories.map(function (c) {
      var pct = catTotals(c).est / tot.grand * 100;
      var band = NORMS[c.acct];
      return { acct: c.acct, name: c.name, pct: Math.round(pct * 10) / 10,
        lo: band ? band[0] : null, hi: band ? band[1] : null,
        flag: band && pct > 0 ? (pct < band[0] ? 'low' : pct > band[1] ? 'high' : 'ok') : 'ok' };
    });
  }

  /* When each account's money actually leaves the bank: prep/shoot/post. */
  var PHASE = { '1000': [1, 0, 0], '2000': [.4, .4, .2], '3000': [.3, .5, .2],
    '4000': [.1, .8, .1], '5000': [.25, .65, .1], '6000': [.1, .85, .05],
    '7000': [.1, .85, .05], '8000': [.1, .85, .05], '9000': [.5, .45, .05],
    '10000': [.6, .35, .05], '11000': [.1, .85, .05], '12000': [.2, .7, .1],
    '13000': [.4, .5, .1], '14000': [.2, .6, .2], '15000': [0, .05, .95],
    '16000': [.7, .2, .1], '17000': [.2, .3, .5], '18000': [.3, .4, .3],
    '20000': [.15, .7, .15] };   /* fringes follow the labour they sit on */
  /* Cash needed by phase, in cents: the three buckets must add back to the
     grand total exactly, or the producer's cashflow plan is short by the
     rounding. The last bucket absorbs the remainder for that reason. */
  function cashflow(sheet) {
    var M = MM(), S = SHEET();
    var prep = 0, shoot = 0, post = 0;
    (sheet.categories || []).forEach(function (c) {
      var est = S.catCents(c).est;
      var ph = PHASE[c.acct] || [.33, .34, .33];
      prep += M.mulCents(est, ph[0]);
      shoot += M.mulCents(est, ph[1]);
      post += M.mulCents(est, ph[2]);
    });
    var overhead = M.cents(sheetTotals(sheet).grand) - (prep + shoot + post);
    var half = M.mulCents(overhead, 0.5);            // contingency + extras ride shoot/post
    shoot += half;
    post += overhead - half;                         // remainder here, so the three foot
    return { prep: M.dollars(prep), shoot: M.dollars(shoot), post: M.dollars(post) };
  }

  /* Seed the estimated column from SBBudget's script-driven estimate
   * (midpoint of each line's low–high range). */
  function seedFromEstimate(sheet, prod) {
    var M = MM();
    var byAcct = {};
    sheet.categories.forEach(function (c) { byAcct[c.acct] = c; });
    sheet.categories.forEach(function (c) { c.items = []; });
    Object.keys(prod.groups).forEach(function (gname) {
      var g = prod.groups[gname];
      Object.keys(g).forEach(function (label) {
        var range = g[label];
        if (!range || range[1] <= 0) return;
        var m = label.match(/^(\d{4,5})\s*·\s*(.+)$/);
        var acct = m ? m[1] : null, desc = m ? m[2] : label;
        /* Only contingency is skipped — it is computed from the subtotal below.
           9900 (Stunts, SFX & special units) used to be dropped here too, so a
           script with fire, water, animals or a fight lost the entire special
           units line out of its seeded budget; it rolls into 9000 like any
           other detail account. */
        if (acct === '19000') return;
        var target = byAcct[seedTarget(acct)] || byAcct[acct] || byAcct['18000'];
        var it = blankItem(desc);
        it.est = M.dollars(M.mulCents(M.cents(range[0]) + M.cents(range[1]), 0.5));
        it.notes = 'est. range ' + SBBudget.fmtMoney(range[0]) + ' – ' + SBBudget.fmtMoney(range[1]);
        // learning loop: past actuals on this account correct the estimate
        var cal = (root.CLearn && root.CLearn.calibration) ? root.CLearn.calibration(target.acct) : null;
        if (cal && cal.n >= 2 && cal.mult !== 1) {
          it.est = M.mul(it.est, cal.mult);
          it.notes += ' · calibrated ' + (cal.mult > 1 ? '+' : '') + Math.round((cal.mult - 1) * 100) + '% from ' + cal.n + ' past actuals';
        }
        target.items.push(it);
      });
    });
    sheet.contingencyPct = 10;
    return sheet;
  }

  /* CSV export — one row per line item plus category subtotals and the
   * sheet totals; opens clean in Excel / Sheets. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    /* A leading = + - @ makes a spreadsheet treat the cell as a formula, so a
       budget line typed here could run on the machine of whoever opens it. */
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /* Money columns are fixed 2-decimal strings, never raw JS floats — an
     `amt × units × rate` of 3 × 5 × 1061.64 is 15924.6, and a raw float writes
     `15924.599999999999` into the cell the producer then sums. */
  function sheetToCsv(sheet) {
    var M = MM();
    var $$ = function (v) { return M.csvNum(v); };
    var opt = function (v) { return M.cents(v) ? M.csvNum(v) : ''; };
    var rows = [['Account', 'Category', 'Line item', 'Amt', 'Units', 'Rate', 'Estimated', 'Actual', 'Notes']];
    sheet.categories.forEach(function (c) {
      (c.items || []).forEach(function (it) {
        rows.push([c.acct, c.name, it.desc, it.amt, it.units, it.rate, $$(itemEst(it)), opt(it.actual), it.notes]);
      });
      var t = catTotals(c);
      if (M.cents(t.est) || M.cents(t.actual)) {
        rows.push([c.acct, c.name, 'SUBTOTAL', '', '', '', $$(t.est), opt(t.actual), '']);
      }
    });
    var tot = sheetTotals(sheet);
    rows.push(['', '', 'SUBTOTAL (all categories)', '', '', '', $$(tot.subtotal), opt(tot.actual), '']);
    if (M.cents(tot.fringes)) rows.push(['20000', 'Payroll Fringes', sheet.fringesPct + '% on labor', '', '', '', $$(tot.fringes), '', '']);
    if (M.cents(tot.bond)) rows.push(['16800', 'Completion bond', sheet.bondPct + '%', '', '', '', $$(tot.bond), '', '']);
    if (M.cents(tot.insurance)) rows.push(['16000', 'Insurance', sheet.insurancePct + '%', '', '', '', $$(tot.insurance), '', '']);
    rows.push(['19000', 'Contingency', sheet.contingencyPct + '%', '', '', '', $$(tot.contingency), '', '']);
    rows.push(['', '', 'GRAND TOTAL', '', '', '', $$(tot.grand), '', '']);
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  /* ── persistence ─────────────────────────────────────────────────── */
  var sheet = null;
  var selected = 0;
  var saveTimer = null;

  function load() {
    try { var d = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null'); if (d && d.categories) return d; } catch (e) {}
    return blankSheet();
  }
  function persist() {
    /* Store the number the calculator computed, not just the inputs. The sheet
       on disk then says what it means to any reader — including one written
       before js/lib-money-sheet.js existed. */
    try { SHEET().syncEst(sheet); } catch (e) {}
    if (root.CLearn && root.CLearn.learnBudget) { try { root.CLearn.learnBudget(sheet); } catch (e) {} }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(sheet)); } catch (e) {}
    }, 300);
  }

  /* ── rendering ───────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function fm(n) { return SBBudget.fmtMoney(n); }

  function renderTopSheet() {
    var el = $('bsTopSheet');
    if (!el) return;
    var tot = sheetTotals(sheet);
    var h = '<div class="bs-head">' +
      '<input id="bsName" value="' + esc(sheet.name) + '" title="Budget title">' +
      '<div class="bs-sub">Prepared by <input id="bsPrep" value="' + esc(sheet.preparedBy) + '" placeholder="name">' +
      ' · Contingency <input id="bsCont" class="bs-cont" value="' + esc(sheet.contingencyPct) + '">%' +
      ' · Fringes <input id="bsFr" class="bs-cont" title="Payroll fringes on labor accounts (union H&P + payroll tax, typically 22–32%). Leave 0 if your sheet carries fringe line items." value="' + esc(sheet.fringesPct || 0) + '">%' +
      ' · Bond <input id="bsBond" class="bs-cont" title="Completion bond, typically ~2% of direct costs" value="' + esc(sheet.bondPct || 0) + '">%' +
      ' · Ins <input id="bsIns" class="bs-cont" title="Production insurance, typically 2–3% of direct costs" value="' + esc(sheet.insurancePct || 0) + '">%</div></div>';
    var normRows = norms(sheet);
    sheet.categories.forEach(function (c, i) {
      var t = catTotals(c);
      var pct = tot.grand > 0 ? Math.round(t.est / tot.grand * 100) : 0;
      var nr = normRows[i] || { flag: 'ok' };
      var flagHtml = '';
      if (t.est && nr.flag !== 'ok' && nr.lo != null) {
        flagHtml = '<b style="color:' + (nr.flag === 'high' ? '#E08A8A' : '#C9A86C') + '" title="typical ' + nr.lo + '–' + nr.hi + '% of budget — worth a second look">' + (nr.flag === 'high' ? '▲' : '▽') + '</b> ';
      }
      h += '<div class="bs-row' + (i === selected ? ' on' : '') + '" data-i="' + i + '">' +
        '<span class="bs-acct">' + esc(c.acct) + '</span>' +
        '<span class="bs-name">' + esc(c.name) + '</span>' +
        '<span class="bs-amt">' + (t.est ? fm(t.est) : '—') + '</span>' +
        '<span class="bs-pct">' + flagHtml + (t.est ? pct + '%' : '') + '</span></div>';
    });
    h += '<div class="bs-row bs-total-row"><span class="bs-acct"></span><span class="bs-name">Subtotal</span><span class="bs-amt">' + fm(tot.subtotal) + '</span><span class="bs-pct"></span></div>';
    if (tot.fringes) h += '<div class="bs-row bs-total-row"><span class="bs-acct"></span><span class="bs-name">Payroll fringes (' + esc(sheet.fringesPct) + '% on labor)</span><span class="bs-amt">' + fm(tot.fringes) + '</span><span class="bs-pct"></span></div>';
    if (tot.bond) h += '<div class="bs-row bs-total-row"><span class="bs-acct"></span><span class="bs-name">Completion bond (' + esc(sheet.bondPct) + '%)</span><span class="bs-amt">' + fm(tot.bond) + '</span><span class="bs-pct"></span></div>';
    if (tot.insurance) h += '<div class="bs-row bs-total-row"><span class="bs-acct"></span><span class="bs-name">Insurance (' + esc(sheet.insurancePct) + '%)</span><span class="bs-amt">' + fm(tot.insurance) + '</span><span class="bs-pct"></span></div>';
    h += '<div class="bs-row bs-total-row"><span class="bs-acct">19000</span><span class="bs-name">Contingency (' + esc(sheet.contingencyPct) + '%)</span><span class="bs-amt">' + fm(tot.contingency) + '</span><span class="bs-pct"></span></div>';
    h += '<div class="bs-row bs-grand"><span class="bs-acct"></span><span class="bs-name">GRAND TOTAL' + (tot.actual ? ' · actual ' + fm(tot.actual) : '') + '</span><span class="bs-amt">' + fm(tot.grand) + '</span><span class="bs-pct"></span></div>';
    if (tot.grand > 0) {
      var cf = cashflow(sheet);
      h += '<div class="bs-sub" style="margin-top:8px" title="When the money actually leaves the bank, by phase">CASH NEEDED — prep ' + fm(cf.prep) + ' · shoot ' + fm(cf.shoot) + ' · post ' + fm(cf.post) + '</div>';
      var flagged = norms(sheet).filter(function (n) { return n.flag !== 'ok'; }).length;
      if (flagged) h += '<div class="bs-sub" style="margin-top:2px">' + esc(flagged) + ' account' + (flagged === 1 ? '' : 's') + ' outside typical bands (▲ heavy · ▽ light) — hover the marker</div>';
      if (root.CMoney) {
        try {
          var money = JSON.parse((root.localStorage && root.localStorage.getItem('SB_Money_v1')) || 'null');
          if (money && (money.pos || []).length) {
            var repM = root.CMoney.costReport(sheet, money);
            h += '<div class="bs-sub" style="margin-top:2px"><a href="/finance/" style="color:inherit">MONEY ROOM — EFC ' + fm(repM.totals.efc) + ' · ' + (repM.totals.variance < 0 ? '<b style="color:#E08A8A">' + fm(-repM.totals.variance) + ' OVER</b>' : fm(repM.totals.variance) + ' under') + '</a></div>';
          }
        } catch (e) {}
      }
    }
    el.innerHTML = h;

    el.querySelectorAll('.bs-row[data-i]').forEach(function (row) {
      row.addEventListener('click', function () { selected = +row.dataset.i; renderTopSheet(); renderDetail(); });
    });
    var nameEl = $('bsName'), prepEl = $('bsPrep'), contEl = $('bsCont');
    if (nameEl) nameEl.addEventListener('change', function () { sheet.name = nameEl.value; persist(); });
    if (prepEl) prepEl.addEventListener('change', function () { sheet.preparedBy = prepEl.value; persist(); });
    if (contEl) contEl.addEventListener('change', function () { sheet.contingencyPct = Math.max(0, Math.min(30, num(contEl.value))); persist(); renderTopSheet(); });
    [['bsFr', 'fringesPct', 45], ['bsBond', 'bondPct', 6], ['bsIns', 'insurancePct', 8]].forEach(function (cfg) {
      var el2 = $(cfg[0]);
      if (el2) el2.addEventListener('change', function () {
        sheet[cfg[1]] = Math.max(0, Math.min(cfg[2], num(el2.value)));
        persist(); renderTopSheet();
      });
    });
  }

  function renderDetail() {
    var el = $('bsDetail');
    if (!el) return;
    var cat = sheet.categories[selected];
    if (!cat) { el.innerHTML = '<div class="ps-empty">Select a category on the left</div>'; return; }
    var t = catTotals(cat);
    var h = '<div class="bsd-title">' + esc(cat.acct) + ' · ' + esc(cat.name) + '</div>';
    h += '<table class="bsd-table"><thead><tr><th style="min-width:180px">Line item</th><th>Amt</th><th></th><th>Units</th><th></th><th>Rate</th><th style="text-align:right">Estimated</th><th style="text-align:right">Actual</th><th style="min-width:140px">Notes</th><th></th></tr></thead><tbody>';
    cat.items.forEach(function (it) {
      var calc = num(it.amt) > 0 && num(it.units) > 0 && num(it.rate) > 0;
      h += '<tr data-id="' + esc(it.id) + '">' +
        '<td><input class="bsd-desc" data-f="desc" value="' + esc(it.desc) + '"></td>' +
        '<td style="width:56px"><input data-f="amt" value="' + esc(it.amt) + '" placeholder="–"></td><td class="bsd-x">×</td>' +
        '<td style="width:56px"><input data-f="units" value="' + esc(it.units) + '" placeholder="–"></td><td class="bsd-x">×</td>' +
        '<td style="width:76px"><input data-f="rate" value="' + esc(it.rate) + '" placeholder="–"></td>' +
        '<td style="width:96px">' + (calc
          ? '<div class="bsd-tot" title="Amt × Units × Rate">' + fm(itemEst(it)) + '</div>'
          : '<input data-f="est" value="' + esc(num(it.est) || '') + '" placeholder="0">') + '</td>' +
        '<td style="width:96px"><input data-f="actual" value="' + esc(num(it.actual) || '') + '" placeholder="–"></td>' +
        '<td><input data-f="notes" value="' + esc(it.notes) + '" placeholder=""></td>' +
        '<td><button class="bsd-del" title="Delete line">✕</button></td></tr>';
    });
    h += '</tbody></table>';
    h += '<div class="bsd-foot"><button class="tb-btn" id="bsdAdd">+ Line item</button><span class="bsd-cat-tot">' + fm(t.est) + (t.actual ? ' · actual ' + fm(t.actual) : '') + '</span></div>';
    el.innerHTML = h;

    el.querySelectorAll('tr[data-id]').forEach(function (tr) {
      var it = cat.items.find(function (x) { return x.id === tr.dataset.id; });
      if (!it) return;
      tr.querySelectorAll('input[data-f]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          it[inp.dataset.f] = inp.value;
          persist();
          renderTopSheet();
          renderDetail();
        });
      });
      var del = tr.querySelector('.bsd-del');
      if (del) del.addEventListener('click', function () {
        cat.items = cat.items.filter(function (x) { return x.id !== it.id; });
        persist(); renderTopSheet(); renderDetail();
      });
    });
    var add = $('bsdAdd');
    if (add) add.addEventListener('click', function () { cat.items.push(blankItem()); persist(); renderDetail(); renderTopSheet(); });
  }

  /* ── toolbar ─────────────────────────────────────────────────────── */
  function estimatorPrefs() {
    try { return JSON.parse((root.localStorage && root.localStorage.getItem('SB_Budget_v1')) || 'null') || {}; } catch (e) { return {}; }
  }

  function wireToolbar() {
    var seed = $('bsSeed');
    if (seed) seed.addEventListener('click', function () {
      var st = root.psProjectState ? root.psProjectState() : {};
      if (!st.scriptText && !(st.clips || []).length) return root.psToast && psToast('No script in the timeline yet — import one first');
      var analysis = SBBudget.analyze(st);
      // Board feedback: real day assignments + breakdown tags from the
      // Schedule tab sharpen cast spans and special-unit day counts.
      var ov = (root.SBScheduleBoard && SBScheduleBoard.boardOverrides) ? SBScheduleBoard.boardOverrides() : {};
      var prod = SBBudget.estimateProduction(analysis, Object.assign({}, estimatorPrefs(), ov));
      seedFromEstimate(sheet, prod);
      if (sheet.name === 'Untitled Budget') sheet.name = (st.projectName || 'Untitled Film') + ' — budget';
      persist(); renderTopSheet(); renderDetail();
      var usedBoard = ov.castDood && Object.keys(ov.castDood).length;
      if (root.psToast) psToast('Seeded — ' + SBBudget.fmtMoney(sheetTotals(sheet).grand) + ' grand total' + (usedBoard ? ' (using your stripboard schedule' + (ov.unitOverrides ? ' + breakdown tags' : '') + ')' : ''));
    });
    var csv = $('bsCsv');
    if (csv) csv.addEventListener('click', function () {
      var blob = new Blob([sheetToCsv(sheet)], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (sheet.name || 'budget').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.csv';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
    var add = $('bsAddItem');
    if (add) add.addEventListener('click', function () { sheet.categories[selected].items.push(blankItem()); persist(); renderDetail(); renderTopSheet(); });
    var save = $('bsSave');
    if (save) save.addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(sheet, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (sheet.name || 'budget').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.budget.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
    var loadBtn = $('bsLoad'), file = $('bsFile');
    if (loadBtn && file) {
      loadBtn.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        var f = file.files[0]; file.value = '';
        if (!f) return;
        f.text().then(function (txt) {
          var d = JSON.parse(txt);
          if (!d || !Array.isArray(d.categories)) throw new Error('Not a budget file');
          sheet = d; selected = 0; persist(); renderTopSheet(); renderDetail();
          if (root.psToast) psToast('Loaded ' + (sheet.name || 'budget'));
        }).catch(function (e) { if (root.psToast) psToast('Load failed: ' + e.message); });
      });
    }
    var print = $('bsPrint');
    if (print) print.addEventListener('click', function () { window.print(); });
    var reset = $('bsReset');
    if (reset) reset.addEventListener('click', function () {
      if (!confirm('Start a new blank top sheet? The current sheet will be replaced (save it first if needed).')) return;
      sheet = blankSheet(); selected = 0; persist(); renderTopSheet(); renderDetail();
    });
  }

  function init() {
    if (!$('bsTopSheet')) return;
    sheet = load();
    try { SHEET().syncEst(sheet); } catch (e) {}   // heal sheets saved before est was stored
    if (root.CLearn && root.CLearn.learnBudget) { try { root.CLearn.learnBudget(sheet); } catch (e) {} }
    renderTopSheet();
    renderDetail();
    wireToolbar();
  }

  root.SBBudgetSheet = {
    init: init,
    // exposed for tests
    blankSheet: blankSheet,
    itemEst: itemEst,
    catTotals: catTotals,
    sheetTotals: sheetTotals,
    seedFromEstimate: seedFromEstimate,
    sheetToCsv: sheetToCsv,
    extras: extras, norms: norms, cashflow: cashflow,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES
  };
})(typeof window !== 'undefined' ? window : globalThis);
