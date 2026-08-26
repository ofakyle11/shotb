/* ═══════════════════════════════════════════════════════════════════════════
   CINAMATE — Music Rights & Score engine (CMusic)
   Pure logic, no DOM: scan the screenplay for music moments (sings, songs,
   jukeboxes, radios, bands, karaoke, quoted titles), keep a cue list with
   tier/use/scope/status, produce clearly-labeled PLANNING estimates for
   sync + master licensing, compare against commissioning an original score,
   draft license request letters, and export a delivery cue sheet.
   No prices here are quotes — every figure is an estimate range midcalc and
   is labeled as such; real numbers come from the rights holders.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  /* The one scene model — js/lib-scenes.js. Every module used to carry its
     own screenplay splitter; they disagreed on preambles, printed scene
     numbers and A/B scenes, so they now all read from here. Loaded by a
     <script> tag before this file, and by the node suites. */
  var CS = root.CScenes;
  if (!CS) throw new Error('lib-music.js requires js/lib-scenes.js to be loaded first');


  /* ── 1 · vocabulary ───────────────────────────────────────────────────── */
  var USES = ['background', 'featured', 'main title', 'end credits'];
  var SCOPES = ['festival', 'all-media'];
  var STATUSES = ['identified', 'quote requested', 'quoted', 'licensed', 'replaced'];
  var FESTIVAL_FACTOR = 0.15;

  /* Planning ranges in USD, per side (sync OR master), all-media scope.
     Library music is the exception: one all-in fee covers both sides. */
  var TIERS = [
    { id: 'library', label: 'Library / production music', low: 50, high: 500, allIn: true,
      note: 'One all-in fee typically covers sync and master together.' },
    { id: 'indie', label: 'Indie / unsigned artist', low: 500, high: 5000 },
    { id: 'known', label: 'Known artist / catalog', low: 5000, high: 25000 },
    { id: 'famous', label: 'Famous artist / major hit', low: 25000, high: 250000 }
  ];
  var TIER_BY_ID = {};
  TIERS.forEach(function (t) { TIER_BY_ID[t.id] = t; });

  /* ── 2 · script scan ──────────────────────────────────────────────────── */
  var splitScenes = CS.split;

  /* Ordered — first hit decides the suggested use. Performance words
     (sings, karaoke, band plays) suggest featured; source/ambient words
     (jukebox, radio, hums, a quoted title that "plays") suggest background. */
  var CUE_TERMS = [
    { term: 'sings', re: /\bsing(?:s|ing)?\b/i, use: 'featured' },
    { term: 'karaoke', re: /\bkaraoke\b/i, use: 'featured' },
    { term: 'band plays', re: /\bband\b[^.\n]{0,40}\bplay(?:s|ing)?\b/i, use: 'featured' },
    { term: 'jukebox', re: /\bjukebox\b/i, use: 'background' },
    { term: 'radio plays', re: /\bradio\b[^.\n]{0,40}\bplay(?:s|ing)?\b/i, use: 'background' },
    { term: 'hums', re: /\bhum(?:s|ming)?\b/i, use: 'background' },
    { term: 'quoted title', re: /["“][^"”\n]{2,60}["”][^\n]{0,50}\bplay(?:s|ing)?\b/i, use: 'background' },
    { term: 'quoted title', re: /\bplay(?:s|ing)?\b[^\n]{0,50}["“][^"”\n]{2,60}["”]/i, use: 'background' },
    { term: 'song', re: /\bsongs?\b/i, use: 'background' }
  ];
  var QUOTED_RE = /["“]([^"”\n]{2,60})["”]/;

  /* scanScript(scriptText) → [{scene, excerpt, suggestedUse, title, term}] —
     one hit per matching line; a quoted string on the line becomes the
     suggested title. */
  function scanScript(scriptText) {
    var scenes = splitScenes(scriptText);
    var hits = [];
    scenes.forEach(function (sc) {
      sc.body.forEach(function (raw) {
        var line = String(raw).trim();
        if (!line) return;
        var use = null, term = '';
        for (var i = 0; i < CUE_TERMS.length; i++) {
          if (CUE_TERMS[i].re.test(line)) { use = CUE_TERMS[i].use; term = CUE_TERMS[i].term; break; }
        }
        if (!use) return;
        var qm = line.match(QUOTED_RE);
        hits.push({ scene: sc.n, sceneLabel: sc.label, excerpt: line.length > 160 ? line.slice(0, 157) + '…' : line,
                    suggestedUse: use, title: qm ? qm[1].trim() : '', term: term });
      });
    });
    return hits;
  }

  /* ── 3 · cues ─────────────────────────────────────────────────────────── */
  function makeCue(f) {
    f = f || {};
    return {
      id: f.id || 'c' + Math.random().toString(36).slice(2, 9),
      title: f.title || 'Untitled cue',
      artist: f.artist || '',
      scene: +f.scene || 0,
      excerpt: f.excerpt || '',
      use: USES.indexOf(f.use) >= 0 ? f.use : 'background',
      tier: TIER_BY_ID[f.tier] ? f.tier : 'indie',
      scope: SCOPES.indexOf(f.scope) >= 0 ? f.scope : 'all-media',
      status: STATUSES.indexOf(f.status) >= 0 ? f.status : 'identified',
      syncEst: +f.syncEst || 0, masterEst: +f.masterEst || 0,
      actualQuote: +f.actualQuote || 0,
      publisher: f.publisher || '', masterOwner: f.masterOwner || '',
      committedPo: !!f.committedPo,
      manual: !!f.manual
    };
  }
  function cueFromHit(hit) {
    return makeCue({
      title: hit.title || 'Scene ' + hit.scene + ' music (' + hit.term + ')',
      scene: hit.scene, excerpt: hit.excerpt, use: hit.suggestedUse
    });
  }

  function setStatus(cue, status) {
    if (!cue || STATUSES.indexOf(status) < 0) return null;
    cue.status = status;
    return cue;
  }
  /* The normal flow; licensed and replaced are terminal. */
  function nextStatus(status) {
    var i = STATUSES.indexOf(status);
    if (i < 0 || status === 'licensed' || status === 'replaced') return null;
    return STATUSES[i + 1];
  }

  /* ── 4 · planning estimates ───────────────────────────────────────────── */
  function perSide(tier, use) {
    var mid = (tier.low + tier.high) / 2;
    if (use === 'main title' || use === 'end credits') return mid * 1.5;
    if (use === 'featured') return (mid + tier.high) / 2;   // top half of the range
    return (tier.low + mid) / 2;                            // background: bottom half
  }

  /* estimate(cue) → {sync, master, total, note}. Both sides are needed for
     any commercial recording; library tracks are one all-in fee. Figures
     are PLANNING estimates only — real quotes come from the rights holders. */
  function estimate(cue) {
    var tier = TIER_BY_ID[cue.tier] || TIER_BY_ID.indie;
    var side = perSide(tier, cue.use);
    var festival = cue.scope === 'festival';
    if (festival) side = side * FESTIVAL_FACTOR;
    var sync = Math.round(side);
    var master = tier.allIn ? 0 : Math.round(side);
    var note = 'Planning estimate only — ' + tier.label + ', ' + cue.use + ' use, ' +
      (tier.allIn ? 'one all-in fee' : 'per side (sync + master both required)') +
      (festival ? '; festival-only ≈15% of the all-media figure — negotiate a step-up option to full rights now, before you need them' : '') +
      '. Real fees vary widely; verify with the publisher and label before relying on this.';
    return { sync: sync, master: master, total: sync + master, note: note };
  }

  /* Working number for one cue: the real quote once you have it, the
     planning estimate until then; a replaced cue costs nothing. */
  function cueCost(cue) {
    if (cue.status === 'replaced') return 0;
    return cue.actualQuote > 0 ? cue.actualQuote : estimate(cue).total;
  }

  function totals(cues) {
    var out = { est: 0, working: 0, quoted: 0, licensed: 0, count: 0, byStatus: {} };
    (cues || []).forEach(function (c) {
      out.byStatus[c.status] = (out.byStatus[c.status] || 0) + 1;
      if (c.status === 'replaced') return;
      out.count++;
      out.est += estimate(c).total;
      out.working += cueCost(c);
      if (c.actualQuote > 0) out.quoted += c.actualQuote;
      if (c.status === 'licensed' && c.actualQuote > 0) out.licensed += c.actualQuote;
    });
    return out;
  }

  /* scoreComparison(minutes) — commissioning an original score instead,
     at the indie range of $100–$400 per finished minute. */
  function scoreComparison(minutes) {
    var m = Math.max(0, +minutes || 0);
    return {
      low: Math.round(m * 100), high: Math.round(m * 400),
      note: 'Commissioned original score, indie range $100–$400 per finished minute of music. ' +
        'Planning estimate only — composer fees swing with orchestration, live players, and ' +
        'delivery format; verify with real composer quotes before relying on it. An original ' +
        'score is cleared by one work-for-hire agreement instead of per-song licenses.'
    };
  }

  /* ── 5 · license request letter ───────────────────────────────────────── */
  function licenseRequest(o) {
    o = o || {};
    var c = o.cue || {};
    var tier = TIER_BY_ID[c.tier] || TIER_BY_ID.indie;
    var scopeLine = c.scope === 'festival'
      ? 'Film-festival exhibition only at this stage; please include a step-up option to all media, worldwide, in perpetuity.'
      : 'All media, worldwide, in perpetuity.';
    return (o.company || 'CINAMATE production office') + '\nRe: "' + (o.production || 'Untitled production') + '"\n\n' +
      'MUSIC SYNCHRONIZATION & MASTER USE LICENSE REQUEST\n\n' +
      'To whom it may concern,\n\n' +
      'We are producing the above independent motion picture and request a quote to license ' +
      'the following recording for use in the picture:\n\n' +
      '    Title: ' + (c.title || '[title]') + '\n' +
      '    Artist: ' + (c.artist || '[artist]') + '\n' +
      '    Use: ' + (c.use || 'background') + (c.scene ? ', scene ' + c.scene : '') +
      ', timing to be confirmed at picture lock\n' +
      '    Rights sought: synchronization' + (tier.allIn ? ' and master use under one all-in fee' :
        ', plus master use where you control the recording') + '\n' +
      '    Territory / term: ' + scopeLine + '\n\n' +
      'Please advise your fee for each side, any most-favored-nations terms, and the exact ' +
      'credit language you require. We are happy to send the scene pages and a reference cut ' +
      'for context.\n\n' +
      'Kind regards,\n' + (o.contact || '') + '\n';
  }

  /* ── 6 · cue sheet export ─────────────────────────────────────────────── */
  function pad(s, n) {
    s = String(s == null ? '' : s);
    if (s.length > n - 2) s = s.slice(0, n - 3) + '…';
    while (s.length < n) s += ' ';
    return s;
  }
  function cueSheet(cues, o) {
    o = o || {};
    var rows = (cues || []).filter(function (c) { return c.status !== 'replaced'; });
    var lines = [];
    lines.push('MUSIC CUE SHEET — ' + (o.production || 'Untitled production'));
    lines.push('Prepared ' + (o.date || '[date]') +
      ' · timings to be filled at picture lock · verify publisher and master-owner data before delivery');
    lines.push('');
    lines.push(pad('SEQ', 5) + pad('TITLE', 30) + pad('ARTIST', 22) + pad('USE', 14) +
      pad('TIMING', 16) + pad('PUBLISHER', 24) + 'MASTER OWNER');
    rows.forEach(function (c, i) {
      lines.push(pad(i + 1, 5) + pad(c.title, 30) + pad(c.artist || '—', 22) + pad(c.use, 14) +
        pad('__:__ – __:__', 16) + pad(c.publisher || '[publisher]', 24) + (c.masterOwner || '[master owner]'));
    });
    lines.push('');
    lines.push(rows.length + ' cue' + (rows.length === 1 ? '' : 's') +
      ' · use codes: background / featured / main title / end credits · status "' +
      'licensed" cues only should ship on the final sheet');
    return lines.join('\n');
  }

  root.CMusic = {
    USES: USES, SCOPES: SCOPES, STATUSES: STATUSES,
    TIERS: TIERS, TIER_BY_ID: TIER_BY_ID, FESTIVAL_FACTOR: FESTIVAL_FACTOR,
    splitScenes: splitScenes, scanScript: scanScript,
    makeCue: makeCue, cueFromHit: cueFromHit,
    setStatus: setStatus, nextStatus: nextStatus,
    estimate: estimate, cueCost: cueCost, totals: totals, scoreComparison: scoreComparison,
    licenseRequest: licenseRequest, cueSheet: cueSheet
  };
})(typeof window !== 'undefined' ? window : globalThis);
