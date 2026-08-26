/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Deal Memos engine (CDeal)
   Crew deal memos and cast agreements in the standard field set the
   industry signs every day — generated from the crew register and cast
   data the platform already holds, with SAG-AFTRA scale figures where
   they apply. A signed deal becomes a commitment in the Money Room, so
   the cost report sees payroll obligations the moment ink lands.
   Plain-language templates for speed — counsel reviews before signature.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var SAG_SCALE = { day: 1204, week: 4181 };            // theatrical basic, kept current in one place

  /* Payroll fringes a signed deal actually obligates, as a fraction of the
     engagement fee. A deal memo is a payroll commitment, not a fee: the
     employer owes pension & health, payroll taxes, workers' comp and handling
     on top of every dollar of the rate. Omitting them committed every deal
     25-35% light in the Money Room — a SAG day player at $1,204 costs the
     production ~$1,541 before a single hour of overtime.
     Rates track the same bands the estimator budgets with (TIERS.crew). */
  var FRINGE_PCT = {
    'sag-aftra': 0.28, 'sag': 0.28, 'aftra': 0.28,
    'iatse': 0.40, 'teamsters': 0.40, 'teamster': 0.40,
    'dga': 0.36, 'wga': 0.36,
    'ubcja': 0.36, 'iba': 0.32
  };
  var FRINGE_DEFAULT = 0.28;    // non-union: payroll tax + WC + payroll-service handling
  /* Overtime bleed past the contracted day on a 1.5x-after-12 term. The same
     0.12 the estimator carries as OT_FACTOR, so a deal and a budget line for
     the same person do not disagree. A flat/all-in deal carries none. */
  var OT_ALLOWANCE = 0.12;
  var DAYS_PER_WEEK = 5;

  function uid() { return 'd' + Math.random().toString(36).slice(2, 9); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function MM() {
    var m = root.CMoneyMath;
    if (!m) throw new Error('contracts/lib-deal.js requires js/lib-money-math.js');
    return m;
  }

  function blank() { return { v: 1, deals: [] }; }

  function fromCrewRow(row, production) {
    return { kind: 'crew', production: production || '', name: (row && row.name) || '',
      role: (row && row.role) || '', union: (row && row.union) || '',
      rateBasis: 'day', rate: num(row && row.rate), guaranteed: 5,
      otTerms: '1.5x after 12 hours on set', kitFee: 0, perDiem: 0, startDate: '' };
  }
  function castDefaults(production, role) {
    return { kind: 'cast', production: production || '', name: '', role: role || '',
      union: 'SAG-AFTRA', rateBasis: 'day', rate: SAG_SCALE.day, guaranteed: 3,
      otTerms: 'per applicable SAG-AFTRA schedule', kitFee: 0, perDiem: 60,
      credit: 'Main titles, single card, position by mutual agreement', startDate: '' };
  }

  function addDeal(store, fields) {
    var d = { id: uid(), status: 'draft', committedPo: null, fields: fields || {} };
    store.deals.push(d);
    return d;
  }
  function setStatus(store, id, status) {
    var d = store.deals.filter(function (x) { return x.id === id; })[0];
    if (!d || ['draft', 'sent', 'signed'].indexOf(status) < 0) return null;
    d.status = status;
    return d;
  }
  function removeDeal(store, id) {
    var n = store.deals.length;
    store.deals = store.deals.filter(function (x) { return x.id !== id; });
    return n !== store.deals.length;
  }

  function fringePct(f) {
    if (f && f.fringePct != null && f.fringePct !== '') return num(f.fringePct) / 100;
    var u = String((f && f.union) || '').toLowerCase().trim();
    if (!u || /^non[- ]?union$/.test(u)) return FRINGE_DEFAULT;
    var keys = Object.keys(FRINGE_PCT);
    for (var i = 0; i < keys.length; i++) if (u.indexOf(keys[i]) >= 0) return FRINGE_PCT[keys[i]];
    return FRINGE_DEFAULT;
  }
  function otPct(f) {
    if (f && f.otPct != null && f.otPct !== '') return num(f.otPct) / 100;
    var terms = String((f && f.otTerms) || '');
    if (!terms || /\b(flat|all[- ]in|no overtime|none)\b/i.test(terms)) return 0;
    return OT_ALLOWANCE;
  }
  function daysPerUnit(f) {
    return String((f && f.rateBasis) || 'day').toLowerCase() === 'week' ? DAYS_PER_WEEK : 1;
  }

  /* What a signed deal actually obligates, broken out — fee, overtime
     allowance, payroll fringes on both, kit rental and per diem. Per diem is
     paid per WORKING DAY: multiplying it by `guaranteed` in rate-basis units
     committed $120 on a weekly deal that owes $600. */
  function dealCost(fields) {
    var M = MM(), f = fields || {};
    var units = Math.max(1, num(f.guaranteed) || 1);
    var workDays = units * daysPerUnit(f);
    var fp = fringePct(f), op = otPct(f);
    var base = M.mulCents(M.cents(f.rate), units);
    var ot = M.mulCents(base, op);
    var fringes = M.mulCents(base + ot, fp);          // kit and per diem are not fringeable
    var kit = M.cents(f.kitFee);
    var perDiem = M.mulCents(M.cents(f.perDiem), workDays);
    var total = base + ot + fringes + kit + perDiem;
    return {
      units: units, workDays: workDays, fringePct: fp, otPct: op,
      base: M.dollars(base), overtime: M.dollars(ot), fringes: M.dollars(fringes),
      kitFee: M.dollars(kit), perDiem: M.dollars(perDiem), total: M.dollars(total)
    };
  }
  /* total obligation a signed deal creates */
  function dealValue(f) { return dealCost(f).total; }

  /* The account a deal posts to, from the platform's one chart. Every crew
     memo used to land on 3000 (Direction) and every cast agreement on 2000
     (Producers Unit) — so wardrobe, hair/makeup and the composer could never
     reconcile against the lines that budgeted them. */
  function acctFor(f) {
    var A = root.CAccounts;
    if (!A) throw new Error('contracts/lib-deal.js requires js/lib-money-accounts.js');
    return A.forRole((f && f.role) || '', (f && f.kind) || 'crew');
  }
  /* signed deal → Money Room commitment (an open PO on the right account) */
  function toCommitment(deal) {
    var f = deal.fields || {};
    var c = dealCost(f);
    var M = MM();
    var breakdown = 'fee ' + M.fmt(c.base) +
      (c.overtime ? ' + OT allowance ' + M.fmt(c.overtime) : '') +
      ' + fringes ' + M.fmt(c.fringes) + ' (' + Math.round(c.fringePct * 100) + '%)' +
      (c.kitFee ? ' + kit ' + M.fmt(c.kitFee) : '') +
      (c.perDiem ? ' + per diem ' + M.fmt(c.perDiem) + ' (' + c.workDays + ' days)' : '');
    return { vendor: f.name || '(unnamed)', desc: (f.kind === 'cast' ? 'Cast agreement — ' : 'Deal memo — ') + (f.role || ''),
             acct: acctFor(f), amount: c.total,
             notes: 'auto from signed deal ' + deal.id + ' · ' + breakdown };
  }

  /* ── documents ───────────────────────────────────────────────────── */
  function money(n) { return '$' + Math.round(num(n)).toLocaleString(); }

  /* How a rate sits against guild scale. The old test was `rate <= scale`, so
     a $600/day SAG deal — HALF of the $1,204 minimum — printed "(scale)". That
     is not a rounding error: it is the tool telling a producer that a rate a
     signatory may not legally pay is compliant. Under scale is called under
     scale; only the minimum itself is scale. */
  function scaleStatus(f) {
    if (!f || String(f.union || '') !== 'SAG-AFTRA') return null;
    var basis = String(f.rateBasis || 'day').toLowerCase();
    var scale = SAG_SCALE[basis];
    if (!scale) return null;
    var rate = num(f.rate);
    if (!(rate > 0)) return null;
    if (Math.abs(rate - scale) < 0.5) return { state: 'scale', scale: scale, label: '  (scale)' };
    if (rate < scale) {
      return { state: 'below', scale: scale,
        label: '  (BELOW SAG-AFTRA ' + basis + ' scale of $' + scale.toLocaleString() +
               ' — a signatory production may not pay this; confirm the applicable agreement)' };
    }
    return { state: 'over', scale: scale, label: '  (over scale; ' + basis + ' scale $' + scale.toLocaleString() + ')' };
  }

  function memoText(f) {
    var lines = [
      (f.kind === 'cast' ? 'CAST AGREEMENT (short form)' : 'CREW DEAL MEMO'),
      'Production: ' + (f.production || ''),
      '',
      'Name: ' + (f.name || '') + '            Role: ' + (f.role || ''),
      'Union/Guild: ' + (f.union || 'non-union'),
      'Rate: ' + money(f.rate) + ' per ' + (f.rateBasis || 'day') +
        ((scaleStatus(f) || {}).label || ''),
      'Guaranteed: ' + (f.guaranteed || 1) + ' ' + (f.rateBasis || 'day') + '(s)' +
        '   Start date: ' + (f.startDate || 'TBD'),
      'Overtime: ' + (f.otTerms || 'per applicable agreement'),
      (num(f.kitFee) ? 'Kit/box rental: ' + money(f.kitFee) + ' flat' : null),
      (num(f.perDiem) ? 'Per diem: ' + money(f.perDiem) + ' per working day' : null),
      (f.kind === 'cast' ? 'Credit: ' + (f.credit || 'by mutual agreement') : null),
      '',
      'Engagement is subject to the production\'s standard terms, including safety',
      'compliance, confidentiality, and work-made-for-hire assignment of results',
      'and proceeds to the production. This memo binds both parties on signature;',
      'a long-form agreement, if issued, supersedes it.',
      '',
      'For the production: ______________________   Date: ____________',
      (f.kind === 'cast' ? 'Performer' : 'Crew member') + ': ______________________   Date: ____________'
    ];
    return lines.filter(function (l) { return l !== null; }).join('\n');
  }
  function ndaText(f) {
    return 'NON-DISCLOSURE AGREEMENT\nProduction: ' + (f.production || '') + '\n\n' +
      (f.name || '____________________') + ' agrees to keep confidential all non-public ' +
      'information about the production — including script, story, casting, schedule, ' +
      'imagery and business terms — and to post no material from set without written ' +
      'approval. This obligation survives the engagement.\n\n' +
      'Signature: ______________________   Date: ____________\n';
  }

  root.CDeal = {
    SAG_SCALE: SAG_SCALE, FRINGE_PCT: FRINGE_PCT, FRINGE_DEFAULT: FRINGE_DEFAULT,
    OT_ALLOWANCE: OT_ALLOWANCE, DAYS_PER_WEEK: DAYS_PER_WEEK, blank: blank,
    fromCrewRow: fromCrewRow, castDefaults: castDefaults,
    addDeal: addDeal, setStatus: setStatus, removeDeal: removeDeal,
    dealValue: dealValue, dealCost: dealCost, acctFor: acctFor,
    fringePct: fringePct, otPct: otPct, scaleStatus: scaleStatus,
    toCommitment: toCommitment,
    memoText: memoText, ndaText: ndaText
  };
})(typeof window !== 'undefined' ? window : globalThis);
