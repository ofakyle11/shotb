/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — decimal money arithmetic (CMoneyMath)

   Money is decimal; a JavaScript number is a binary float. 0.1 + 0.2 is not
   0.3, 15924.6 prints as 15924.599999999999, and Math.round(-0.5) is -0 rather
   than -1 — so a negative variance rounds the wrong way. Left alone, those
   three facts produced a weekly cost report whose TOTAL row did not foot
   ($79 of phantom cost at 240 accounts, on the report that goes to the
   completion bond) and a CSV that opened in Excel full of raw floats.

   The rule here is the one accounting uses:
     · carry every figure as an INTEGER NUMBER OF CENTS,
     · round HALF AWAY FROM ZERO, once, at the point a fraction of a cent is
       created (a multiplication or a percentage), never on a sum,
     · convert back to dollars only at the edge — display, CSV, storage.

   A total is then the sum of the cents that were actually posted, so it foots
   by construction instead of by luck.

   Pure logic, no DOM, no dependencies.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* Tolerant parse: accepts 1234.56, "$1,234.56", " 1 234.56 ", "(50)" for a
     negative. Anything unreadable is 0 — a budget cell is never NaN. */
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).trim();
    if (!s) return 0;
    var neg = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '').replace(/[^0-9.eE+-]/g, '');
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return neg ? -Math.abs(n) : n;
  }

  /* The one rounding decision in the platform: half away from zero.
     Math.round is half-UP, which rounds -2.5 to -2 and quietly biases every
     negative variance toward zero. EPS absorbs the binary-float error that
     makes 1.005 * 100 come out as 100.49999999999999 and round DOWN. */
  var EPS = 1e-9;
  function roundHalfAway(x) {
    if (!isFinite(x)) return 0;
    return x < 0 ? -Math.round(-x + EPS) : Math.round(x + EPS);
  }

  /* dollars → integer cents */
  function cents(v) { return roundHalfAway(num(v) * 100); }
  /* integer cents → dollars, exact to the cent */
  function dollars(c) { return roundHalfAway(c) / 100; }

  /* Round a dollar amount to a fixed number of decimal places (default 2). */
  function round(v, dp) {
    var f = Math.pow(10, dp == null ? 2 : dp);
    return roundHalfAway(num(v) * f) / f;
  }

  /* Integer cents × a plain factor (a quantity, a rate, a percentage as a
     fraction). This is where fractions of a cent are created, so this is where
     they are resolved. */
  function mulCents(c, factor) { return roundHalfAway(roundHalfAway(c) * num(factor)); }
  /* Integer cents × pct expressed in percent (10 → 10%). */
  function pctOfCents(c, pct) { return mulCents(c, num(pct) / 100); }

  /* Sums take integers in and give an integer out — never a rounding site. */
  function sumCents(list) {
    var t = 0, i;
    for (i = 0; i < (list || []).length; i++) t += roundHalfAway(list[i]);
    return t;
  }
  /* Sum of dollar amounts, computed in cents so the total foots. */
  function sum(list) {
    var t = 0, i;
    for (i = 0; i < (list || []).length; i++) t += cents(list[i]);
    return dollars(t);
  }
  function add() {
    var t = 0, i;
    for (i = 0; i < arguments.length; i++) t += cents(arguments[i]);
    return dollars(t);
  }
  function mul(v, factor) { return dollars(mulCents(cents(v), factor)); }
  function pct(v, p) { return dollars(pctOfCents(cents(v), p)); }

  /* Two amounts are equal when they are the same to the cent. */
  function eq(a, b) { return cents(a) === cents(b); }

  /* ── edges ─────────────────────────────────────────────────────────────
     A number leaving the platform is a STRING with a fixed number of decimal
     places. `15924.599999999999` in a CSV is not a display bug — the producer
     opens it in Excel and it is what the column adds up. */
  function csvNum(v) {
    var d = dollars(cents(v));
    /* -0 prints as "-0.00" and reads as a credit that is not there. */
    if (d === 0) d = 0;
    return d.toFixed(2);
  }
  /* Whole-dollar CSV cell, for reports whose columns are stated in dollars. */
  function csvWhole(v) { return String(roundHalfAway(num(v))); }

  /* Display. Cents are shown only when there are cents to show — a top sheet
     of round numbers should not grow a column of ".00". */
  function fmt(v, opts) {
    var o = opts || {};
    var c = cents(v);
    var neg = c < 0;
    var abs = Math.abs(c);
    var showCents = o.cents === true || (o.cents !== false && abs % 100 !== 0);
    var whole = Math.floor(abs / 100);
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (showCents) s += '.' + String(abs % 100).padStart(2, '0');
    return (neg ? '-$' : '$') + s;
  }

  root.CMoneyMath = {
    num: num, cents: cents, dollars: dollars, round: round,
    roundHalfAway: roundHalfAway,
    mulCents: mulCents, pctOfCents: pctOfCents, sumCents: sumCents,
    sum: sum, add: add, mul: mul, pct: pct, eq: eq,
    csvNum: csvNum, csvWhole: csvWhole, fmt: fmt
  };
})(typeof window !== 'undefined' ? window : globalThis);
