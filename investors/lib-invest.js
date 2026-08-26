/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Investor Room engine (CInvest)
   The standard indie recoupment waterfall, run exactly: sales fee and
   off-the-top expenses first, then debt principal + simple interest, then
   gap principal + interest, then equity principal + premium (default 20%),
   then the classic 50/50 producer/investor backend split — the investor
   pool shared by explicit backend percentages or pro-rata by amount.
   Every distribution reconciles to the cent against gross receipts.
   Pure logic, no DOM, no storage.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(v) { return Math.round(num(v) * 100) / 100; }
  function fmt(v) {
    var n = r2(v), neg = n < 0; if (neg) n = -n;
    var s = n.toFixed(2).replace(/\.00$/, '');
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts.join('.');
  }

  var KINDS = ['equity', 'debt', 'gap'];

  /* Normalize one investor record — defaults exactly as the terms sheet
     reads: equity premium 20% unless stated, interest 0 unless stated,
     backendPct null (= pro-rata) unless the user typed a number. */
  function normalize(inv) {
    var o = inv || {};
    var kind = KINDS.indexOf(o.kind) >= 0 ? o.kind : 'equity';
    return {
      id: o.id || '', name: String(o.name || 'Unnamed investor'), kind: kind,
      amount: Math.max(0, num(o.amount)),
      interestPct: Math.max(0, num(o.interestPct)),
      premiumPct: (o.premiumPct == null || o.premiumPct === '') ? 20 : Math.max(0, num(o.premiumPct)),
      backendPct: (o.backendPct == null || o.backendPct === '') ? null : Math.max(0, num(o.backendPct)),
      contact: String(o.contact || ''), notes: String(o.notes || '')
    };
  }

  function normOpts(opts) {
    var o = opts || {};
    return {
      salesFeePct: (o.salesFeePct == null || o.salesFeePct === '') ? 15 : Math.max(0, num(o.salesFeePct)),
      expensesOffTop: Math.max(0, num(o.expensesOffTop)),
      years: num(o.years) > 0 ? num(o.years) : 1
    };
  }

  /* What each investor is owed through the recoupment tiers (before backend).
     Simple annual interest for debt/gap; flat premium for equity. */
  function owed(inv, years) {
    var n = normalize(inv);
    if (n.kind === 'debt' || n.kind === 'gap') {
      var interest = r2(n.amount * (n.interestPct / 100) * years);
      return { principal: n.amount, ret: interest, total: r2(n.amount + interest) };
    }
    var premium = r2(n.amount * (n.premiumPct / 100));
    return { principal: n.amount, ret: premium, total: r2(n.amount + premium) };
  }

  /* Cap table rollup: totals by class + backend mode. */
  function capTable(investors, opts) {
    var o = normOpts(opts);
    var by = { equity: 0, debt: 0, gap: 0 }, owedBy = { equity: 0, debt: 0, gap: 0 };
    var raised = 0, explicitBackend = false;
    (investors || []).forEach(function (raw) {
      var n = normalize(raw);
      by[n.kind] += n.amount; raised += n.amount;
      owedBy[n.kind] = r2(owedBy[n.kind] + owed(n, o.years).total);
      if (n.backendPct !== null && n.backendPct > 0) explicitBackend = true;
    });
    return { raised: r2(raised), byKind: by, owedByKind: owedBy, explicitBackend: explicitBackend };
  }

  /* Split `pool` across weights, rounded to cents, summing EXACTLY to r2(pool):
     the rounding residue lands on the largest weight. */
  function allocate(pool, weights) {
    pool = r2(pool);
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var out = [], sum = 0, maxI = 0;
    if (!(total > 0) || !(pool > 0)) { for (i = 0; i < weights.length; i++) out.push(0); return out; }
    for (i = 0; i < weights.length; i++) {
      out.push(r2(pool * weights[i] / total));
      sum = r2(sum + out[i]);
      if (weights[i] > weights[maxI]) maxI = i;
    }
    out[maxI] = r2(out[maxI] + r2(pool - sum));
    return out;
  }

  /* ── the waterfall ──────────────────────────────────────────────────────
     Order: (1) sales fee + expenses off the top → (2) debt principal +
     interest → (3) gap principal + interest → (4) equity principal +
     premium → (5) remaining profit 50/50 producer / investor pool.
     Shortfalls inside a tier pay pro-rata by what each is owed.           */
  function waterfall(investors, grossReceipts, opts) {
    var o = normOpts(opts);
    var gross = r2(Math.max(0, num(grossReceipts)));
    var fee = r2(gross * o.salesFeePct / 100);
    if (fee > gross) fee = gross;
    var expenses = r2(Math.min(o.expensesOffTop, r2(gross - fee)));
    var pool = r2(gross - fee - expenses);

    var rows = (investors || []).map(function (raw) {
      var n = normalize(raw);
      return { id: n.id, name: n.name, kind: n.kind, invested: n.amount,
               owed: owed(n, o.years).total, backendPct: n.backendPct,
               recouped: 0, profit: 0, total: 0, pctOfInvestment: 0, multiple: 0 };
    });

    var tiers = {};
    ['debt', 'gap', 'equity'].forEach(function (kind) {
      var idx = [], weights = [], owedTotal = 0;
      rows.forEach(function (r, i) {
        if (r.kind !== kind) return;
        idx.push(i); weights.push(r.owed); owedTotal = r2(owedTotal + r.owed);
      });
      var pay = r2(Math.min(pool, owedTotal));
      var cuts = allocate(pay, weights);
      idx.forEach(function (ri, j) { rows[ri].recouped = cuts[j]; });
      pool = r2(pool - pay);
      tiers[kind] = { owed: owedTotal, paid: pay };
    });

    /* (5) profit: 50% producer, 50% investor pool */
    var remaining = pool;
    var producerProfit = r2(remaining * 0.5);
    var investorPool = r2(remaining - producerProfit);
    var undistributed = 0;

    var explicitMode = rows.some(function (r) { return r.backendPct !== null && r.backendPct > 0; });
    var shares = rows.map(function (r) {
      if (explicitMode) return r.backendPct !== null ? r.backendPct : 0;
      return r.invested;                                   /* pro-rata by amount */
    });
    var shareSum = 0; shares.forEach(function (s) { shareSum += s; });
    var coverage = 1;
    if (explicitMode) coverage = shareSum > 100 ? 1 : shareSum / 100;   /* >100 scales down, <100 leaves a remainder */
    var paidPool = shareSum > 0 ? r2(investorPool * coverage) : 0;
    var cuts = allocate(paidPool, shares);
    rows.forEach(function (r, i) { r.profit = cuts[i]; });
    undistributed = r2(investorPool - paidPool);

    var totals = { recouped: 0, profit: 0, total: 0 };
    rows.forEach(function (r) {
      r.total = r2(r.recouped + r.profit);
      r.pctOfInvestment = r.invested > 0 ? r2(r.total / r.invested * 100) : 0;
      r.multiple = r.invested > 0 ? r2(r.total / r.invested) : 0;
      totals.recouped = r2(totals.recouped + r.recouped);
      totals.profit = r2(totals.profit + r.profit);
      totals.total = r2(totals.total + r.total);
    });

    return {
      gross: gross, salesFee: fee, expenses: expenses,
      net: r2(gross - fee - expenses),
      rows: rows, tiers: tiers, totals: totals,
      producerProfit: producerProfit, investorPool: investorPool,
      undistributed: undistributed,
      /* reconciliation: total distributed + producer + undistributed = net */
      distributed: r2(totals.total + producerProfit + undistributed)
    };
  }

  /* ── breakeven ──────────────────────────────────────────────────────────
     Gross receipts needed for FULL equity recoupment (tiers 2-4 paid out).
     Solved directly: net = gross·(1−f) − E must equal total owed, so
     gross = (owedTotal + E) / (1 − f). No iteration.                      */
  function breakeven(investors, opts) {
    var o = normOpts(opts);
    var owedTotal = 0;
    (investors || []).forEach(function (raw) { owedTotal = r2(owedTotal + owed(raw, o.years).total); });
    var f = o.salesFeePct / 100;
    if (f >= 1) return { gross: null, owedTotal: owedTotal, note: 'sales fee ≥ 100% — breakeven unreachable' };
    return { gross: r2((owedTotal + o.expensesOffTop) / (1 - f)), owedTotal: owedTotal, note: '' };
  }

  /* ── per-investor statement ───────────────────────────────────────────── */
  function statement(investor, waterfallRow, when) {
    var n = normalize(investor);
    var r = waterfallRow || { recouped: 0, profit: 0, total: 0, multiple: 0, pctOfInvestment: 0 };
    var kindLabel = n.kind === 'debt' ? 'Senior debt — ' + n.interestPct + '% simple annual interest'
      : n.kind === 'gap' ? 'Gap financing — ' + n.interestPct + '% simple annual interest'
      : 'Equity — ' + n.premiumPct + '% premium on recoupment';
    return 'INVESTOR STATEMENT — ' + n.name + '\n' +
      (when ? 'As of: ' + when + '\n' : '') +
      'Class: ' + kindLabel + '\n' +
      (n.contact ? 'Contact on file: ' + n.contact + '\n' : '') +
      '\n' +
      'Invested:            ' + fmt(n.amount) + '\n' +
      'Recouped to date:    ' + fmt(r.recouped) + '\n' +
      'Profit share:        ' + fmt(r.profit) + '\n' +
      'Total returned:      ' + fmt(r.total) + '\n' +
      'Multiple:            ' + (r.multiple || 0).toFixed(2) + 'x  (' + (r.pctOfInvestment || 0).toFixed(1) + '% of investment)\n' +
      '\n' +
      'Figures are modeled by the CINAMATE waterfall simulator at the receipts\n' +
      'entered — an estimate, not an audited accounting. Verify against the\n' +
      'executed financing agreements and collection-account statements before\n' +
      'relying on any number here.' +
      (n.notes ? '\n\nNotes: ' + n.notes : '');
  }

  /* Budget grand total from an SB_BudgetSheet_v1-shaped sheet.
     Read through the one line-item reader (js/lib-money-sheet.js): summing the
     stored `est` alone missed every line the Producer Suite's Amt x Units x
     Rate calculator wrote, which returned 0 for a fully built budget — and the
     quarterly letter then told the investors the picture was over budget by
     its entire spend, because variance is budget minus EFC. */
  function budgetTotal(sheet) {
    var S = root.CBudgetSheet;
    if (!S) throw new Error('investors/lib-invest.js requires js/lib-money-sheet.js');
    return r2(S.subtotal(sheet));
  }

  /* ── quarterly update letter ────────────────────────────────────────────
     Engine stays pure: the page reads localStorage and passes budgetTotal /
     efc / receipts in. Nothing time-drifting is invented — the period and
     date come from the user, and money figures are labeled as estimates.  */
  function updateLetter(fields) {
    var f = fields || {};
    var cap = capTable(f.investors || [], f.opts);
    var be = breakeven(f.investors || [], f.opts);
    var lines = [];
    lines.push('INVESTOR UPDATE — ' + (f.production || 'Untitled production'));
    if (f.period) lines.push('Period: ' + f.period);
    if (f.when) lines.push('Date: ' + f.when);
    lines.push('');
    lines.push('Dear investors,');
    lines.push('');
    lines.push('Here is our update on ' + (f.production || 'the production') + ' for ' + (f.period || 'this period') + '.');
    lines.push('');
    lines.push('FINANCING');
    lines.push(' - Total raised: ' + fmt(cap.raised) +
      ' (equity ' + fmt(cap.byKind.equity) + ' · debt ' + fmt(cap.byKind.debt) + ' · gap ' + fmt(cap.byKind.gap) + ')');
    if (be.gross != null) lines.push(' - Modeled breakeven for full recoupment: ' + fmt(be.gross) + ' gross receipts (estimate).');
    lines.push('');
    lines.push('BUDGET & COSTS');
    if (num(f.budgetTotal) > 0) lines.push(' - Working budget grand total: ' + fmt(f.budgetTotal) + ' (current estimate).');
    else lines.push(' - Working budget: not yet locked in the budgeting suite.');
    if (num(f.efc) > 0) {
      lines.push(' - Estimated Final Cost (Money Room cost report): ' + fmt(f.efc) + '.');
      if (num(f.budgetTotal) > 0) {
        var vari = r2(num(f.budgetTotal) - num(f.efc));
        lines.push(' - Variance vs budget: ' + fmt(vari) + (vari < 0 ? ' — projected OVER budget.' : ' — projected within budget.'));
      }
    } else {
      lines.push(' - Estimated Final Cost: no cost report on file yet.');
    }
    lines.push('');
    if (num(f.receipts) > 0) {
      lines.push('RECEIPTS');
      lines.push(' - Gross receipts reported to date: ' + fmt(f.receipts) + ' (as entered — verify against collection-account statements).');
      lines.push('');
    }
    if (f.highlights) {
      lines.push('PRODUCTION HIGHLIGHTS');
      String(f.highlights).split(/\r?\n/).forEach(function (h) { if (h.trim()) lines.push(' - ' + h.trim()); });
      lines.push('');
    }
    lines.push('All money figures above are estimates from our planning tools, not audited');
    lines.push('accounts — please verify before relying on them. Full statements are available');
    lines.push('on request.');
    lines.push('');
    lines.push('With thanks for your continued support,');
    lines.push((f.contact || '') + (f.contact && f.company ? '\n' : '') + (f.company || 'CINAMATE production office'));
    return lines.join('\n');
  }

  root.CInvest = {
    KINDS: KINDS, normalize: normalize, owed: owed, capTable: capTable,
    allocate: allocate, waterfall: waterfall, breakeven: breakeven,
    statement: statement, updateLetter: updateLetter,
    budgetTotal: budgetTotal, fmt: fmt, r2: r2
  };
})(typeof window !== 'undefined' ? window : globalThis);
