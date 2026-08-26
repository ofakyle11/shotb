/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Festival Strategist engine (CFest)
   Pure logic, no DOM: a curated, honest major-festival directory (windows
   and fees are deliberately approximate — they drift every year), premiere-
   sequencing strategy, a submissions tracker with fee totals and deadline
   sorting, and a buyer CRM. No URLs, phone numbers, or exact dates are ever
   invented here — directory entries link to a Google search instead.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function uid() { return 'f' + Math.random().toString(36).slice(2, 9); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ── 0 · THE STORE — one shape for SB_Festivals_v1 ──────────────────────
     Two pages used to write this key with incompatible top-level types: the
     Tools register wrote a bare ARRAY of rows keyed [name, tier, deadline,
     fee, submitted, status, premiere, notes], this page wrote an OBJECT
     {premiereStatus, subs, buyers}. localStorage holds one value, so whichever
     page was opened second overwrote the other — Tools-first dropped every
     submission, buyer and the premiere status; object-first made the Tools tab
     throw `rows.reduce is not a function`. Owners lost real submissions.

     The OBJECT wins: it is the only one of the two that can carry the buyer
     CRM and the premiere status, which are the facts the strategy is computed
     from, and it can hold the Register's rows as `subs` without loss.
     migrate() reads BOTH legacy shapes, so an upgrade never costs an owner a
     row whichever page they used. Every field the Register wrote is kept —
     `name`→`festival`, `submitted`→`submittedOn`, `premiere`→`premiereReq`,
     and `status` maps to a `result` while the original word is preserved in
     `stage` so nothing an owner typed is thrown away. */
  var KEY = 'SB_Festivals_v1';
  var STORE_VERSION = 2;
  var PREMIERE_STATUSES = ['unpremiered', 'us-premiered', 'world-premiered'];
  /* The Tools register's richer status vocabulary, mapped onto the four
     results the tracker reasons about. */
  var LEGACY_STAGES = {
    'Planned': 'pending', 'Submitted': 'pending', 'In consideration': 'pending',
    'Accepted': 'accepted', 'Rejected': 'rejected', 'Premiered': 'accepted',
    'Withdrawn': 'withdrawn'
  };

  function blank() {
    return { v: STORE_VERSION, premiereStatus: 'unpremiered', subs: [], buyers: [] };
  }

  /* One submission record, whichever shape it arrived in. */
  function normSub(raw) {
    var r = raw || {};
    var result = RESULTS.indexOf(r.result) >= 0 ? r.result : null;
    var stage = r.stage || (LEGACY_STAGES[r.status] ? r.status : '');
    if (!result) result = LEGACY_STAGES[r.status] || 'pending';
    return {
      id: r.id || uid(),
      festival: String(r.festival || r.name || ''),
      category: String(r.category || ''),
      tier: String(r.tier || ''),
      deadline: String(r.deadline || ''),
      fee: num(r.fee),
      submittedOn: String(r.submittedOn || r.submitted || ''),
      result: result,
      stage: String(stage || ''),
      premiereReq: String(r.premiereReq || r.premiere || ''),
      notes: String(r.notes || '')
    };
  }
  function normBuyer(raw) {
    var b = newBuyer(raw || {});
    if (raw && raw.id) b.id = raw.id;
    return b;
  }

  /* migrate(raw) → the canonical store. Accepts the legacy ARRAY, the legacy
     OBJECT, null, and anything else without throwing. Pure. */
  function migrate(raw) {
    var store = blank();
    var subs = [], buyers = [];
    if (raw && Object.prototype.toString.call(raw) === '[object Array]') {
      subs = raw;                                   // legacy: bare Register rows
    } else if (raw && typeof raw === 'object') {
      subs = [].concat(raw.subs || [], raw.rows || []);
      buyers = raw.buyers || [];
      if (PREMIERE_STATUSES.indexOf(raw.premiereStatus) >= 0) store.premiereStatus = raw.premiereStatus;
    }
    var seen = {};
    subs.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var s = normSub(r);
      while (seen[s.id]) s.id = uid();
      seen[s.id] = 1;
      store.subs.push(s);
    });
    (buyers || []).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      store.buyers.push(normBuyer(b));
    });
    return store;
  }

  /* setSubs(store, rows) — the write path for a caller that owns its own row
     array (the Tools register replaces its array on delete rather than
     splicing, so the store has to be re-pointed at it). Every row is
     normalised on the way in, which is also what keeps a text input's "85"
     from becoming the stored fee. */
  function setSubs(store, rows) {
    store.subs = (rows || []).filter(function (r) { return r && typeof r === 'object'; }).map(normSub);
    return store;
  }

  /* The two pages read and write through these, so neither can invent a shape
     the other cannot read. load() migrates on the way in. */
  function load() {
    var raw = null;
    try { raw = JSON.parse((root.localStorage && root.localStorage.getItem(KEY)) || 'null'); }
    catch (e) { raw = null; }
    return migrate(raw);
  }
  function save(store) {
    try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
    return store;
  }

  /* Shown once above the directory — the honesty banner. */
  var BANNER = 'Windows and fees drift every year — verify on FilmFreeway or the festival site before planning.';

  var TIERS = ['A-list', 'major', 'genre', 'docs'];
  var TIER_LABELS = {
    'A-list': 'A-list — the premiere-hungry top table',
    'major':  'Major — serious launchpads and markets',
    'genre':  'Genre — horror / fantastic / midnight circuit',
    'docs':   'Docs — documentary-first festivals'
  };

  /* ── 1 · the majors — curated and deliberately approximate ─────────────── */
  var MAJORS = [
    { name: 'Sundance', city: 'Park City, USA', tier: 'A-list',
      seasonWindow: 'Festival late Jan; submissions roughly Jun–Sep the prior year',
      premiereNote: 'World premieres strongly favored for competition slots',
      feeHint: 'Submission fees roughly $65–110 by deadline tier' },
    { name: 'Cannes', city: 'Cannes, France', tier: 'A-list',
      seasonWindow: 'Festival mid-May; submissions typically Jan–Mar',
      premiereNote: 'Official Selection typically requires a world premiere (no prior public screening outside the country of origin)',
      feeHint: 'Modest entry fee typically charged — check the current entry rules' },
    { name: 'Venice', city: 'Venice, Italy', tier: 'A-list',
      seasonWindow: 'Festival late Aug–early Sep; submissions roughly May–Jun',
      premiereNote: 'World premieres required for competition',
      feeHint: 'Entry fee typically charged — check the current regulations' },
    { name: 'Berlinale', city: 'Berlin, Germany', tier: 'A-list',
      seasonWindow: 'Festival mid-Feb; submissions roughly Sep–Nov the prior year',
      premiereNote: 'Competition favors world or international premieres',
      feeHint: 'Submission fees roughly €50–150 depending on section and length' },
    { name: 'TIFF', city: 'Toronto, Canada', tier: 'A-list',
      seasonWindow: 'Festival early Sep; submissions roughly Mar–Jun',
      premiereNote: 'World or North American premieres favored for the flagship programmes',
      feeHint: 'Submission fees roughly CAD $100–200 by deadline tier' },
    { name: 'SXSW', city: 'Austin, USA', tier: 'major',
      seasonWindow: 'Festival mid-Mar; submissions roughly Jul–Oct the prior year',
      premiereNote: 'Premiere status weighed by section — world/US premieres favored in competition',
      feeHint: 'Submission fees roughly $55–100 by deadline tier' },
    { name: 'Telluride', city: 'Telluride, USA', tier: 'major',
      seasonWindow: 'Festival Labor Day weekend (early Sep); submissions roughly Jun–Jul; lineup famously unannounced until opening',
      premiereNote: 'Quietly premiere-driven — plays well with a Venice or TIFF one-two',
      feeHint: 'Submission fee typically charged, roughly $95+' },
    { name: 'Tribeca', city: 'New York, USA', tier: 'major',
      seasonWindow: 'Festival Jun; submissions roughly Sep–Jan',
      premiereNote: 'World, international, or North American premieres favored for competition',
      feeHint: 'Submission fees roughly $50–110 by deadline tier' },
    { name: 'Locarno', city: 'Locarno, Switzerland', tier: 'major',
      seasonWindow: 'Festival early Aug; submissions roughly Mar–May',
      premiereNote: 'World or international premieres favored for the main competitions',
      feeHint: 'Entry fee typically charged — check the current regulations' },
    { name: 'Rotterdam', city: 'Rotterdam, Netherlands', tier: 'major',
      seasonWindow: 'Festival late Jan–early Feb; submissions roughly Aug–Oct the prior year',
      premiereNote: 'Premieres favored for Tiger competition; adventurous first features do well',
      feeHint: 'Submission fees typically modest — check the current call' },
    { name: 'Hot Docs', city: 'Toronto, Canada', tier: 'docs',
      seasonWindow: 'Festival late Apr–early May; submissions roughly Oct–Jan',
      premiereNote: 'Documentaries only; premieres favored but not always required',
      feeHint: 'Submission fees roughly CAD $60–100 by deadline tier' },
    { name: 'Fantastic Fest', city: 'Austin, USA', tier: 'genre',
      seasonWindow: 'Festival late Sep; submissions roughly Feb–Jun',
      premiereNote: 'Genre-first — horror, fantasy, sci-fi, action; premiere status helps but is not everything',
      feeHint: 'Submission fees roughly $40–75 by deadline tier' },
    { name: 'AFI Fest', city: 'Los Angeles, USA', tier: 'major',
      seasonWindow: 'Festival late Oct; submissions roughly May–Aug',
      premiereNote: 'Strong awards-season showcase; premiere requirements vary by section',
      feeHint: 'Fees have varied year to year — some editions were free to enter' },
    { name: 'Slamdance', city: 'Park City / Los Angeles, USA', tier: 'major',
      seasonWindow: 'Festival late Jan; submissions roughly May–Oct the prior year',
      premiereNote: 'By filmmakers, for filmmakers — low-budget features without US distribution favored',
      feeHint: 'Submission fees roughly $30–85 by deadline tier' }
  ];

  /* No hardcoded festival URLs — honest search link instead. */
  function searchLink(name) {
    return 'https://www.google.com/search?q=' +
      encodeURIComponent(String(name || '') + ' film festival submission deadlines FilmFreeway');
  }

  function byTier(list) {
    var out = {};
    TIERS.forEach(function (t) { out[t] = []; });
    (list || MAJORS).forEach(function (f) {
      if (!out[f.tier]) out[f.tier] = [];
      out[f.tier].push(f);
    });
    return out;
  }

  /* ── 2 · premiere strategy ──────────────────────────────────────────────
     premiereStatus: 'unpremiered' | 'us-premiered' | 'world-premiered'     */
  function strategy(premiereStatus) {
    var s = String(premiereStatus || 'unpremiered');
    if (s === 'world-premiered') {
      return { status: s, tiers: ['major', 'genre', 'docs'],
        note: 'Your world premiere is spent — A-list competition slots are generally off the table. ' +
              'Chase regional premieres (continent, country, city) at majors, genre and docs festivals, ' +
              'and pivot energy toward markets, buyers and audience awards.' };
    }
    if (s === 'us-premiered') {
      return { status: s, tiers: ['major', 'genre', 'docs'],
        note: 'World and US premieres are spent. An international premiere may still open some European ' +
              'sections (Berlinale, Locarno, Rotterdam sometimes accept them) — read each rulebook. ' +
              'Otherwise target majors, genre and docs festivals with looser premiere rules.' };
    }
    return { status: 'unpremiered', tiers: ['A-list', 'major', 'genre', 'docs'],
      note: 'Everything is on the table — sequence carefully. Submit top-down and hold the world ' +
            'premiere for your highest realistic target: never burn it on a minor festival while an ' +
            'A-list answer is still pending, because you can only spend it once.' };
  }

  /* ── 3 · submissions tracker ───────────────────────────────────────────── */
  var RESULTS = ['pending', 'accepted', 'rejected', 'withdrawn'];
  function newSub(fields) {
    var f = fields || {};
    var s = normSub(f);
    s.id = uid();                 // a new submission is never someone else's row
    return s;
  }
  function setResult(subs, id, result) {
    if (RESULTS.indexOf(result) < 0) return null;
    var hit = null;
    (subs || []).forEach(function (s) { if (s.id === id) { s.result = result; hit = s; } });
    return hit;
  }
  /* paid = a submittedOn date is on record; planned = logged but not yet sent */
  function feesTotal(subs) {
    var paid = 0, planned = 0;
    (subs || []).forEach(function (s) {
      var f = num(s.fee);
      if (s.submittedOn) paid += f; else planned += f;
    });
    return { paid: paid, planned: planned, total: paid + planned };
  }
  /* Pending submissions sorted by user-entered deadline (ISO yyyy-mm-dd sorts
     lexicographically); entries whose deadline already passed are flagged.   */
  function upcoming(subs, todayISO) {
    var today = String(todayISO || '');
    return (subs || [])
      .filter(function (s) { return s.result === 'pending' && s.deadline; })
      .slice()
      .sort(function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0; })
      .map(function (s) {
        return { id: s.id, festival: s.festival, category: s.category, deadline: s.deadline,
                 fee: num(s.fee), submittedOn: s.submittedOn, result: s.result,
                 past: !!(today && s.deadline < today) };
      });
  }
  function resultCounts(subs) {
    var out = { pending: 0, accepted: 0, rejected: 0, withdrawn: 0 };
    (subs || []).forEach(function (s) { if (out[s.result] != null) out[s.result]++; });
    return out;
  }

  /* ── 4 · buyer CRM ─────────────────────────────────────────────────────── */
  function newBuyer(fields) {
    var f = fields || {};
    return { id: uid(), name: f.name || '', company: f.company || '',
      territory: f.territory || '', focus: f.focus || '',
      lastContact: f.lastContact || '', notes: f.notes || '' };
  }
  /* Buyers not contacted in `days` days (or never) — the follow-up list. */
  function staleBuyers(buyers, todayISO, days) {
    var d = days > 0 ? days : 30;
    var cutoff = shiftISO(String(todayISO || ''), -d);
    return (buyers || []).filter(function (b) {
      return !b.lastContact || (cutoff && b.lastContact < cutoff);
    });
  }
  function shiftISO(iso, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    var t = new Date(iso + 'T00:00:00Z').getTime() + days * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  function buyerSearchLink(b) {
    var q = [b.name, b.company, 'film acquisitions'].filter(function (x) { return x; }).join(' ');
    return 'https://www.google.com/search?q=' + encodeURIComponent(q);
  }

  /* ── 5 · distribution tie-in — count screeners out from SB_Dist_v1 ─────── */
  function screenersOut(distStore) {
    var list = (distStore && distStore.screeners) || [];
    var watched = 0;
    list.forEach(function (s) { if (s.watched) watched++; });
    return { out: list.length, watched: watched };
  }

  root.CFest = {
    BANNER: BANNER, MAJORS: MAJORS, TIERS: TIERS, TIER_LABELS: TIER_LABELS, RESULTS: RESULTS,
    KEY: KEY, STORE_VERSION: STORE_VERSION, PREMIERE_STATUSES: PREMIERE_STATUSES,
    LEGACY_STAGES: LEGACY_STAGES,
    blank: blank, normSub: normSub, normBuyer: normBuyer, migrate: migrate, setSubs: setSubs,
    load: load, save: save,
    searchLink: searchLink, byTier: byTier, strategy: strategy,
    newSub: newSub, setResult: setResult, feesTotal: feesTotal, upcoming: upcoming,
    resultCounts: resultCounts,
    newBuyer: newBuyer, staleBuyers: staleBuyers, shiftISO: shiftISO,
    buyerSearchLink: buyerSearchLink, screenersOut: screenersOut
  };
})(typeof window !== 'undefined' ? window : globalThis);
