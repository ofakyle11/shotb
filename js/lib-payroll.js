/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — payroll into the money room (CPayroll)

   Labour is 50–70% of a film budget and it reached the weekly cost report not
   at all. The timecard engine (tools/lib-money.js, TMoney.timecard) already
   computed gross, meal penalties, forced-call turnaround and fringes correctly
   and the Money Room already ran POs and petty cash — nothing joined the two,
   so every EFC and every variance on the report that goes weekly to the studio
   and the completion bond was wrong by the size of the crew.

   This is that join, and nothing else:

     a logged timecard  →  CPayroll.cardFromLog
     the OT engine      →  TMoney.timecard          (NOT reimplemented here)
     the chart          →  CAccounts.forRole        (gaffer → 8000, not 3000)
     the arithmetic     →  CMoneyMath, integer cents
     the report         →  postings on m.labor, read by CMoney.costReport

   Two postings come off one day of one crew member:

     · LABOUR — gross + penalties, on the department's own account, because
       that is the line the budget carries and the line that goes over;
     · FRINGES — on CAccounts.FRINGE_ACCT ('20000'), never on the department.
       Fringes are cross-departmental (union H&P, payroll tax, workers' comp);
       posting them into the department overstates every department by ~28%
       and hides the one number a completion bond asks for first.

   It lives here, in js/, and not inside finance/lib-money.js on purpose:
   that file is script-loaded by six other module pages, so a dependency added
   inside it is six cross-team HTML edits. CMoney.costReport reads `m.labor`
   as plain data and needs to know nothing about timecards.

   Requires (at CALL time, not at load time — the guards are inside the
   functions so the file can be evaluated standalone):
     js/lib-money-math.js · js/lib-money-accounts.js · tools/lib-money.js
   Pure logic, no DOM.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function MM() {
    var m = root.CMoneyMath;
    if (!m) throw new Error('js/lib-payroll.js requires js/lib-money-math.js');
    return m;
  }
  function CHART() {
    var a = root.CAccounts;
    if (!a) throw new Error('js/lib-payroll.js requires js/lib-money-accounts.js');
    return a;
  }
  function ENGINE() {
    var t = root.TMoney;
    if (!t || !t.timecard) throw new Error('js/lib-payroll.js requires tools/lib-money.js (TMoney)');
    return t;
  }
  function defaultFringePct() {
    var t = root.TMoney;
    return (t && t.TC_DEFAULTS && t.TC_DEFAULTS.fringePct) || 0.28;
  }

  /* The store the Timecards tab writes (tools/tools-money-ui.js). Never
     renamed — live owners have days of cards under it. */
  var LOG_KEY = 'SB_Timecards_v1';

  /* Which day of the week a card was worked, however the UI wrote it: a
     number, or the label the Timecards select carries. */
  function dayIndex(v) {
    var n = parseInt(v, 10);
    if (isFinite(n) && n >= 1 && n <= 7) return n;
    var s = String(v == null ? '' : v);
    if (/7th/.test(s)) return 7;
    if (/6th/.test(s)) return 6;
    return 3;
  }

  /* A row out of the log, in whatever shape it was written, as one card.
     Rows logged before payroll reached the report carry only `total` — the
     column the Timecards tab labels "gross+fringe total" — so they are still
     postable; see backOut() below. */
  function cardFromLog(row) {
    var M = MM();
    var r = row || {};
    var fp = r.fringePct != null && r.fringePct !== ''
      ? (M.num(r.fringePct) > 1 ? M.num(r.fringePct) / 100 : M.num(r.fringePct))
      : defaultFringePct();
    return {
      id: r.id || '',
      date: r.date || '',
      person: r.person || r.name || '',
      role: r.role || r.dept || '',
      kind: String(r.kind || '').toLowerCase() === 'cast' ? 'cast' : 'crew',
      acct: r.acct ? String(r.acct) : '',
      status: String(r.status || 'worked').toLowerCase(),
      rate: M.num(r.rate),
      call: r.call || '',
      wrap: r.wrap || '',
      mealsTaken: parseInt(r.meals != null ? r.meals : r.mealsTaken, 10) || 0,
      firstMealAtHr: (r.firstMeal === '' || r.firstMeal == null) &&
                     (r.firstMealAtHr === '' || r.firstMealAtHr == null)
        ? null : M.num(r.firstMeal != null && r.firstMeal !== '' ? r.firstMeal : r.firstMealAtHr),
      dayOfWeek: dayIndex(r.dow != null && r.dow !== '' ? r.dow : r.dayOfWeek),
      prevWrap: r.prevWrap || '',
      fringePct: fp,
      /* already-computed figures, when the writer had them */
      gross: r.gross,
      penalties: r.penalties,
      fringes: r.fringes,
      total: r.total
    };
  }

  /* The account the LABOUR half lands on. An explicit account on the card wins
     (a production that codes its own cards), otherwise the one chart decides
     from the role — which is what keeps a gaffer out of Direction. */
  function laborAcct(card) {
    var A = CHART();
    var c = card || {};
    if (c.acct && A.exists(c.acct)) return String(c.acct);
    return A.forRole(c.role || '', c.kind);
  }

  /* Split a loaded total (labour + fringes) back into its two halves. The
     fringe half is the RESIDUAL, so the two postings add back to exactly the
     figure that was logged — no cent appears or disappears in the split. */
  function backOut(totalCents, pct) {
    var M = MM();
    var labor = M.mulCents(totalCents, 1 / (1 + pct));
    return { labor: labor, fringe: totalCents - labor };
  }

  /* One card → integer cents. The OT maths is TMoney's; every figure it
     returns is already resolved to the cent, so this converts once at the
     boundary and never does float arithmetic downstream. */
  function laborCents(card) {
    var M = MM();
    var c = card || {};
    var pct = c.fringePct != null ? c.fringePct : defaultFringePct();
    var out = { person: c.person || '', role: c.role || '', date: c.date || '',
                acct: laborAcct(c), fringePct: pct, elapsed: 0, worked: 0,
                grossCents: 0, penaltyCents: 0, laborCents: 0, fringeCents: 0,
                totalCents: 0, lines: [], penaltyLines: [], source: '', error: '' };

    if (c.rate > 0 && c.call && c.wrap) {
      var res = ENGINE().timecard({
        rate: c.rate, call: c.call, wrap: c.wrap,
        mealsTaken: c.mealsTaken, firstMealAtHr: c.firstMealAtHr,
        dayOfWeek: c.dayOfWeek, prevWrap: c.prevWrap || null,
        rules: { fringePct: pct }
      });
      if (res.error) { out.error = res.error; return out; }
      out.source = 'timecard';
      out.elapsed = res.elapsed; out.worked = res.worked;
      out.lines = res.lines; out.penaltyLines = res.penaltyLines;
      out.grossCents = M.cents(res.gross);
      out.penaltyCents = M.cents(res.penalties);
      out.fringeCents = M.cents(res.fringes);
    } else if (c.gross != null && c.gross !== '') {
      out.source = 'flat';
      out.grossCents = M.cents(c.gross);
      out.penaltyCents = M.cents(c.penalties);
      out.fringeCents = c.fringes != null && c.fringes !== ''
        ? M.cents(c.fringes)
        : M.pctOfCents(out.grossCents + out.penaltyCents, pct * 100);
    } else if (c.total != null && c.total !== '' && M.cents(c.total) !== 0) {
      /* legacy log row: the loaded total is all there is */
      out.source = 'total';
      var split = backOut(M.cents(c.total), pct);
      out.grossCents = split.labor;
      out.fringeCents = split.fringe;
    } else {
      out.error = 'no rate/call/wrap, no gross and no total — nothing to post';
      return out;
    }
    out.laborCents = out.grossCents + out.penaltyCents;
    out.totalCents = out.laborCents + out.fringeCents;
    return out;
  }

  /* A card that has not been worked yet is a COMMITMENT (the crew is hired,
     the day is scheduled); a card that has been worked is an ACTUAL, whether
     or not the payroll company has cut the cheque. Void posts nothing. */
  function postingKind(status) {
    var s = String(status || '').toLowerCase();
    if (s === 'scheduled' || s === 'committed' || s === 'projected') return 'committed';
    return 'actual';
  }

  /* One card → up to two postings, in the shape CMoney.costReport reads off
     `m.labor`: {acct, kind, cents}. Zero-value halves are not posted — an
     unfringed card should not grow a $0 row on 20000. */
  function cardPostings(card) {
    var A = CHART();
    var c = card || {};
    if (String(c.status || '').toLowerCase() === 'void') return [];
    var calc = laborCents(c);
    if (calc.error) return [];
    var kind = postingKind(c.status);
    var who = (c.person || 'crew') + (c.role ? ' · ' + c.role : '');
    var when = c.date ? ' ' + c.date : '';
    var list = [];
    if (calc.laborCents !== 0) {
      list.push({ acct: calc.acct, kind: kind, cents: calc.laborCents,
                  amount: MM().dollars(calc.laborCents), source: 'payroll',
                  person: c.person || '', role: c.role || '', date: c.date || '',
                  desc: 'Labour — ' + who + when });
    }
    if (calc.fringeCents !== 0) {
      list.push({ acct: A.FRINGE_ACCT, kind: kind, cents: calc.fringeCents,
                  amount: MM().dollars(calc.fringeCents), source: 'payroll',
                  person: c.person || '', role: c.role || '', date: c.date || '',
                  desc: 'Fringes ' + Math.round(calc.fringePct * 100) + '% — ' + who + when });
    }
    return list;
  }

  /* Every card → one flat posting list. */
  function postingsFor(cards) {
    var all = [];
    (cards || []).forEach(function (c) {
      cardPostings(c).forEach(function (p) { all.push(p); });
    });
    return all;
  }

  /* Hand the postings to a Money Room state. The cost report reads m.labor
     alongside POs and petty cash, so labour lands in actual, committed and
     therefore EFC and variance. Derived, so it is rebuilt from the cards
     rather than edited in place. */
  function postToMoney(m, cards) {
    if (!m) return 0;
    m.labor = postingsFor(cards);
    return m.labor.length;
  }

  /* What the Money Room shows above the report: how much of this film is
     people, and where it sits. Dollars out, summed in cents. */
  function payrollSummary(cards) {
    var M = MM(), A = CHART();
    var list = (cards || []);
    var people = {}, byAcct = {}, errors = [];
    var t = { labor: 0, gross: 0, penalties: 0, fringes: 0, actual: 0, committed: 0 };
    var worked = 0, posted = 0;
    list.forEach(function (c) {
      if (String(c.status || '').toLowerCase() === 'void') return;
      var calc = laborCents(c);
      if (calc.error) { errors.push({ person: c.person || '', date: c.date || '', error: calc.error }); return; }
      posted++;
      if (c.person) people[c.person] = 1;
      worked += calc.worked || 0;
      t.gross += calc.grossCents; t.penalties += calc.penaltyCents;
      t.fringes += calc.fringeCents; t.labor += calc.laborCents;
      var bucket = postingKind(c.status);
      t[bucket] += calc.totalCents;
      byAcct[calc.acct] = (byAcct[calc.acct] || 0) + calc.laborCents;
      if (calc.fringeCents) byAcct[A.FRINGE_ACCT] = (byAcct[A.FRINGE_ACCT] || 0) + calc.fringeCents;
    });
    var dollarsByAcct = {};
    Object.keys(byAcct).sort().forEach(function (a) { dollarsByAcct[a] = M.dollars(byAcct[a]); });
    return {
      cards: posted, people: Object.keys(people).length,
      workedHours: Math.round(worked * 100) / 100,
      gross: M.dollars(t.gross), penalties: M.dollars(t.penalties),
      fringes: M.dollars(t.fringes), labor: M.dollars(t.labor),
      total: M.dollars(t.labor + t.fringes),
      actual: M.dollars(t.actual), committed: M.dollars(t.committed),
      byAcct: dollarsByAcct, errors: errors
    };
  }

  root.CPayroll = {
    LOG_KEY: LOG_KEY,
    cardFromLog: cardFromLog, laborAcct: laborAcct, laborCents: laborCents,
    cardPostings: cardPostings, postingsFor: postingsFor,
    postToMoney: postToMoney, payrollSummary: payrollSummary
  };
})(typeof window !== 'undefined' ? window : globalThis);
