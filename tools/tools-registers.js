/* Cinamate Tools — register tabs: Crew & Call-sheet distribution,
 * Festivals, Insurance (COI), Rights / chain of title, Buyers & Investors.
 * Built on the shared TCore.Register engine. All original code.
 */
(function (root) {
  'use strict';
  var C = root.TCore, esc = C.esc, fm = C.fmtMoney, num = C.num;
  root.TTabs = root.TTabs || {};

  function pane(id, title, desc) {
    var el = C.$('pane-' + id);
    el.innerHTML = '<h2>' + esc(title) + '</h2><p class="tk-desc">' + esc(desc) + '</p>';
    return el;
  }
  function section(host, title) {
    var d = document.createElement('div');
    if (title) d.innerHTML = '<h3 style="font-family:var(--display);font-size:13px;margin:16px 0 8px">' + esc(title) + '</h3>';
    var mountEl = document.createElement('div');
    d.appendChild(mountEl);
    host.appendChild(d);
    return mountEl;
  }

  /* ── Crew directory + call-sheet distribution ─────────────────── */
  root.TTabs.crew = function () {
    var el = pane('crew', 'Crew & Call Sheets',
      'Your crew database — roles, rates and the details a call sheet needs — plus a log of who received and confirmed each day\'s call sheet. Everything stays in this browser; export CSV any time.');
    var dir = new C.Register({
      key: 'SB_Crew_v1',
      hint: 'Rates feed the Timecards tool; names feed the Credit Roll.',
      fields: [
        { id: 'name', label: 'Name' }, { id: 'role', label: 'Role' },
        { id: 'dept', label: 'Dept', type: 'select', options: ['Production', 'Camera', 'Sound', 'G&E', 'Art', 'Wardrobe', 'HMU', 'Edit', 'Post', 'Other'] },
        { id: 'union', label: 'Union', type: 'select', options: ['Non-union', 'IATSE', 'DGA', 'SAG-AFTRA', 'Teamsters', 'Other'] },
        { id: 'rate', label: 'Rate ($/hr)', width: '80px' },
        { id: 'phone', label: 'Phone' }, { id: 'email', label: 'Email' },
        { id: 'dietary', label: 'Dietary' }, { id: 'emergency', label: 'Emergency contact' }
      ],
      summary: function (rows) {
        var by = {};
        rows.forEach(function (r) { by[r.dept || 'Other'] = (by[r.dept || 'Other'] || 0) + 1; });
        return '<b>' + rows.length + '</b> crew · ' + Object.keys(by).map(function (k) { return esc(k) + ' ' + by[k]; }).join(' · ');
      }
    });
    dir.render(section(el, 'Directory'));

    var dist = new C.Register({
      key: 'SB_CallDist_v1',
      hint: 'Track that every department actually got — and confirmed — the call sheet.',
      fields: [
        { id: 'day', label: 'Shoot day', width: '80px' },
        { id: 'name', label: 'Recipient' },
        { id: 'method', label: 'Sent via', type: 'select', options: ['Email', 'Text', 'Printed', 'App'] },
        { id: 'sent', label: 'Sent', type: 'date' },
        { id: 'status', label: 'Status', type: 'select', options: ['Sent', 'Opened', 'Confirmed', 'No response', 'Bounced'] },
        { id: 'notes', label: 'Notes' }
      ],
      summary: function (rows) {
        var confirmed = rows.filter(function (r) { return r.status === 'Confirmed'; }).length;
        var out = rows.filter(function (r) { return r.status === 'No response' || r.status === 'Bounced'; }).length;
        return '<b>' + esc(confirmed) + '</b>/' + rows.length + ' confirmed' + (out ? ' · <span class="tk-chip bad">' + esc(out) + ' unreached</span>' : '');
      }
    });
    dist.render(section(el, 'Call-sheet distribution log'));
  };

  /* ── Festivals ────────────────────────────────────────────────── */
  /* This tab and /festivals/ are two views of ONE store. They used to write
     SB_Festivals_v1 with incompatible top-level types — a bare array here, an
     object there — so opening one page destroyed the other's data. The shape
     now lives in festivals/lib-fest.js (CFest.migrate reads both legacy
     shapes); this register is BOUND to that store's `subs` array rather than
     loading a private copy, and its field ids are the canonical field names,
     so a row typed here is the same record the Strategist reads. */
  root.TTabs.festivals = function () {
    var F = root.CFest;
    if (!F) throw new Error('tools-registers.js festivals tab requires festivals/lib-fest.js');
    var el = pane('festivals', 'Festival Submissions',
      'Deadlines, fees and outcomes for every festival on the strategy — the same records the Festival Strategist works from. Deadline chips go amber at 30 days and red past due.');
    var store = F.load();
    var reg = new C.Register({
      key: 'SB_Festivals_v1',
      expiryField: 'deadline',
      fields: [
        { id: 'festival', label: 'Festival' },
        { id: 'category', label: 'Category / section' },
        { id: 'tier', label: 'Tier', type: 'select', options: ['', 'A-list', 'major', 'genre', 'docs'] },
        { id: 'deadline', label: 'Deadline', type: 'date', width: '150px' },
        { id: 'fee', label: 'Fee ($)', width: '70px' },
        { id: 'submittedOn', label: 'Submitted', type: 'date', width: '130px' },
        { id: 'result', label: 'Result', type: 'select', options: ['pending', 'accepted', 'rejected', 'withdrawn'] },
        { id: 'premiereReq', label: 'Premiere req.', type: 'select', options: ['', 'None', 'World', 'International', 'North American', 'US', 'Regional'] },
        { id: 'notes', label: 'Notes' }
      ],
      blank: function () { return F.newSub({}); },
      summary: function (rows) {
        var fees = F.feesTotal(rows), counts = F.resultCounts(rows);
        var due = F.upcoming(rows, C.today()).filter(function (s) {
          var d = C.daysUntil(s.deadline); return d != null && d >= 0 && d <= 30;
        }).length;
        return '<b>' + rows.length + '</b> festivals · fees ' + fm(fees.total) +
          ' (' + fm(fees.paid) + ' paid) · <b>' + esc(counts.accepted) + '</b> accepted' +
          (due ? ' · <span class="tk-chip warn">' + esc(due) + ' deadline' + (due === 1 ? '' : 's') + ' within 30d</span>' : '');
      }
    });
    /* Bound, not copied: the register edits the canonical store in place and
       persists the whole object, so neither writer can clobber the other. */
    reg.rows = store.subs;
    /* Register.remove() REPLACES rows with a filtered array, so the store has
       to be re-pointed at it on every write or a delete would never persist. */
    reg.persist = function () { F.save(F.setSubs(store, reg.rows)); };
    reg.render(section(el));
    el.insertAdjacentHTML('beforeend', '<p class="tk-note">Premiere-requirement column matters: an A-list world-premiere rule means submitting there first — sequence the plan around it. Strategy, buyer CRM and the majors directory are in <a class="fs-link" href="/festivals/">Festivals →</a></p>');
  };

  /* ── Insurance / COI register ─────────────────────────────────── */
  root.TTabs.insurance = function () {
    var el = pane('insurance', 'Insurance & Certificates',
      'Every policy and certificate of insurance in one register — limits, additional insureds and expiry warnings. Locations and lenders will ask for these; now they are one click away.');
    new C.Register({
      key: 'SB_Insurance_v1',
      expiryField: 'expiry',
      fields: [
        { id: 'kind', label: 'Type', type: 'select', options: ['General liability', 'E&O', 'Production package', 'Workers comp', 'Auto', 'Drone', 'COI issued'] },
        { id: 'carrier', label: 'Carrier / broker' },
        { id: 'policy', label: 'Policy #' },
        { id: 'limits', label: 'Limits' },
        { id: 'insured', label: 'Additional insured' },
        { id: 'effective', label: 'Effective', type: 'date', width: '130px' },
        { id: 'expiry', label: 'Expires', type: 'date', width: '150px' },
        { id: 'premium', label: 'Premium ($)', width: '80px' },
        { id: 'notes', label: 'Notes' }
      ],
      summary: function (rows) {
        var soon = rows.filter(function (r) { var d = C.daysUntil(r.expiry); return d != null && d < 30 && d >= 0; }).length;
        var dead = rows.filter(function (r) { var d = C.daysUntil(r.expiry); return d != null && d < 0; }).length;
        var prem = rows.reduce(function (s, r) { return s + num(r.premium); }, 0);
        return '<b>' + rows.length + '</b> policies/certs · premiums ' + fm(prem) +
          (soon ? ' · <span class="tk-chip warn">' + esc(soon) + ' expiring &lt;30d</span>' : '') +
          (dead ? ' · <span class="tk-chip bad">' + esc(dead) + ' expired</span>' : '');
      }
    }).render(section(el));
  };

  /* ── Rights / chain of title ──────────────────────────────────── */
  root.TTabs.rights = function () {
    var el = pane('rights', 'Rights & Chain of Title',
      'The rights graph behind the picture: underlying material, options, music, archival, locations and distribution grants — with territory, media, term and status. Distributors and E&O insurers will ask for exactly this.');
    new C.Register({
      key: 'SB_Rights_v1',
      expiryField: 'termEnd',
      fields: [
        { id: 'material', label: 'Work / material' },
        { id: 'kind', label: 'Agreement', type: 'select', options: ['Underlying rights', 'Option', 'Purchase', 'Life rights', 'Writer agreement', 'Music sync', 'Music master', 'Archival license', 'Location release', 'Appearance release', 'Distribution grant'] },
        { id: 'party', label: 'Counterparty' },
        { id: 'territory', label: 'Territory' },
        { id: 'media', label: 'Media', type: 'select', options: ['All media', 'Theatrical', 'Streaming', 'TV', 'Festival only', 'Educational'] },
        { id: 'termStart', label: 'Term start', type: 'date', width: '130px' },
        { id: 'termEnd', label: 'Term end / reversion', type: 'date', width: '150px' },
        { id: 'fee', label: 'Fee ($)', width: '80px' },
        { id: 'status', label: 'Status', type: 'select', options: ['Negotiating', 'Drafted', 'Executed', 'Expired', 'Reverted'] },
        { id: 'notes', label: 'Notes' }
      ],
      summary: function (rows) {
        var gaps = rows.filter(function (r) { return r.status !== 'Executed'; }).length;
        var fees = rows.reduce(function (s, r) { return s + num(r.fee); }, 0);
        return '<b>' + rows.length + '</b> agreements · fees ' + fm(fees) +
          (gaps ? ' · <span class="tk-chip warn">' + esc(gaps) + ' not yet executed — chain gap</span>' : ' · <span class="tk-chip good">chain complete</span>');
      }
    }).render(section(el));
  };

  /* ── Buyers & investors pipeline ─────────────────────────────── */
  root.TTabs.deals = function () {
    var el = pane('deals', 'Buyers & Investors',
      'The deal pipeline: distributors, streamers, sales agents and investors — who has the screener, who made an offer, where every conversation stands.');
    new C.Register({
      key: 'SB_Deals_v1',
      fields: [
        { id: 'contact', label: 'Contact' },
        { id: 'company', label: 'Company' },
        { id: 'kind', label: 'Type', type: 'select', options: ['Distributor', 'Streamer', 'Sales agent', 'Broadcaster', 'Investor', 'Grantor'] },
        { id: 'territory', label: 'Territory / scope' },
        { id: 'stage', label: 'Stage', type: 'select', options: ['Lead', 'Contacted', 'Screener sent', 'Offer', 'Negotiation', 'Closed', 'Passed'] },
        { id: 'value', label: 'Value ($)', width: '90px' },
        { id: 'last', label: 'Last contact', type: 'date', width: '130px' },
        { id: 'notes', label: 'Notes' }
      ],
      summary: function (rows) {
        var open = rows.filter(function (r) { return ['Screener sent', 'Offer', 'Negotiation'].indexOf(r.stage) >= 0; });
        var closed = rows.filter(function (r) { return r.stage === 'Closed'; });
        var pipe = open.reduce(function (s, r) { return s + num(r.value); }, 0);
        var won = closed.reduce(function (s, r) { return s + num(r.value); }, 0);
        return '<b>' + rows.length + '</b> contacts · active pipeline <b>' + fm(pipe) + '</b> across ' + open.length + ' deals · closed ' + fm(won);
      }
    }).render(section(el));
  };
})(typeof window !== 'undefined' ? window : globalThis);
