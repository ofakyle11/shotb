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

  function summary(findings) {
    var by = {};
    (findings || []).forEach(function (f) {
      by[f.cat] = by[f.cat] || { total: 0, cleared: 0, high: 0 };
      by[f.cat].total++;
      if (f.status === 'cleared' || f.status === 'rewritten') by[f.cat].cleared++;
      if (f.risk === 'high' && f.status === 'pending') by[f.cat].high++;
    });
    var open = (findings || []).filter(function (f) { return f.status === 'pending'; }).length;
    return { byCategory: by, open: open, total: (findings || []).length,
             eoReady: open === 0 };
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
    BRANDS: BRANDS, splitScenes: splitScenes, scan: scan, summary: summary,
    materialsRequest: materialsRequest, appearanceRelease: appearanceRelease,
    locationRelease: locationRelease, syncRequest: syncRequest
  };
})(typeof window !== 'undefined' ? window : globalThis);
