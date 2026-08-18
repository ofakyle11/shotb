/* SHOTBREAK Producer Suite — Sales / Revenue Forecast engine.
 *
 * Philosophy (from surveying open-source box-office prediction work — see
 * docs/SALES_FORECAST.md): budget explains only ~40-60% of log-revenue
 * variance and even the best gradient-boosted models leave a P10-P90 band
 * of ~0.2x-6x, so this estimator forecasts QUANTILE BANDS, not a number.
 *
 * Leg 1 (this file, statistical): worldwide-gross quantiles calibrated on
 * 3,708 released features (TMDB 5000, budget >= $100k, revenue reported),
 * adjusted by the features the surveyed models agree matter: genre,
 * franchise/IP, star tier, release window, rating.
 * Leg 2 (waterfall): gross → producer net through the distribution
 * pipeline. Leg 3: independent-film territory pre-sales + streaming buyout
 * comparison. Rates documented in docs/SALES_FORECAST.md.
 */
(function (root) {
  'use strict';

  /* ── Calibrated revenue-multiple quantiles (worldwide gross ÷ budget) ──
   * Computed from TMDB 5000 (n per bracket in comments). Brackets tighten
   * as budgets grow — micro films are lottery tickets, tentpoles have
   * floors. Films with <5% of budget in reported revenue (~15.5% of the
   * dataset) are the "no real release" failure mode, reported separately. */
  var MULT_BY_BUDGET = [
    { max: 5e6,      label: '< $5M',      q: { p10: 0.27, p25: 1.50, p50: 4.99, p75: 11.55, p90: 35.00 } }, // n=402
    { max: 20e6,     label: '$5–20M',     q: { p10: 0.25, p25: 0.87, p50: 2.49, p75: 5.60,  p90: 11.06 } }, // n=850
    { max: 60e6,     label: '$20–60M',    q: { p10: 0.44, p25: 0.89, p50: 1.99, p75: 3.53,  p90: 6.01 } },  // n=1182
    { max: 120e6,    label: '$60–120M',   q: { p10: 0.57, p25: 1.09, p50: 2.00, p75: 3.22,  p90: 5.10 } },  // n=526
    { max: Infinity, label: '$120M+',     q: { p10: 1.09, p25: 1.88, p50: 2.78, p75: 4.16,  p90: 5.33 } }   // n=234
  ];
  var FAILURE_RATE = 0.155;       // budgeted films with ~no reported revenue
  var OVERALL_MEDIAN_MULT = 2.30; // all released films

  /* Genre median multiples (same dataset) → expressed as a ratio to the
   * overall median so they compose with the budget bracket. Horror is the
   * standout ROI genre (median 3.55x, P90 20x+). */
  var GENRE_MULT_MEDIAN = {
    'Action': 1.98, 'Adventure': 2.65, 'Animation': 2.64, 'Comedy': 2.49,
    'Crime': 2.13, 'Documentary': 1.50, 'Drama': 2.16, 'Family': 2.64,
    'Fantasy': 2.38, 'Horror': 3.55, 'Romance': 2.54, 'Science Fiction': 2.84,
    'Thriller': 2.21
  };

  /* Feature adjustments — the consensus "what matters beyond budget" from
   * the surveyed prediction models, expressed as multiplicative factors on
   * the whole quantile band. Deliberately conservative. */
  var ADJUST = {
    franchise: { on: 1.7, off: 1.0,
      note: 'collection/franchise flag is a top-5 feature in every surveyed model' },
    star: { unknown: 0.85, rising: 0.95, name: 1.0, star: 1.15, alist: 1.25, megastar: 1.35,
      note: 'star/director encodings add modest lift at fixed budget' },
    window: { summer: 1.15, holiday: 1.15, spring: 1.0, fall: 1.0, january: 0.8, streaming: 1.0,
      note: 'release seasonality; the January dump is real' },
    rating: { G: 1.0, PG: 1.1, 'PG-13': 1.1, R: 0.9, NC17: 0.6,
      note: 'PG/PG-13 widen the audience; R narrows it (horror excepted — its calibration already reflects R)' }
  };

  function bracketFor(budget) {
    for (var i = 0; i < MULT_BY_BUDGET.length; i++) {
      if (budget < MULT_BY_BUDGET[i].max) return MULT_BY_BUDGET[i];
    }
    return MULT_BY_BUDGET[MULT_BY_BUDGET.length - 1];
  }

  /* Worldwide-gross quantile forecast.
   * opts: { budget, genre, franchise (bool), starTier, window, rating } */
  function forecastGross(opts) {
    opts = opts || {};
    var budget = Math.max(1e5, +opts.budget || 5e6);
    var br = bracketFor(budget);
    var genreRatio = (GENRE_MULT_MEDIAN[opts.genre] || OVERALL_MEDIAN_MULT) / OVERALL_MEDIAN_MULT;
    var adj = genreRatio *
      (opts.franchise ? ADJUST.franchise.on : 1) *
      (ADJUST.star[opts.starTier] || 1) *
      (ADJUST.window[opts.window] || 1) *
      (ADJUST.rating[opts.rating] || 1);
    // Horror + R double-count guard: the horror calibration is mostly R films
    if (opts.genre === 'Horror' && opts.rating === 'R') adj /= ADJUST.rating.R;

    var q = {};
    ['p10', 'p25', 'p50', 'p75', 'p90'].forEach(function (k) {
      q[k] = budget * br.q[k] * adj;
    });
    return {
      budget: budget,
      bracket: br.label,
      adjust: adj,
      genreRatio: genreRatio,
      gross: q,
      breakevenGross: budget * 2.5, // industry rule of thumb, refined by the waterfall
      failureRate: FAILURE_RATE
    };
  }

  /* ══ Leg 2: gross → producer net (the distribution waterfall) ═══════
   * Blended theatrical rentals ≈ 43% of worldwide gross (domestic ~40% of
   * WW at 50% rental, international at 40%, China slice at 25%). Theatrical
   * is only part of lifetime revenue: ~33% for studio releases (horror 38%,
   * family 34%, action 30%), ~25% for indie releases, per the AFM/Follows
   * lifetime-mix data. Distribution fee 30% studio / 25% indie; P&A ~80% of
   * budget wide / ~35% indie; sales agent ~10% (indie); equity recoups at
   * 120% (20% finance premium). */
  var RENTAL_BLEND = 0.428;
  var THEATRICAL_SHARE = {
    studio: { 'Horror': 0.38, 'Family': 0.34, 'Animation': 0.34, 'Action': 0.30, 'Thriller': 0.31, default: 0.33 },
    indie: { default: 0.25 }
  };

  function waterfall(gross, budget, opts) {
    opts = opts || {};
    var strategy = opts.strategy === 'indie' ? 'indie' : 'studio';
    var shares = THEATRICAL_SHARE[strategy];
    var theta = shares[opts.genre] || shares.default;
    var rentals = gross * RENTAL_BLEND;
    var lifetime = rentals / theta;                 // + home ent, streaming, TV
    var feePct = strategy === 'studio' ? 0.30 : 0.25;
    var distFee = lifetime * feePct;
    var pa = strategy === 'studio' ? Math.max(0.8 * budget, 25e6) : Math.max(0.35 * budget, 50e3);
    var agent = strategy === 'indie' ? lifetime * 0.10 : 0;
    var financeCost = 0.20 * budget;                // equity premium (120% recoup)
    var net = lifetime - distFee - pa - agent - budget - financeCost;
    // Breakeven worldwide gross (net = 0)
    var passThrough = (RENTAL_BLEND / theta) * (1 - feePct - (strategy === 'indie' ? 0.10 : 0));
    var breakeven = (budget + financeCost + pa) / passThrough;
    return {
      strategy: strategy, theta: theta,
      gross: gross, rentals: rentals, ancillary: lifetime - rentals, lifetime: lifetime,
      distFee: distFee, pa: pa, agent: agent, budget: budget, financeCost: financeCost,
      net: net, breakevenGross: breakeven, multiple: budget > 0 ? gross / budget : 0
    };
  }

  /* ══ Leg 3: independent-film sales — territory pre-sale estimates ════
   * Sales-agent style "take/ask" sheet as % of budget per territory
   * (typical total coverage 30-50% of budget), scaled by cast bankability.
   * Producers routinely overestimate these by ~2x — these are the sober
   * numbers. Sales agent commission 15% + ~$60k market expenses. */
  var TERRITORIES = [
    { id: 'us',      label: 'North America',        pct: [0.08, 0.12] },
    { id: 'uk',      label: 'UK & Ireland',         pct: [0.03, 0.05] },
    { id: 'germany', label: 'Germany / Austria',    pct: [0.04, 0.055] },
    { id: 'france',  label: 'France',               pct: [0.03, 0.04] },
    { id: 'japan',   label: 'Japan',                pct: [0.04, 0.05] },
    { id: 'latam',   label: 'Latin America',        pct: [0.02, 0.04] },
    { id: 'spain',   label: 'Spain',                pct: [0.015, 0.03] },
    { id: 'italy',   label: 'Italy',                pct: [0.015, 0.03] },
    { id: 'scand',   label: 'Scandinavia',          pct: [0.015, 0.025] },
    { id: 'easteur', label: 'Eastern Europe',       pct: [0.01, 0.02] },
    { id: 'china',   label: 'China (approval risk)',pct: [0.01, 0.02] },
    { id: 'row',     label: 'Rest of world',        pct: [0.03, 0.045] }
  ];
  var CAST_SALES_FACTOR = { unknown: 0.55, rising: 0.8, name: 1.0, star: 1.35, alist: 1.6, megastar: 1.8 };
  var AGENT_COMMISSION = 0.15;
  var AGENT_EXPENSES = 60000;

  function presales(budget, starTier) {
    var f = CAST_SALES_FACTOR[starTier] || 1;
    var rows = TERRITORIES.map(function (t) {
      return { id: t.id, label: t.label, low: budget * t.pct[0] * f, high: budget * t.pct[1] * f };
    });
    var low = rows.reduce(function (a, r) { return a + r.low; }, 0);
    var high = rows.reduce(function (a, r) { return a + r.high; }, 0);
    return {
      rows: rows,
      totalLow: low, totalHigh: high,
      netLow: Math.max(0, low * (1 - AGENT_COMMISSION) - AGENT_EXPENSES),
      netHigh: Math.max(0, high * (1 - AGENT_COMMISSION) - AGENT_EXPENSES),
      pctLow: low / budget, pctHigh: high / budget,
      castFactor: f
    };
  }

  /* Streaming buyout comparison (festival-acquisition comps): most films
   * sell under budget or not at all; hot genre breakouts fetch 2-10x. */
  function buyoutComps(budget) {
    return {
      typical: [budget * 0.5, budget * 1.3],
      breakout: [budget * 2, budget * 10],
      note: 'Sundance-class headline deals ($10M-$20M) are the top 1-2% of titles; cost-plus originals pay budget +20-40%'
    };
  }

  /* ══ UI (Sales tab) ═════════════════════════════════════════════════ */
  var PREF_KEY = 'SB_Sales_v1';
  var prefs = { budget: 5e6, genre: 'auto', starTier: 'rising', franchise: false, window: 'fall', rating: 'R', strategy: 'indie' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function fm(n) { return SBBudget.fmtMoney(Math.abs(n)); }
  function fmSigned(n) { return (n < 0 ? '−' : '') + fm(n); }
  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }

  function loadPrefs() {
    try { Object.assign(prefs, JSON.parse((root.localStorage && root.localStorage.getItem(PREF_KEY)) || 'null') || {}); } catch (e) {}
  }
  function savePrefs() {
    try { root.localStorage && root.localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function autoGenre() {
    try {
      var st = root.psProjectState ? psProjectState() : {};
      if (st.scriptText || (st.clips || []).length) return SBBudget.analyze(st).genre;
    } catch (e) {}
    return 'Drama';
  }

  /* Documentary path: docs are financed and sold as a license stack
   * (streamer/broadcast/educational/self-dist), not a theatrical
   * waterfall — see docs/DOCUMENTARY_MODE.md for every source. */
  function renderDoc(el) {
    var ds = root.SBDoc.docSales([prefs.budget, prefs.budget], { heat: prefs.docHeat || 'solid' });
    var h = '';
    h += '<div class="bud-section"><h4>Documentary revenue — a license stack, not box office</h4>';
    h += '<div class="bud-assume">Festival outcome: <select class="uc-sel" id="slDocHeat">';
    root.SBDoc.DOC_SALES.heat.forEach(function (t) {
      h += '<option value="' + t.id + '"' + (t.id === (prefs.docHeat || 'solid') ? ' selected' : '') + '>' + esc(t.label) + '</option>';
    });
    h += '</select> · budget ' + fm(prefs.budget) + '</div>';
    h += '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Revenue path</th><th class="bud-r">Low</th><th class="bud-r">High</th></tr></thead><tbody>';
    Object.keys(ds.paths).forEach(function (k) {
      h += '<tr><td>' + esc(k) + '</td><td class="bud-r">' + fm(ds.paths[k][0]) + '</td><td class="bud-r">' + fm(ds.paths[k][1]) + '</td></tr>';
    });
    h += '<tr><td><b>Total gross</b></td><td class="bud-r"><b>' + fm(ds.gross[0]) + '</b></td><td class="bud-r"><b>' + fm(ds.gross[1]) + '</b></td></tr>';
    h += '<tr><td>Net after 15% agent + expenses</td><td class="bud-r"' + (ds.recoupsAtLow ? ' style="color:var(--green)"' : '') + '>' + fm(ds.net[0]) + '</td><td class="bud-r"' + (ds.recoupsAtHigh ? ' style="color:var(--green)"' : ' style="color:var(--red)"') + '>' + fm(ds.net[1]) + '</td></tr>';
    h += '</tbody></table></div>';
    h += '<p class="bud-note">Post-2022 reality (sourced): streamer all-rights buys are rare events — Sundance 2023 saw <b>zero</b> streamer doc acquisitions; celebrity/IP titles still clear $10M+. PBS strands license features at ~$30–60k ($150k ceiling), Storyville buys UK-only, educational runs $5–50k lifetime at ~50% splits. The honest priors: only <b>' + Math.round(ds.profitRate * 100) + '%</b> of independent docs reach profit and <b>' + Math.round(ds.zeroRevenueRate * 100) + '%</b> report no revenue at all (CMSI field study). Doc <b>series</b> commissions run cost-plus ' + Math.round(ds.seriesCostPlus[0] * 100) + '–' + Math.round(ds.seriesCostPlus[1] * 100) + '% — sell the series, not the film, when the material supports it.</p></div>';

    h += '<div class="bud-section"><h4>Funding offsets — the other half of doc finance</h4>';
    h += '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Program</th><th class="bud-r">Typical award</th><th>Note</th></tr></thead><tbody>';
    ds.grants.forEach(function (g) {
      h += '<tr><td>' + esc(g.label) + '</td><td class="bud-r"><b>' + (g.range[0] === g.range[1] ? fm(g.range[0]) : fm(g.range[0]) + ' – ' + fm(g.range[1])) + '</b></td><td>' + esc(g.note || '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="bud-note">Docs recoup from a stack of small checks plus grants — model the film as license stack + funding offsets, not as a box-office bet.</p></div>';
    el.innerHTML = h;
    var dh = $('slDocHeat');
    if (dh) dh.addEventListener('change', function () { prefs.docHeat = dh.value; savePrefs(); render(); });
  }

  function render() {
    var el = $('slBody');
    if (!el) return;
    if (prefs.strategy === 'documentary' && root.SBDoc) return renderDoc(el);
    var genre = prefs.genre === 'auto' ? autoGenre() : prefs.genre;
    var fc = forecastGross({ budget: prefs.budget, genre: genre, franchise: prefs.franchise, starTier: prefs.starTier, window: prefs.window, rating: prefs.rating });
    var h = '';

    /* forecast band */
    h += '<div class="bud-section"><h4>Worldwide gross forecast — quantile band, not a promise</h4>';
    h += '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Outcome</th><th>Multiple of budget</th><th style="text-align:right">Worldwide gross</th></tr></thead><tbody>';
    [['p10', 'P10 — bad night'], ['p25', 'P25 — soft'], ['p50', 'P50 — median'], ['p75', 'P75 — works'], ['p90', 'P90 — breakout']].forEach(function (row) {
      var g = fc.gross[row[0]];
      h += '<tr' + (row[0] === 'p50' ? ' class="bud-cur"' : '') + '><td>' + row[1] + '</td><td>' + (g / fc.budget).toFixed(2) + '×</td><td class="bud-r"><b>' + fm(g) + '</b></td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="bud-note">Calibrated on 3,708 released features (bracket ' + esc(fc.bracket) + '), adjusted ×' + fc.adjust.toFixed(2) + ' for ' + esc(genre) + (prefs.genre === 'auto' ? ' (auto-detected)' : '') + (prefs.franchise ? ', franchise/IP' : '') + ', ' + esc(prefs.starTier) + ' lead, ' + esc(prefs.window) + ' release, ' + esc(prefs.rating) + '. And the honest caveat: ~' + Math.round(FAILURE_RATE * 100) + '% of budgeted films never see meaningful release revenue at all.</p></div>';

    /* waterfall on P25/P50/P75 */
    h += '<div class="bud-section"><h4>Producer net — the distribution waterfall (' + (prefs.strategy === 'studio' ? 'studio wide release' : 'independent release') + ')</h4>';
    h += '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Waterfall step</th><th class="bud-r">P25</th><th class="bud-r">P50</th><th class="bud-r">P75</th></tr></thead><tbody>';
    var wfs = ['p25', 'p50', 'p75'].map(function (k) { return waterfall(fc.gross[k], fc.budget, { strategy: prefs.strategy, genre: genre }); });
    [
      ['Worldwide gross', function (w) { return fm(w.gross); }],
      ['Theatrical rentals (~43%)', function (w) { return fm(w.rentals); }],
      ['+ Home / streaming / TV', function (w) { return fm(w.ancillary); }],
      ['= Lifetime revenue', function (w) { return '<b>' + fm(w.lifetime) + '</b>'; }],
      ['− Distribution fee', function (w) { return '−' + fm(w.distFee); }],
      ['− P&A recoupment', function (w) { return '−' + fm(w.pa); }],
      ['− Sales agent', function (w) { return w.agent ? '−' + fm(w.agent) : '—'; }],
      ['− Production budget', function (w) { return '−' + fm(w.budget); }],
      ['− Financing premium (120% recoup)', function (w) { return '−' + fm(w.financeCost); }]
    ].forEach(function (r) {
      h += '<tr><td>' + r[0] + '</td>' + wfs.map(function (w) { return '<td class="bud-r">' + r[1](w) + '</td>'; }).join('') + '</tr>';
    });
    h += '<tr><td><b>NET (investors + producer pool)</b></td>' + wfs.map(function (w) {
      return '<td class="bud-r"><b style="color:var(--' + (w.net >= 0 ? 'green' : 'red') + ')">' + fmSigned(w.net) + '</b></td>';
    }).join('') + '</tr>';
    h += '</tbody></table></div>';
    h += '<p class="bud-note">Breakeven worldwide gross ≈ <b>' + fm(wfs[1].breakevenGross) + '</b> (' + (wfs[1].breakevenGross / fc.budget).toFixed(1) + '× budget — the classic "2–2.5×" rule, derived here from the actual splits). Theatrical is ~' + Math.round(wfs[1].theta * 100) + '% of lifetime revenue for this genre/strategy; net pool typically splits ~50/50 investors vs producer/talent after recoupment.</p></div>';

    /* indie pre-sales + buyouts */
    var ps = presales(fc.budget, prefs.starTier);
    var bo = buyoutComps(fc.budget);
    h += '<div class="bud-section"><h4>Independent path — territory pre-sales & streaming buyout</h4>';
    h += '<div class="bud-tablewrap"><table class="bud-table"><thead><tr><th>Territory</th><th class="bud-r">Take (low)</th><th class="bud-r">Ask (high)</th></tr></thead><tbody>';
    ps.rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.label) + '</td><td class="bud-r">' + fm(r.low) + '</td><td class="bud-r">' + fm(r.high) + '</td></tr>';
    });
    h += '<tr><td><b>Total MGs (' + Math.round(ps.pctLow * 100) + '–' + Math.round(ps.pctHigh * 100) + '% of budget)</b></td><td class="bud-r"><b>' + fm(ps.totalLow) + '</b></td><td class="bud-r"><b>' + fm(ps.totalHigh) + '</b></td></tr>';
    h += '<tr><td>Net after 15% commission + expenses</td><td class="bud-r">' + fm(ps.netLow) + '</td><td class="bud-r">' + fm(ps.netHigh) + '</td></tr>';
    h += '</tbody></table></div>';
    h += '<p class="bud-note">Sales-agent style take/ask sheet scaled ×' + ps.castFactor.toFixed(2) + ' for a ' + esc(prefs.starTier) + ' lead — banks lend 70–90% against signed pre-sale contracts. Producers famously overestimate these by ~2×; these are the sober numbers. <b>Streaming buyout comps:</b> typical festival sale ' + fm(bo.typical[0]) + '–' + fm(bo.typical[1]) + '; breakout genre title ' + fm(bo.breakout[0]) + '–' + fm(bo.breakout[1]) + '. ' + esc(bo.note) + '.</p></div>';

    el.innerHTML = h;
  }

  function setBudget(n, label) {
    prefs.budget = Math.max(1e5, n);
    var inp = $('slBudget');
    if (inp) inp.value = prefs.budget.toLocaleString('en-US');
    savePrefs(); render();
    if (label && root.psToast) psToast('Forecasting sales on ' + SBBudget.fmtMoney(prefs.budget) + ' (' + label + ')');
  }

  function init() {
    if (!$('slBody')) return;
    loadPrefs();
    var inp = $('slBudget');
    if (inp) {
      inp.value = prefs.budget.toLocaleString('en-US');
      inp.addEventListener('change', function () { setBudget(num(inp.value)); });
    }
    var map = { slGenre: 'genre', slStar: 'starTier', slWindow: 'window', slRating: 'rating', slStrategy: 'strategy' };
    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.value = prefs[map[id]];
      el.addEventListener('change', function () { prefs[map[id]] = el.value; savePrefs(); render(); });
    });
    var fr = $('slFranchise');
    if (fr) {
      fr.checked = !!prefs.franchise;
      fr.addEventListener('change', function () { prefs.franchise = fr.checked; savePrefs(); render(); });
    }
    var fromSheet = $('slFromSheet');
    if (fromSheet) fromSheet.addEventListener('click', function () {
      try {
        var d = JSON.parse(localStorage.getItem('SB_BudgetSheet_v1') || 'null');
        if (d && root.SBBudgetSheet) return setBudget(Math.round(SBBudgetSheet.sheetTotals(d).grand), 'top-sheet grand total');
      } catch (e) {}
      if (root.psToast) psToast('No saved top sheet yet — use the Budget tab first');
    });
    var fromEst = $('slFromEst');
    if (fromEst) fromEst.addEventListener('click', function () {
      var st = root.psProjectState ? psProjectState() : {};
      if (!st.scriptText && !(st.clips || []).length) return root.psToast && psToast('No script in the timeline yet');
      var estPrefs = {};
      try { estPrefs = JSON.parse((root.localStorage && root.localStorage.getItem('SB_Budget_v1')) || 'null') || {}; } catch (e) {}
      var prod = SBBudget.estimateProduction(SBBudget.analyze(st), estPrefs);
      setBudget(Math.round(prod.total.likely), (prod.mode === 'documentary' ? 'documentary estimate, likely' : 'script estimate, likely'));
    });
    render();
  }

  root.SBSales = root.SBSales || {};
  root.SBSales.init = init;
  root.SBSales.render = render;
  root.SBSales.forecastGross = forecastGross;
  root.SBSales.waterfall = waterfall;
  root.SBSales.presales = presales;
  root.SBSales.buyoutComps = buyoutComps;
  root.SBSales.TERRITORIES = TERRITORIES;
  root.SBSales.CAST_SALES_FACTOR = CAST_SALES_FACTOR;
  root.SBSales.MULT_BY_BUDGET = MULT_BY_BUDGET;
  root.SBSales.GENRE_MULT_MEDIAN = GENRE_MULT_MEDIAN;
  root.SBSales.ADJUST = ADJUST;
  root.SBSales.FAILURE_RATE = FAILURE_RATE;
})(typeof window !== 'undefined' ? window : globalThis);
