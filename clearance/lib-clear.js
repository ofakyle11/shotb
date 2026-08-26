/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Clearance Scanner engine (CClear)
   The pre-E&O script clearance read, automated: every scene scanned for
   the things clearance houses bill thousands to find — real brands and
   companies, music references, on-screen artwork, phone numbers that are
   not 555s, real people, broadcast/archival footage, and currency
   reproduction. Findings carry the standard action for their category,
   and the module drafts the release/permission letters. Pure logic.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-clear.js requires js/lib-scenes.js to be loaded first');


  /* well-known marks — presence in action/dialogue is a clearance flag */
  var BRANDS = ('Coca-Cola Coke Pepsi Sprite Fanta Red Bull Budweiser Heineken Corona ' +
    'Jack Daniels Smirnoff Absolut Bacardi Marlboro Camel McDonald’s McDonalds Burger King ' +
    'KFC Subway Starbucks Dunkin Nike Adidas Reebok Puma Levi’s Levis Gucci Prada Chanel ' +
    'Louis Vuitton Rolex Omega Ray-Ban Apple iPhone iPad MacBook Google Android Samsung Sony ' +
    'Microsoft Windows Xbox PlayStation Nintendo Facebook Instagram Twitter TikTok YouTube ' +
    'Netflix Disney Amazon FedEx UPS DHL Walmart Target IKEA Ford Chevrolet Chevy Toyota ' +
    'Honda Tesla BMW Mercedes Porsche Ferrari Jeep Harley-Davidson Boeing Airbus Visa ' +
    'Mastercard American Express Barbie Lego Nerf Zippo Sharpie Post-it Kleenex Band-Aid ' +
    'Jacuzzi Frisbee Velcro Photoshop Uber Lyft Airbnb Monopoly Cheerios Oreo Doritos ' +
    'Pringles Gatorade Tylenol Advil Viagra Botox Winnebago Cadillac Rolls-Royce Bentley').split(' ');
  var BRAND_RE = new RegExp('\\b(' + BRANDS.map(function (b) {
    return b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|') + ')\\b', 'g');

  var DETECTORS = [
    { cat: 'music', risk: 'high', action: 'Sync + master license required before the cut locks — or replace with original score',
      re: /\b(sings?|singing|hums?|humming|song|lyrics|jukebox|radio plays|band plays|karaoke|whistles the tune)\b[^\n]*/gi },
    { cat: 'phone', risk: 'high', action: 'Replace with a 555-01XX number or a number the production controls',
      re: /(?:\(\d{3}\)\s?|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b/g,
      keep: function (m) { return !/555[-. ]?01\d\d$/.test(m.replace(/\D/g, '').slice(-7)) && m.indexOf('555') < 0; } },
    { cat: 'artwork', risk: 'medium', action: 'Clear the underlying work or dress with production-owned art',
      re: /\b(painting of|portrait of|poster (?:of|for)|photograph of|mural|sculpture of|album cover)\b[^\n]*/gi },
    { cat: 'footage', risk: 'high', action: 'License archival/broadcast material or shoot an original insert',
      re: /\b(news footage|archival footage|newsreel|broadcast of|clip (?:of|from)|on the TV,? (?:a|the)|stock footage)\b[^\n]*/gi },
    { cat: 'realperson', risk: 'high', action: 'Legal review — living persons need consent or clear public-figure commentary basis',
      re: /\b(?:President|Senator|Governor|Mayor|Pope|Queen|King|Prince(?:ss)?)\s+[A-Z][a-z]+\b[^\n]*/g },
    { cat: 'currency', risk: 'medium', action: 'Use prop money compliant with reproduction rules (over/under-size, one-sided)',
      re: /\b(counterfeit|prints? (?:money|bills|currency)|photocop\w+ (?:a |the )?(?:bill|money)|stacks of (?:real )?cash)\b[^\n]*/gi },
    { cat: 'signage', risk: 'low', action: 'Verify signage is fictional or greeked; clear any real storefront marks',
      re: /\b(billboard|neon sign|storefront sign|marquee)\b[^\n]*/gi }
  ];

  var splitScenes = CS.split;

  function excerpt(text, index, len) {
    var start = Math.max(0, index - 30);
    return (start ? '…' : '') + text.slice(start, index + len + 40).replace(/\s+/g, ' ').trim() + '…';
  }

  /* scan(scriptText) → findings sorted by scene */
  function scan(scriptText) {
    var findings = [];
    var seen = {};
    splitScenes(scriptText).forEach(function (sc) {
      var text = sc.body.join('\n');
      var m;
      BRAND_RE.lastIndex = 0;
      while ((m = BRAND_RE.exec(text)) !== null) {
        var key = 'brand|' + sc.n + '|' + m[0].toLowerCase();
        if (seen[key]) continue; seen[key] = 1;
        findings.push({ id: 'c' + findings.length, scene: sc.n, sceneLabel: sc.label, cat: 'brand', term: m[0],
          risk: 'medium', excerpt: excerpt(text, m.index, m[0].length),
          action: 'Product-placement agreement, greek the mark, or swap for a cleared fictional brand',
          status: 'pending' });
      }
      DETECTORS.forEach(function (d) {
        d.re.lastIndex = 0;
        while ((m = d.re.exec(text)) !== null) {
          if (d.keep && !d.keep(m[0])) continue;
          var key2 = d.cat + '|' + sc.n + '|' + m[0].slice(0, 40).toLowerCase();
          if (seen[key2]) continue; seen[key2] = 1;
          findings.push({ id: 'c' + findings.length, scene: sc.n, sceneLabel: sc.label, cat: d.cat,
            term: m[0].slice(0, 60), risk: d.risk,
            excerpt: excerpt(text, m.index, Math.min(m[0].length, 60)),
            action: d.action, status: 'pending' });
        }
      });
    });
    return findings;
  }

  /* ── E&O readiness ─────────────────────────────────────────────────────
     "E&O-ready" is a representation made to an insurer, so it is computed
     from the state of the clearance work — not from whether anybody typed
     anything. The old rule was `open === 0` where open counted only findings
     still marked `pending`: set every finding to "accepted risk" and the page
     turned green with ZERO items actually cleared, and an empty chain of
     title, no music licences and no certificate of insurance still read
     CLEAR because those stores were never consulted.

     A finding is RESOLVED only when it is cleared or rewritten. "Accepted
     risk" is a decision to carry it — a disclosure the underwriter must see,
     never a clearance. Everything else is a blocker with a name. */
  var RESOLVED = ['cleared', 'rewritten'];
  var STATUSES = ['pending', 'cleared', 'rewritten', 'accepted risk'];
  var CHAIN_KINDS = ['Underlying rights', 'Option', 'Purchase', 'Life rights', 'Writer agreement'];

  function isResolved(f) { return RESOLVED.indexOf(f && f.status) >= 0; }

  /* summary(findings, ctx?) — ctx is the rest of the E&O file, read from the
     stores that already hold it:
       ctx.rights     SB_Rights_v1 rows   [{material,kind,party,termEnd,status}]
       ctx.music      SB_Music_v1 store   {cues:[{title,status,scope}]}
       ctx.insurance  SB_Insurance_v1 rows[{kind,carrier,policy,expiry}]
       ctx.todayISO   the caller's date — this module never calls Date.now()
     With no ctx the finding maths still runs and the three file blockers are
     reported as UNKNOWN rather than silently passing. */
  function summary(findings, ctx) {
    var list = findings || [];
    var c = ctx || {};
    var by = {};
    list.forEach(function (f) {
      by[f.cat] = by[f.cat] || { total: 0, cleared: 0, high: 0 };
      by[f.cat].total++;
      if (isResolved(f)) by[f.cat].cleared++;
      if (f.risk === 'high' && !isResolved(f)) by[f.cat].high++;
    });
    var pending = list.filter(function (f) { return f.status === 'pending'; }).length;
    var accepted = list.filter(function (f) { return f.status === 'accepted risk'; }).length;
    var open = list.filter(function (f) { return !isResolved(f); }).length;

    var blockers = [];
    var disclosures = [];
    if (pending) blockers.push({ id: 'findings', label: pending + ' script finding' + (pending === 1 ? '' : 's') +
      ' still pending', detail: 'Clear, rewrite, or record an accepted risk against every one.' });
    if (accepted) disclosures.push({ id: 'accepted-risk', label: accepted + ' finding' + (accepted === 1 ? '' : 's') +
      ' carried as accepted risk', detail: 'Not cleared — list each one on the application; the underwriter decides, not the production.' });

    /* chain of title */
    var rights = c.rights;
    if (!rights) blockers.push({ id: 'chain', label: 'Chain of title not checked',
      detail: 'Rights register (Tools › Rights & chain of title) was not read.', unknown: true });
    else {
      var executed = rights.filter(function (r) { return r.status === 'Executed'; });
      var gaps = rights.filter(function (r) { return r.status && r.status !== 'Executed'; });
      var hasUnderlying = executed.some(function (r) { return CHAIN_KINDS.indexOf(r.kind) >= 0; });
      if (!hasUnderlying) blockers.push({ id: 'chain', label: 'No executed underlying-rights agreement',
        detail: 'The chain starts with an executed option, purchase, life-rights or writer agreement. Nothing on file.' });
      if (gaps.length) blockers.push({ id: 'chain-gaps', label: gaps.length + ' rights agreement' +
        (gaps.length === 1 ? '' : 's') + ' not executed',
        detail: gaps.map(function (r) { return (r.material || 'untitled') + ' — ' + (r.status || 'no status'); }).join('; ') });
    }

    /* music licences */
    var music = c.music;
    if (!music) blockers.push({ id: 'music', label: 'Music licences not checked',
      detail: 'SB_Music_v1 (Music Rights & Score) was not read.', unknown: true });
    else {
      var cues = (music.cues || music || []).filter(function (q) { return q && q.status !== 'replaced'; });
      var unlicensed = cues.filter(function (q) { return q.status !== 'licensed'; });
      var festivalOnly = cues.filter(function (q) { return q.status === 'licensed' && q.scope === 'festival'; });
      if (unlicensed.length) blockers.push({ id: 'music', label: unlicensed.length + ' music cue' +
        (unlicensed.length === 1 ? '' : 's') + ' not licensed',
        detail: unlicensed.map(function (q) { return (q.title || 'untitled cue') + ' — ' + (q.status || 'no status'); }).join('; ') });
      if (festivalOnly.length) disclosures.push({ id: 'music-scope', label: festivalOnly.length + ' cue' +
        (festivalOnly.length === 1 ? '' : 's') + ' licensed for festivals only',
        detail: 'A festival-only sync does not cover distribution — exercise the step-up before delivery.' });
    }

    /* certificate of insurance */
    var ins = c.insurance;
    if (!ins) blockers.push({ id: 'eo-policy', label: 'E&O policy not checked',
      detail: 'Insurance register (Tools › Insurance & certificates) was not read.', unknown: true });
    else {
      var eo = ins.filter(function (r) { return r.kind === 'E&O'; });
      var live = eo.filter(function (r) { return !c.todayISO || !r.expiry || r.expiry >= c.todayISO; });
      if (!eo.length) blockers.push({ id: 'eo-policy', label: 'No E&O policy on file',
        detail: 'Log the policy or the broker submission in the insurance register.' });
      else if (!live.length) blockers.push({ id: 'eo-policy', label: 'E&O policy expired',
        detail: eo.map(function (r) { return (r.carrier || 'carrier unknown') + ' expired ' + (r.expiry || '—'); }).join('; ') });
    }

    return { byCategory: by, open: open, pending: pending, acceptedRisk: accepted,
             resolved: list.length - open, total: list.length,
             blockers: blockers, disclosures: disclosures,
             checked: !!(c.rights && c.music && c.insurance),
             eoReady: blockers.length === 0 };
  }

  /* ── the letters ──────────────────────────────────────────────────── */
  function head(o) {
    return (o.company || 'CINAMATE production office') + '\nRe: "' + (o.production || 'Untitled production') + '"\n\n';
  }
  function materialsRequest(o) {
    return head(o) + 'To whom it may concern,\n\n' +
      'We are producing the above motion picture and request permission to feature the following ' +
      'material on screen:\n\n    ' + (o.item || '[describe the material]') + '\n    Context: ' +
      (o.context || 'scene ' + (o.scene || '')) + '\n\n' +
      'The material would appear incidentally, portrayed in a non-disparaging manner. We are happy ' +
      'to provide the relevant script pages and discuss terms, credit and approval of the depiction.\n\n' +
      'Kind regards,\n' + (o.contact || '') + '\n';
  }
  function appearanceRelease(o) {
    return head(o) + 'APPEARANCE RELEASE\n\n' +
      'I, ' + (o.name || '____________________') + ', grant the production the irrevocable right to ' +
      'record and use my appearance, likeness and voice in the picture and its marketing, worldwide, ' +
      'in perpetuity, in all media now known or later devised. I make this grant ' +
      (o.consideration || 'for good and valuable consideration received') + '.\n\n' +
      'Signature: ______________________   Date: ____________\n';
  }
  function locationRelease(o) {
    return head(o) + 'LOCATION RELEASE\n\n' +
      'The undersigned, owner/agent of the premises at ' + (o.address || '____________________') +
      ', grants the production access to enter and film at the premises on the agreed dates, and the ' +
      'right to use recordings made there in the picture and its marketing, worldwide, in perpetuity. ' +
      'The production will restore the premises to its prior condition, ordinary wear excepted, and ' +
      'carries production liability insurance available on request.\n\n' +
      'Owner/Agent: ______________________   Date: ____________\n';
  }
  function syncRequest(o) {
    return head(o) + 'SYNCHRONIZATION LICENSE REQUEST\n\n' +
      'We request a quote for synchronization (and master use, where you control the recording) of:\n\n' +
      '    Work: ' + (o.item || '[title]') + '\n    Use: ' + (o.context || 'background vocal, ~30 seconds') +
      '\n    Media: all media, worldwide, in perpetuity (festival-only step deal welcome)\n\n' +
      'Please advise your fee structure and any required credit language.\n\nKind regards,\n' + (o.contact || '') + '\n';
  }

  root.CClear = {
    BRANDS: BRANDS, STATUSES: STATUSES, RESOLVED: RESOLVED, CHAIN_KINDS: CHAIN_KINDS,
    splitScenes: splitScenes, scan: scan, summary: summary, isResolved: isResolved,
    materialsRequest: materialsRequest, appearanceRelease: appearanceRelease,
    locationRelease: locationRelease, syncRequest: syncRequest
  };
})(typeof window !== 'undefined' ? window : globalThis);
