/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Tax Credit Ledger engine (CTaxCred)
   Pure logic, no DOM: jurisdiction table (mirrored verbatim from the
   Advisor's curated incentive table in timeline/timeline-budget.js —
   published program terms, 2025-26), qualified-spend tagging of Money Room
   rows (explicit tags win; untagged rows get a clearly-labeled heuristic
   starting guess), a credit model that compares actual+committed qualified
   spend against the Advisor's whole-budget model, and a generic application
   checklist. Every figure here is an ESTIMATE from published program terms
   that drift — confirm specifics with your accountant before relying.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── 1 · jurisdictions ──────────────────────────────────────────────────
     Copied VERBATIM from the Advisor's INCENTIVES table
     (timeline/timeline-budget.js) — curated from published program terms
     (2025-26). rate = [low, high] effective credit/rebate on QUALIFIED
     spend; qualPct = fraction of a typical budget that qualifies.        */
  var JURIS = [
    { id: 'none',      label: 'None / not modeled',                   rate: [0, 0],       qualPct: 0,    note: '' },
    { id: 'georgia',   label: 'Georgia — 30% transferable',           rate: [0.20, 0.30], qualPct: 0.75, minSpend: 5e5,  note: '20% base + 10% logo; no annual cap; credits sellable ~87-92¢' },
    { id: 'california',label: 'California — 20-35% (Program 4.0)',    rate: [0.20, 0.35], qualPct: 0.55, minSpend: 1e6,  note: 'excludes ATL salaries; annual program cap, lottery-style allocation' },
    { id: 'newyork',   label: 'New York — 30% refundable',            rate: [0.30, 0.30], qualPct: 0.55, minSpend: 25e4, note: 'BTL costs only; $700M/yr program cap' },
    { id: 'newmexico', label: 'New Mexico — 25-40% refundable',       rate: [0.25, 0.40], qualPct: 0.70, note: 'uplifts for rural, TV series, NM crew' },
    { id: 'louisiana', label: 'Louisiana — 25-40% credit',            rate: [0.25, 0.40], qualPct: 0.70, minSpend: 3e5,  note: '$150M annual program cap' },
    { id: 'ukavec',    label: 'UK — AVEC 25.5% net',                  rate: [0.255, 0.255], qualPct: 0.64, note: '34% gross on up to 80% of core spend' },
    { id: 'ukiftc',    label: 'UK — Independent Film 39.75% net',     rate: [0.3975, 0.3975], qualPct: 0.64, budgetCap: 30e6, note: 'films ≤ ~£15M core spend; claim capped at 80% of core' },
    { id: 'ireland',   label: 'Ireland — Section 481 (32%)',          rate: [0.32, 0.32], qualPct: 0.64, note: 'on 80% of eligible spend; €125M per-project cap; +8% lower-budget uplift' },
    { id: 'hungary',   label: 'Hungary — 30% rebate',                 rate: [0.30, 0.30], qualPct: 0.75, note: 'no per-project cap; extended to 2030' },
    { id: 'czech',     label: 'Czech Republic — 20-30% rebate',       rate: [0.20, 0.30], qualPct: 0.70, note: '+10% for VFX/animation work' },
    { id: 'australia', label: 'Australia — 30% offset',               rate: [0.30, 0.30], qualPct: 0.75, note: 'Location Offset (international) or Producer Offset (Australian films)' },
    { id: 'nz',        label: 'New Zealand — 20-25% (40% domestic)',  rate: [0.20, 0.25], qualPct: 0.75, note: 'NZSPG; 40% for qualifying NZ productions' },
    { id: 'bc',        label: 'British Columbia — 36% labor (PSTC)',  rate: [0.36, 0.36], qualPct: 0.45, note: 'labor-only credit; stacks with federal PSTC 16%' },
    { id: 'ontario',   label: 'Ontario — 21.5% all-spend (OPSTC)',    rate: [0.215, 0.215], qualPct: 0.70, note: 'or OFTTC 35% labor-only for Canadian-content films' },
    { id: 'iceland',   label: 'Iceland — 25-35% rebate',              rate: [0.25, 0.35], qualPct: 0.75, note: '35% above spend/shoot-day thresholds' },
    { id: 'malta',     label: 'Malta — 30-40% rebate',                rate: [0.30, 0.40], qualPct: 0.75, note: 'uplifts for portraying Malta / local facilities' },
    { id: 'italy',     label: 'Italy — 40% credit',                   rate: [0.40, 0.40], qualPct: 0.70, note: 'per-project caps apply' },
    { id: 'greece',    label: 'Greece — 40% rebate',                  rate: [0.40, 0.40], qualPct: 0.70, note: '+5% VFX/digital bonus' },
    { id: 'germany',   label: 'Germany — DFFF 25%',                   rate: [0.25, 0.35], qualPct: 0.70, note: 'regional funds (Bavaria/NRW/Berlin) can add 5-10%' },
    { id: 'spain',     label: 'Spain — 25-30% (Canary 50%+)',         rate: [0.25, 0.30], qualPct: 0.70, note: 'Canary Islands special regime reaches 50-54%' }
  ];
  var JURIS_BY_ID = {};
  JURIS.forEach(function (j) { JURIS_BY_ID[j.id] = j; });

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function jurisById(id) {
    return JURIS_BY_ID[String(id || '').toLowerCase()] || JURIS_BY_ID.none;
  }

  /* Midpoint of a [lo, hi] rate band — the working single number. */
  function midpoint(rate) {
    if (!rate || rate.length < 2) return 0;
    return (num(rate[0]) + num(rate[1])) / 2;
  }

  /* ── 2 · qualified-spend heuristic ──────────────────────────────────────
     A STARTING GUESS only: most programs exempt travel, insurance, bond,
     legal/financing costs and out-of-jurisdiction spend from the qualified
     base (many also exempt some ATL). Explicit user tags always win.      */
  var EXEMPT_RE = /\b(travel|airfare|flights?|hotel|lodging|per diem|insurance|insurer|bond|legal|attorney|law firm|financ(e|ing)|interest|bank (fee|charge)s?|out[ -]of[ -](state|province|country|jurisdiction)|non[ -]resident)\b/i;

  function qualifiedGuess(row, juris) {
    var hay = String((row && (row.vendor || row.party || row.who)) || '') + ' ' +
              String((row && row.desc) || '');
    return !EXEMPT_RE.test(hay);
  }

  /* ── 3 · ledger rows from the Money Room store ──────────────────────────
     Void POs vanish; open POs are committed money, invoiced/paid POs and
     petty cash are actual money — same rules as CMoney.costReport.        */
  function rowsFromMoney(money) {
    var m = money || {};
    var out = [];
    (m.pos || []).forEach(function (po) {
      if (po.status === 'void') return;
      out.push({ id: po.id, kind: 'po', ref: po.num || 'PO', party: po.vendor || '',
                 desc: po.desc || '', acct: String(po.acct || ''), amount: num(po.amount),
                 date: po.date || '', bucket: po.status === 'open' ? 'committed' : 'actual' });
    });
    (m.petty || []).forEach(function (p) {
      out.push({ id: p.id, kind: 'petty', ref: 'PC', party: p.who || '',
                 desc: p.desc || '', acct: String(p.acct || ''), amount: num(p.amount),
                 date: p.date || '', bucket: 'actual' });
    });
    return out;
  }

  /* Explicit tag (true/false) wins; anything else falls to the guess. */
  function isQualified(row, tags, juris) {
    var t = tags ? tags[row.id] : undefined;
    if (t === true || t === false) return t;
    return qualifiedGuess(row, juris);
  }

  /* ── 4 · credit model ───────────────────────────────────────────────────
     qualifiedSpend = qualified actual + committed rows
     estCredit      = qualifiedSpend × midpoint(rate)
     advisorModel   = budgetTotal × qualPct × midpoint(rate)   (the Advisor's
                      whole-budget assumption) — delta shows how the real
                      ledger tracks against it. minSpend not met → credit 0
                      with a warning; budgetCap breached → overCap flag.

     `qualPct` is the fraction of a TYPICAL BUDGET that qualifies — a haircut
     for a whole-budget model that has no ledger to look at. It belongs to
     advisorModel and nowhere else. Applying it to `qualifiedSpend` as well
     charged the same haircut twice against spend that isQualified() had
     already filtered with the same exemption list, understating every credit
     by (1 − qualPct): 25% in Georgia, 55% in British Columbia. On $2M of
     tagged BC labour that is $720,000 of credit reported as $324,000 —
     $396,000 the production would not have known it could finance against.
     Row-level tagging is the more accurate answer; the ledger wins.        */
  function creditModel(juris, tags, money, budgetTotal) {
    juris = juris || jurisById('none');
    var rows = rowsFromMoney(money);
    var totalSpend = 0, qualifiedSpend = 0, qualifiedCount = 0, guessedCount = 0;
    rows.forEach(function (r) {
      totalSpend += r.amount;
      var t = tags ? tags[r.id] : undefined;
      if (t !== true && t !== false) guessedCount++;
      if (isQualified(r, tags, juris)) { qualifiedSpend += r.amount; qualifiedCount++; }
    });
    var M = root.CMoneyMath;
    var r2 = M ? function (v) { return M.dollars(M.cents(v)); }
               : function (v) { return Math.round(v * 100) / 100; };
    var mid = midpoint(juris.rate);
    var qp = num(juris.qualPct);
    var rawCredit = qualifiedSpend * mid;
    var belowMin = !!(juris.minSpend && totalSpend < juris.minSpend);
    var bt = num(budgetTotal);
    var estCredit = belowMin ? 0 : r2(rawCredit);
    var advisorModel = r2(bt * qp * mid);
    return {
      juris: juris.id, midRate: mid, qualPct: qp,
      rowCount: rows.length, qualifiedCount: qualifiedCount, guessedCount: guessedCount,
      totalSpend: r2(totalSpend), qualifiedSpend: r2(qualifiedSpend),
      rawCredit: r2(rawCredit), estCredit: estCredit,
      advisorModel: advisorModel, delta: r2(estCredit - advisorModel),
      belowMin: belowMin, minSpend: juris.minSpend || 0,
      overCap: !!(juris.budgetCap && bt > juris.budgetCap), budgetCap: juris.budgetCap || 0,
      note: juris.note || ''
    };
  }

  /* ── 5 · application checklist ──────────────────────────────────────────
     Generic wording on purpose — programs differ and their rules drift.
     Cultural certification applies to the UK / Ireland / Australia programs. */
  var CULTURAL = { ukavec: 1, ukiftc: 1, ireland: 1, australia: 1 };

  function checklist(juris) {
    juris = juris || jurisById('none');
    var items = [];
    items.push({ id: 'register', step: 'Register the production with the film office / program authority before principal photography where required',
                 why: 'Many programs disqualify spend incurred before approval — confirm whether pre-registration is mandatory here.' });
    items.push({ id: 'window', step: 'Confirm the application window and claim deadlines',
                 why: 'Application, interim-claim and final-claim windows differ by program and change year to year.' });
    if (juris.minSpend) {
      items.push({ id: 'minspend', step: 'Confirm the minimum-spend threshold is met (program floor ~$' + juris.minSpend.toLocaleString() + ' per published terms)',
                   why: 'Below the floor the program pays nothing — thresholds and what counts toward them change; verify current terms.' });
    }
    items.push({ id: 'residency', step: 'Collect residency documentation for cast and crew',
                 why: 'Labor-based credits (and many uplifts) count resident labor only — payroll must prove residency.' });
    if (CULTURAL[juris.id]) {
      items.push({ id: 'cultural', step: 'Pass the cultural test / points certification',
                   why: 'The UK, Ireland and Australia programs require cultural certification before the credit can be claimed.' });
    }
    items.push({ id: 'audit', step: 'Engage a CPA for the required audit / compliance certificate',
                 why: 'Most programs require an independent accountant\'s report on qualified spend.' });
    items.push({ id: 'costreport', step: 'Prepare the final cost report with qualified spend broken out',
                 why: 'The Money Room cost report is a starting point — the filed report must follow the program\'s own cost categories.' });
    items.push({ id: 'apply', step: 'File the final application and track payment / transfer of the credit',
                 why: 'Refunds and transferable credits arrive months after audit — they reduce net cost, not the cash you need up front.' });
    return { juris: juris.id, items: items,
             flag: 'Generic checklist — confirm jurisdiction specifics with your accountant.' };
  }

  root.CTaxCred = {
    JURIS: JURIS, jurisById: jurisById, midpoint: midpoint,
    qualifiedGuess: qualifiedGuess, rowsFromMoney: rowsFromMoney,
    isQualified: isQualified, creditModel: creditModel, checklist: checklist
  };
})(typeof window !== 'undefined' ? window : globalThis);
